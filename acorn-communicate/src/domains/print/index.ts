/**
 * PRINT PRODUCTION bounded context — batch spooling for physical mail:
 * address validation (suppression), householding by normalized address,
 * postal presort, simulated Intelligent Mail barcodes, spool manifests, and
 * mail-event tracking through to reconciliation.
 *
 * Exposes `createPrintService` (implements PrintService from
 * kernel/contracts.ts) and `registerPrintRoutes` (/v1 HTTP surface).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type {
  Communication,
  Customer,
  DeliveryAttempt,
  PrintBatch,
  PrintPiece,
  PrintService,
  RenderArtifact,
  RequestCtx,
  Role,
} from '../../kernel/contracts.js';
import type { PlatformContext } from '../../kernel/context.js';
import { forbidden, invalid, notFound } from '../../kernel/errors.js';
import { parseBody, requireAuth } from '../../kernel/http.js';
import { newId } from '../../kernel/ids.js';

const SOURCE = '/domains/print';

/** Roles allowed to spool batches and record mail events. */
const OPERATOR_ROLES: Role[] = ['operator', 'developer', 'tenant-admin'];

function requireOperator(rctx: RequestCtx): void {
  if (!OPERATOR_ROLES.some((r) => rctx.roles.includes(r))) {
    throw forbidden(`requires one of roles: ${OPERATOR_ROLES.join(', ')}`);
  }
}

/** Lowercase + collapse whitespace — householding normalization. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Simulated Intelligent Mail barcode: 31 numeric digits, deterministic-ish —
 * '00' prefix + 29 digits harvested from sha256 hashes of the piece id.
 */
function makeImb(pieceId: string): string {
  let digits = '';
  let seed = pieceId;
  while (digits.length < 29) {
    const hex = createHash('sha256').update(seed).digest('hex');
    digits += hex.replace(/\D/g, '');
    seed = hex;
  }
  return `00${digits.slice(0, 29)}`;
}

/** Valid mail-event transitions (skipping 'printed' is allowed: queued→mailed). */
const TRANSITIONS: Record<PrintPiece['status'], PrintPiece['status'][]> = {
  queued: ['printed', 'mailed'],
  printed: ['mailed'],
  mailed: ['delivered', 'returned'],
  delivered: [],
  returned: [],
};

