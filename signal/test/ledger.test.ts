import { describe, expect, it } from 'vitest';
import { verifyPacket } from '../src/ledger/ledger.js';
import type { OutcomePacket } from '../src/types.js';
import { principalFor, rawComplaint, testService } from './helpers.js';

describe('PacketLedger', () => {
  it('chains packets: sequence increments and previousPacketHash links', async () => {
    const { service } = testService();
    const p0 = await service.ingest(rawComplaint());
    const p1 = await service.ingest(rawComplaint({ subject: 'Another complaint' }));

    expect(p0.integrity.sequence).toBe(0);
    expect(p0.integrity.previousPacketHash).toBeNull();
    expect(p1.integrity.sequence).toBe(1);
    expect(p1.integrity.previousPacketHash).toBe(p0.integrity.payloadHash);
  });

  it('keeps tenant chains independent', async () => {
    const { service } = testService();
    await service.ingest(rawComplaint());
    const other = await service.ingest(rawComplaint({ tenantId: 'tenant-b' }));
    expect(other.integrity.sequence).toBe(0);
    expect(other.integrity.previousPacketHash).toBeNull();
  });

  it('verifies untampered packets and full chains', async () => {
    const { service } = testService();
    const p0 = await service.ingest(rawComplaint());
    await service.ingest(rawComplaint({ subject: 'Second' }));

    const auditor = principalFor(service, { scopes: ['packets:verify'] });
    const single = await service.verifyPacket(auditor, 'tenant-a', p0.payload.id);
    expect(single.valid).toBe(true);
    expect(single.checks).toEqual({ payloadHash: true, signature: true, chainLink: true });

    const audit = await service.auditChain(auditor, 'tenant-a');
    expect(audit).toEqual({ valid: true, packetCount: 2, brokenAt: [] });
  });

  it('detects payload tampering after sealing', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());

    // Simulate an attacker editing the stored packet in place.
    packet.payload.outcome.summary = 'nothing to see here, all resolved';

    const auditor = principalFor(service, { scopes: ['packets:verify'] });
    const result = await service.verifyPacket(auditor, 'tenant-a', packet.payload.id);
    expect(result.valid).toBe(false);
    expect(result.checks.payloadHash).toBe(false);
    expect(result.errors.join(' ')).toMatch(/altered after sealing/);
  });

  it('detects a re-hashed forgery via the signature', async () => {
    const { service } = testService();
    const packet = await service.ingest(rawComplaint());

    // Attacker edits the payload AND recomputes the hash — signature still breaks.
    packet.payload.outcome.summary = 'forged';
    const { hashCanonical } = await import('../src/crypto/hash.js');
    packet.integrity.payloadHash = hashCanonical(packet.payload);

    const auditor = principalFor(service, { scopes: ['packets:verify'] });
    const result = await service.verifyPacket(auditor, 'tenant-a', packet.payload.id);
    expect(result.valid).toBe(false);
    expect(result.checks.payloadHash).toBe(true);
    expect(result.checks.signature).toBe(false);
  });

  it('detects historical tampering through downstream chain links', async () => {
    const { service } = testService();
    const p0 = await service.ingest(rawComplaint());
    await service.ingest(rawComplaint({ subject: 'Second' }));

    p0.payload.outcome.summary = 'rewritten history';
    const { hashCanonical } = await import('../src/crypto/hash.js');
    p0.integrity.payloadHash = hashCanonical(p0.payload);

    const auditor = principalFor(service, { scopes: ['packets:verify'] });
    const audit = await service.auditChain(auditor, 'tenant-a');
    expect(audit.valid).toBe(false);
    // p0's signature breaks, and p1's chain link to p0 breaks.
    expect(audit.brokenAt.length).toBe(2);
  });

  it('verifyPacket is stateless and usable by an external auditor', async () => {
    const { service } = testService();
    const p0 = await service.ingest(rawComplaint());
    const p1 = await service.ingest(rawComplaint({ subject: 'Second' }));

    // Simulate export: plain JSON round-trip, verified with only the public key.
    const exported0 = JSON.parse(JSON.stringify(p0)) as OutcomePacket;
    const exported1 = JSON.parse(JSON.stringify(p1)) as OutcomePacket;
    expect(verifyPacket(exported0, service.signer.publicKeyPem, null).valid).toBe(true);
    expect(verifyPacket(exported1, service.signer.publicKeyPem, exported0).valid).toBe(true);
    expect(verifyPacket(exported1, service.signer.publicKeyPem, null).valid).toBe(false);
  });
});
