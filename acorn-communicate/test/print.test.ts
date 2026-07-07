import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { newId } from '../src/kernel/ids.js';
import type {
  Communication,
  Customer,
  DeliveryAttempt,
  PrintBatch,
  PrintPiece,
  RenderArtifact,
  RequestCtx,
} from '../src/kernel/contracts.js';
import { createPrintService } from '../src/domains/print/index.js';

describe('print domain', () => {
  const tenantId = 'ten_PRINTTEST';
  const templateId = 'tpl_PRINTTEST';
  const operator: RequestCtx = {
    tenantId,
    actorId: 'usr_op',
    roles: ['operator'],
    keyId: 'key_op',
  };
  const auditor: RequestCtx = {
    tenantId,
    actorId: 'usr_aud',
    roles: ['auditor'],
    keyId: 'key_aud',
  };

  let ctx: PlatformContext;
  let outboxDir: string;
  let comA: Communication;
  let comB: Communication;
  let comC: Communication;
  let comD: Communication;
  let firstBatch: PrintBatch;

  function makeCustomer(name: string, address?: Customer['address']): Customer {
    const customer: Customer = {
      id: newId('cus'),
      tenantId,
      name,
      locale: 'en-US',
      createdAt: new Date().toISOString(),
      ...(address ? { address } : {}),
    };
    ctx.store.collection<Customer>('customers').put(customer);
    return customer;
  }

  function makeCommunication(customerId: string): Communication {
    const com = {
      id: newId('com'),
      tenantId,
      templateId,
      templateVersionId: 'tpv_PRINTTEST',
      customerId,
      status: 'delivered',
      composed: { title: 'Fixture Statement' },
      createdAt: new Date().toISOString(),
    } as unknown as Communication;
    ctx.store.collection<Communication>('communications').put(com);
    return com;
  }

  function makePdfArtifact(communicationId: string): RenderArtifact {
    const obj = ctx.objects.put(
      tenantId,
      Buffer.from(`%PDF-1.7 fixture for ${communicationId}`),
      'application/pdf',
    );
    const artifact: RenderArtifact = {
      id: newId('art'),
      tenantId,
      communicationId,
      format: 'pdf',
      objectKey: obj.key,
      sha256: obj.sha256,
      size: obj.size,
      contentType: 'application/pdf',
      renderedAt: new Date().toISOString(),
      rendererVersion: 'test-1',
    };
    ctx.store.collection<RenderArtifact>('artifacts').put(artifact);
    return artifact;
  }

  beforeAll(() => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-print-'));
    outboxDir = join(tmp, 'outbox');
    ctx = createBaseContext(configFromEnv({ dataDir: tmp, outboxDir }));
    ctx.services.print = createPrintService(ctx);

    const addrB = {
      line1: '742 Evergreen Terrace',
      city: 'New York',
      region: 'NY',
      postalCode: '10001',
      country: 'US',
    };
    const custA = makeCustomer('Alice Ash', {
      line1: '1 Oak Lane',
      city: 'Madison',
      region: 'WI',
      postalCode: '53703',
      country: 'US',
    });
    const custB = makeCustomer('Bob Birch', addrB);
    const custC = makeCustomer('Cara Cedar', {
      line1: '9 Pine Street',
      city: 'Chicago',
      region: 'IL',
      postalCode: '60601',
      country: 'US',
    });
    // D shares B's exact address -> same household
    const custD = makeCustomer('Dana Birch', { ...addrB });

    comA = makeCommunication(custA.id);
    comB = makeCommunication(custB.id);
    comC = makeCommunication(custC.id);
    comD = makeCommunication(custD.id);

    // pdf artifacts for A, B, D only — C has an address but NO pdf artifact
    makePdfArtifact(comA.id);
    makePdfArtifact(comB.id);
    makePdfArtifact(comD.id);
  });

  it('spools a batch: suppression, householding, presort, manifest + outbox spool file', async () => {
    firstBatch = await ctx.services.print.createBatch(operator, {
      communicationIds: [comA.id, comB.id, comC.id, comD.id],
    });

    expect(firstBatch.status).toBe('spooled');
    expect(firstBatch.suppressed).toEqual([
      { communicationId: comC.id, reason: 'no-print-artifact' },
    ]);
    expect(firstBatch.pieceIds).toHaveLength(3);
    expect(new Set(firstBatch.communicationIds)).toEqual(new Set([comA.id, comB.id, comD.id]));

    // householding: B + D share one household, A is alone; presort 10001 < 53703
    expect(firstBatch.households).toHaveLength(2);
    expect(firstBatch.households.map((h) => h.postalCode)).toEqual(['10001', '53703']);
    expect(firstBatch.households[0]!.pieceIds).toHaveLength(2);
    expect(firstBatch.households[1]!.pieceIds).toHaveLength(1);
    // batch.pieceIds follow presort (household) order
    expect(firstBatch.pieceIds).toEqual(firstBatch.households.flatMap((h) => h.pieceIds));

    const pieces = ctx.services.print.listPieces(tenantId, firstBatch.id);
    expect(pieces.map((p) => p.postalCode)).toEqual(['10001', '10001', '53703']);
    for (const piece of pieces) {
      expect(piece.status).toBe('queued');
      expect(piece.imb).toMatch(/^00\d{29}$/);
      expect(piece.imb).toHaveLength(31);
      expect(piece.sortKey).toBe(`${piece.postalCode}:${piece.householdKey}`);
    }
    expect(pieces[0]!.householdKey).toBe(pieces[1]!.householdKey);
    expect(pieces[2]!.householdKey).not.toBe(pieces[0]!.householdKey);

    // manifest object in the object store
    expect(firstBatch.manifestObjectKey).toBeDefined();
    const obj = ctx.objects.get(firstBatch.manifestObjectKey!);
    expect(obj).toBeDefined();
    expect(obj!.contentType).toBe('application/json');
    const manifest = JSON.parse(obj!.buf.toString('utf8')) as {
      batchId: string;
      presort: { postalCode: string; pieces: { pdfObjectKey: string; imb: string }[] }[];
    };
    expect(manifest.batchId).toBe(firstBatch.id);
    expect(manifest.presort.map((g) => g.postalCode)).toEqual(['10001', '53703']);
    for (const group of manifest.presort) {
      for (const p of group.pieces) expect(p.pdfObjectKey).toContain(tenantId);
    }

    // outbox spool file copy
    const spoolPath = join(outboxDir, `print-spool-${firstBatch.id}.json`);
    expect(existsSync(spoolPath)).toBe(true);
    const spool = JSON.parse(readFileSync(spoolPath, 'utf8')) as { batchId: string };
    expect(spool.batchId).toBe(firstBatch.id);

    // batch-spooled event on the log
    const events = ctx.log.query(tenantId, { type: 'com.acorn.print.batch-spooled' });
    expect(events).toHaveLength(1);
    expect(events[0]!.subject).toBe(firstBatch.id);
    expect(events[0]!.data).toMatchObject({ batchId: firstBatch.id, pieces: 3, suppressed: 1 });
  });

  it('suppresses communications already in a non-reconciled batch', async () => {
    const second = await ctx.services.print.createBatch(operator, {
      communicationIds: [comA.id, comB.id, comD.id],
    });
    expect(second.pieceIds).toHaveLength(0);
    expect(second.suppressed).toEqual([
      { communicationId: comA.id, reason: 'already-in-batch' },
      { communicationId: comB.id, reason: 'already-in-batch' },
      { communicationId: comD.id, reason: 'already-in-batch' },
    ]);
  });

  it('rejects createBatch with neither communicationIds nor templateId', async () => {
    await expect(ctx.services.print.createBatch(operator, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      ctx.services.print.createBatch(operator, { communicationIds: ['com_missing'] }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('tracks piece lifecycle; returned mail writes a bounced delivery and print.returned', async () => {
    const pieces = ctx.services.print.listPieces(tenantId, firstBatch.id);
    const piece = pieces[0]!;

    let updated = await ctx.services.print.recordPieceEvent(operator, piece.id, 'printed');
    expect(updated.status).toBe('printed');
    updated = await ctx.services.print.recordPieceEvent(operator, piece.id, 'mailed');
    expect(updated.status).toBe('mailed');
    updated = await ctx.services.print.recordPieceEvent(operator, piece.id, 'returned');
    expect(updated.status).toBe('returned');

    // bounced 'deliveries' row so the NBA update-details rule fires
    const bounced = ctx.store
      .collection<DeliveryAttempt>('deliveries')
      .list(tenantId, (d) => d.communicationId === piece.communicationId);
    expect(bounced).toHaveLength(1);
    expect(bounced[0]).toMatchObject({
      channel: 'print',
      provider: 'print-batch',
      to: piece.householdKey,
      status: 'bounced',
      failureReason: 'return-mail',
      attempt: 1,
      customerId: piece.customerId,
    });

    // events on the tamper-evident log
    const returnedEvents = ctx.log.query(tenantId, { type: 'com.acorn.print.returned' });
    expect(returnedEvents).toHaveLength(1);
    expect(returnedEvents[0]!.data).toMatchObject({
      pieceId: piece.id,
      communicationId: piece.communicationId,
      customerId: piece.customerId,
    });
    const pieceEvents = ctx.log.query(tenantId, {
      type: 'com.acorn.print.piece-updated',
      subject: piece.id,
    });
    expect(pieceEvents.map((e) => (e.data as PrintPiece).status)).toEqual([
      'printed',
      'mailed',
      'returned',
    ]);

    // invalid transitions rejected
    await expect(
      ctx.services.print.recordPieceEvent(operator, piece.id, 'mailed'),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      ctx.services.print.recordPieceEvent(operator, pieces[1]!.id, 'delivered'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('reconciles counts and flips the batch to reconciled once all pieces are terminal', async () => {
    // after the previous test: piece[0] returned, pieces[1] and [2] still queued
    let counts = ctx.services.print.reconcile(operator, firstBatch.id);
    expect(counts).toEqual({ expected: 3, mailed: 1, delivered: 0, returned: 1, outstanding: 2 });
    expect(ctx.services.print.getBatch(tenantId, firstBatch.id)!.status).toBe('spooled');

    const pieces = ctx.services.print.listPieces(tenantId, firstBatch.id);
    for (const piece of pieces.slice(1)) {
      await ctx.services.print.recordPieceEvent(operator, piece.id, 'mailed'); // skip printed
      await ctx.services.print.recordPieceEvent(operator, piece.id, 'delivered');
    }
    // first delivery signal flipped the batch to shipped
    expect(ctx.services.print.getBatch(tenantId, firstBatch.id)!.status).toBe('shipped');

    counts = ctx.services.print.reconcile(operator, firstBatch.id);
    expect(counts).toEqual({ expected: 3, mailed: 3, delivered: 2, returned: 1, outstanding: 0 });
    expect(ctx.services.print.getBatch(tenantId, firstBatch.id)!.status).toBe('reconciled');
  });

  it('forbids recordPieceEvent for the auditor role', async () => {
    const pieces = ctx.services.print.listPieces(tenantId, firstBatch.id);
    await expect(
      ctx.services.print.recordPieceEvent(auditor, pieces[0]!.id, 'printed'),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  });
});