const COMPOSED_STATUSES = new Set(['delivered', 'rendered', 'archived']);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function createPrintService(ctx: PlatformContext): PrintService {
  const batches = ctx.store.collection<PrintBatch>('printBatches');
  const pieces = ctx.store.collection<PrintPiece>('printPieces');
  // read-only views of peer domains' collections
  const communications = ctx.store.collection<Communication>('communications');
  const customers = ctx.store.collection<Customer>('customers');
  const artifacts = ctx.store.collection<RenderArtifact>('artifacts');
  // written on 'returned' so downstream rules (NBA update-details) fire
  const deliveries = ctx.store.collection<DeliveryAttempt>('deliveries');

  function pdfArtifact(tenantId: string, communicationId: string): RenderArtifact | undefined {
    return artifacts
      .list(tenantId, (a) => a.communicationId === communicationId && a.format === 'pdf')
      .sort((a, b) => a.renderedAt.localeCompare(b.renderedAt))
      .at(-1);
  }

  /** Is this communication already spooled in a batch that has not been reconciled? */
  function inOpenBatch(tenantId: string, communicationId: string): boolean {
    return pieces
      .list(tenantId, (p) => p.communicationId === communicationId)
      .some((p) => batches.getFor(tenantId, p.batchId)?.status !== 'reconciled');
  }

  const service: PrintService = {
    async createBatch(rctx, args) {
      requireOperator(rctx);
      const tenantId = rctx.tenantId;

      // Candidate communications: explicit ids OR all composed-and-beyond
      // communications of a template.
      let candidates: Communication[];
      if (args.communicationIds && args.communicationIds.length > 0) {
        candidates = args.communicationIds.map((id) => {
          const com = communications.getFor(tenantId, id);
          if (!com) throw notFound('communication', id);
          return com;
        });
      } else if (args.templateId) {
        candidates = communications.list(
          tenantId,
          (c) => c.templateId === args.templateId && COMPOSED_STATUSES.has(c.status),
        );
      } else {
        throw invalid('either communicationIds or templateId is required');
      }

      const batchId = newId('pbt');
      const now = new Date().toISOString();
      const suppressed: PrintBatch['suppressed'] = [];
      const batchPieces: (PrintPiece & { customerName: string; address: NonNullable<Customer['address']>; pdfObjectKey: string })[] = [];

      for (const com of candidates) {
        const customer = customers.getFor(tenantId, com.customerId);
        if (!customer) throw notFound('customer', com.customerId);
        if (!customer.address) {
          suppressed.push({ communicationId: com.id, reason: 'no-address' });
          continue;
        }
        const pdf = pdfArtifact(tenantId, com.id);
        if (!pdf) {
          suppressed.push({ communicationId: com.id, reason: 'no-print-artifact' });
          continue;
        }
        if (inOpenBatch(tenantId, com.id)) {
          suppressed.push({ communicationId: com.id, reason: 'already-in-batch' });
          continue;
        }

        const address = customer.address;
        const householdKey = normalize(`${address.line1}|${address.postalCode}`);
        const pieceId = newId('pcs');
        batchPieces.push({
          id: pieceId,
          tenantId,
          batchId,
          communicationId: com.id,
          customerId: customer.id,
          householdKey,
          postalCode: address.postalCode,
          sortKey: `${address.postalCode}:${householdKey}`,
          imb: makeImb(pieceId),
          status: 'queued',
          updatedAt: now,
          customerName: customer.name,
          address,
          pdfObjectKey: pdf.objectKey,
        });
      }

      // Presort: group by household, order households by postal code ascending.
      const byHousehold = new Map<string, typeof batchPieces>();
      for (const piece of batchPieces) {
        const group = byHousehold.get(piece.householdKey) ?? [];
        group.push(piece);
        byHousehold.set(piece.householdKey, group);
      }
      const households = [...byHousehold.values()].sort((a, b) =>
        a[0]!.sortKey.localeCompare(b[0]!.sortKey),
      );
      const presortPieces = households.flat();

      const batch: PrintBatch = {
        id: batchId,
        tenantId,
        status: 'spooled',
        createdAt: now,
        communicationIds: presortPieces.map((p) => p.communicationId),
        suppressed,
        households: households.map((group) => ({
          householdKey: group[0]!.householdKey,
          postalCode: group[0]!.postalCode,
          pieceIds: group.map((p) => p.id),
        })),
        pieceIds: presortPieces.map((p) => p.id),
      };

      // Spool manifest: everything the print provider needs to produce mail.
      const manifest = {
        batchId,
        createdAt: now,
        presort: households.map((group) => ({
          postalCode: group[0]!.postalCode,
          householdKey: group[0]!.householdKey,
          pieces: group.map((p) => ({
            pieceId: p.id,
            communicationId: p.communicationId,
            customerName: p.customerName,
            address: p.address,
            imb: p.imb,
            pdfObjectKey: p.pdfObjectKey,
          })),
        })),
      };
      const manifestJson = JSON.stringify(manifest, null, 2);
      const stored = ctx.objects.put(tenantId, Buffer.from(manifestJson), 'application/json');
      batch.manifestObjectKey = stored.key;
      mkdirSync(ctx.config.outboxDir, { recursive: true });
      writeFileSync(join(ctx.config.outboxDir, `print-spool-${batchId}.json`), manifestJson);

      for (const { customerName: _n, address: _a, pdfObjectKey: _k, ...piece } of presortPieces) {
        pieces.put(piece);
      }
      batches.put(batch);

      await ctx.publish({
        type: 'com.acorn.print.batch-spooled',
        tenantId,
        source: SOURCE,
        subject: batchId,
        data: { batchId, pieces: batch.pieceIds.length, suppressed: suppressed.length },
      });

      return batch;
    },

    getBatch(tenantId, batchId) {
      return batches.getFor(tenantId, batchId);
    },

    listBatches(rctx) {
      return batches
        .list(rctx.tenantId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },

    listPieces(tenantId, batchId) {
      const batch = batches.getFor(tenantId, batchId);
      if (!batch) throw notFound('print batch', batchId);
      // return in presort order
      return batch.pieceIds
        .map((id) => pieces.getFor(tenantId, id))
        .filter((p): p is PrintPiece => Boolean(p));
    },

    async recordPieceEvent(rctx, pieceId, status) {
      requireOperator(rctx);
      const tenantId = rctx.tenantId;
      const piece = pieces.getFor(tenantId, pieceId);
      if (!piece) throw notFound('print piece', pieceId);
      if (!TRANSITIONS[piece.status].includes(status)) {
        throw invalid(`invalid piece transition ${piece.status} -> ${status}`);
      }

      const now = new Date().toISOString();
      const updated: PrintPiece = { ...piece, status, updatedAt: now };
      pieces.put(updated);
      await ctx.publish({
        type: 'com.acorn.print.piece-updated',
        tenantId,
        source: SOURCE,
        subject: pieceId,
        data: {
          pieceId,
          batchId: piece.batchId,
          communicationId: piece.communicationId,
          customerId: piece.customerId,
          status,
        },
      });

      if (status === 'returned') {
        // Return mail == a bounced print delivery: append a delivery attempt
        // so downstream rules (NBA update-details) fire off the deliveries feed.
        deliveries.put({
          id: newId('dlv'),
          tenantId,
          communicationId: piece.communicationId,
          customerId: piece.customerId,
          channel: 'print',
          provider: 'print-batch',
          to: piece.householdKey,
          status: 'bounced',
          attempt: 1,
          createdAt: now,
          updatedAt: now,
          failureReason: 'return-mail',
        });
        await ctx.publish({
          type: 'com.acorn.print.returned',
          tenantId,
          source: SOURCE,
          subject: pieceId,
          data: {
            pieceId,
            communicationId: piece.communicationId,
            customerId: piece.customerId,
          },
        });
      }

      if (status === 'delivered') {
        // Simplification: the first delivery signal flips the whole batch to
        // 'shipped' — a real integration would track per-tray induction scans.
        const batch = batches.getFor(tenantId, piece.batchId);
        if (batch && batch.status === 'spooled') {
          batches.put({ ...batch, status: 'shipped' });
        }
      }

      return updated;
    },

    reconcile(rctx, batchId) {
      requireOperator(rctx);
      const tenantId = rctx.tenantId;
      const batch = batches.getFor(tenantId, batchId);
      if (!batch) throw notFound('print batch', batchId);

      const batchPieces = pieces.list(tenantId, (p) => p.batchId === batchId);
      const count = (statuses: PrintPiece['status'][]): number =>
        batchPieces.filter((p) => statuses.includes(p.status)).length;
      const counts = {
        expected: batchPieces.length,
        mailed: count(['mailed', 'delivered', 'returned']),
        delivered: count(['delivered']),
        returned: count(['returned']),
        outstanding: count(['queued', 'printed']),
      };
      if (counts.outstanding === 0 && batch.status !== 'reconciled') {
        batches.put({ ...batch, status: 'reconciled' });
      }
      return counts;
    },
  };

  return service;
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

const createBatchSchema = z.object({
  communicationIds: z.array(z.string().min(1)).optional(),
  templateId: z.string().min(1).optional(),
});

const pieceEventSchema = z.object({
  status: z.enum(['printed', 'mailed', 'delivered', 'returned']),
});

export function registerPrintRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  const print = () => ctx.services.print;

  app.post('/v1/print-batches', async (req) => {
    const rctx = requireAuth(ctx, req, OPERATOR_ROLES);
    const body = parseBody(createBatchSchema, req.body);
    return print().createBatch(rctx, body);
  });

  app.get('/v1/print-batches', async (req) => {
    const rctx = requireAuth(ctx, req);
    return print().listBatches(rctx);
  });

  app.get('/v1/print-batches/:id', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const batch = print().getBatch(rctx.tenantId, id);
    if (!batch) throw notFound('print batch', id);
    return batch;
  });

  app.get('/v1/print-batches/:id/pieces', async (req) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    return print().listPieces(rctx.tenantId, id);
  });

  app.get('/v1/print-batches/:id/manifest', async (req, reply) => {
    const rctx = requireAuth(ctx, req);
    const { id } = req.params as { id: string };
    const batch = print().getBatch(rctx.tenantId, id);
    if (!batch?.manifestObjectKey) throw notFound('print batch manifest', id);
    const obj = ctx.objects.get(batch.manifestObjectKey);
    if (!obj) throw notFound('print batch manifest object', id);
    return reply.type(obj.contentType).send(obj.buf);
  });

  app.post('/v1/print-pieces/:id/events', async (req) => {
    const rctx = requireAuth(ctx, req, OPERATOR_ROLES);
    const { id } = req.params as { id: string };
    const body = parseBody(pieceEventSchema, req.body);
    return print().recordPieceEvent(rctx, id, body.status);
  });

  app.post('/v1/print-batches/:id/reconcile', async (req) => {
    const rctx = requireAuth(ctx, req, OPERATOR_ROLES);
    const { id } = req.params as { id: string };
    return print().reconcile(rctx, id);
  });
}
