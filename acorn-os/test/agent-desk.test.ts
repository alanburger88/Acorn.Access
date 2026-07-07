import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import { newId, newSecret } from '../src/kernel/ids.js';
import type {
  AgentDeskService,
  AnalyticsService,
  Channel,
  Communication,
  ConsentRecord,
  Customer,
  DeliveryService,
  PreferenceRecord,
  RequestCtx,
  SecureLink,
} from '../src/kernel/contracts.js';
import { createAgentDeskService } from '../src/domains/agent-desk/index.js';

describe('agent-desk domain', () => {
  const tenantId = 'ten_AGENTDESK';
  const agent: RequestCtx = {
    tenantId,
    actorId: 'usr_agent_1',
    roles: ['service-agent'],
    keyId: 'key_agent',
  };
  const outsider: RequestCtx = {
    tenantId,
    actorId: 'usr_dev_1',
    roles: ['developer'],
    keyId: 'key_dev',
  };

  let ctx: PlatformContext;
  let svc: AgentDeskService;
  let deliver: ReturnType<typeof vi.fn>;

  const links = () => ctx.store.collection<SecureLink>('secureLinks');

  function seedCustomer(args: Partial<Customer> = {}): Customer {
    const customer: Customer = {
      id: newId('cus'),
      tenantId,
      name: 'Test Customer',
      locale: 'en-US',
      createdAt: new Date().toISOString(),
      ...args,
    };
    ctx.store.collection<Customer>('customers').put(customer);
    return customer;
  }

  function seedCommunication(customerId: string): Communication {
    const com = {
      id: newId('com'),
      tenantId,
      customerId,
      status: 'delivered',
      createdAt: new Date().toISOString(),
      composed: { title: 'Fixture Statement' },
    } as unknown as Communication;
    ctx.store.collection<Communication>('communications').put(com);
    return com;
  }

  function seedLink(communicationId: string, customerId: string): SecureLink {
    const link: SecureLink = {
      id: newId('lnk'),
      tenantId,
      communicationId,
      customerId,
      token: newSecret(24),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    links().put(link);
    return link;
  }

  const eventsOfType = (type: string) =>
    ctx.log.readAll(tenantId).filter((e) => e.type === type);

  beforeAll(() => {
    ctx = createBaseContext(
      configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')), baseUrl: 'http://desk.local' }),
    );

    deliver = vi.fn(
      async (args: { tenantId: string; communicationId: string; channels?: Channel[] }) => {
        if (args.channels?.includes('secure-link')) {
          const com = ctx.store
            .collection<Communication>('communications')
            .getFor(args.tenantId, args.communicationId);
          seedLink(args.communicationId, com?.customerId ?? 'cus_unknown');
        }
        return [];
      },
    );
    ctx.services.delivery = {
      deliver,
      getSecureLink: (t: string, communicationId: string) =>
        links()
          .list(t, (l) => l.communicationId === communicationId && !l.revokedAt)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .at(-1),
    } as unknown as DeliveryService;

    ctx.services.analytics = {
      customerTimeline: () => [],
    } as unknown as AnalyticsService;

    svc = createAgentDeskService(ctx);
    ctx.services.agentDesk = svc;
  });

  it('forbids every method for a caller without an agent-desk role', async () => {
    let thrown: unknown;
    try {
      svc.searchCustomers(outsider, 'anyone');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 403, code: 'forbidden' });

    const customer = seedCustomer({ name: 'Role Check' });
    const com = seedCommunication(customer.id);
    expect(() => svc.customerOverview(outsider, customer.id)).toThrowError(/forbidden|roles/);
    await expect(svc.resend(outsider, com.id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.reissueLink(outsider, com.id)).rejects.toMatchObject({ status: 403 });
    await expect(svc.addNote(outsider, customer.id, 'hi')).rejects.toMatchObject({ status: 403 });
  });

  it('searches by email substring (case-insensitive), rejects empty query, caps at 25', () => {
    seedCustomer({ name: 'Marta Oakley', email: 'Marta.Oakley@example.com', phone: '+15550001111' });
    const byEmail = svc.searchCustomers(agent, 'marta.oakley@EXAMPLE');
    expect(byEmail).toHaveLength(1);
    expect(byEmail[0]!.name).toBe('Marta Oakley');

    let thrown: unknown;
    try {
      svc.searchCustomers(agent, '   ');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({ status: 400, code: 'validation-failed' });

    for (let i = 0; i < 30; i++) {
      seedCustomer({ name: `Bulk ${i}`, email: `bulk${i}@cap.example.com` });
    }
    expect(svc.searchCustomers(agent, 'cap.example.com')).toHaveLength(25);
  });

  it('overview returns preferences + consents and emits customer-viewed', () => {
    const customer = seedCustomer({ name: 'Otis Fern', email: 'otis@example.com' });
    const pref: PreferenceRecord = {
      id: newId('prf'),
      tenantId,
      customerId: customer.id,
      channelPriority: ['email', 'secure-link'],
      paperless: true,
      updatedAt: new Date().toISOString(),
    };
    ctx.store.collection<PreferenceRecord>('preferences').put(pref);
    const consent: ConsentRecord = {
      id: newId('cns'),
      tenantId,
      customerId: customer.id,
      channel: 'email',
      purpose: 'transactional',
      granted: true,
      source: 'test',
      recordedAt: new Date().toISOString(),
    };
    ctx.store.collection<ConsentRecord>('consents').put(consent);
    const com = seedCommunication(customer.id);

    const overview = svc.customerOverview(agent, customer.id);
    expect(overview.customer.id).toBe(customer.id);
    expect(overview.preferences?.id).toBe(pref.id);
    expect(overview.consents.map((c) => c.id)).toEqual([consent.id]);
    expect(overview.communications.map((c) => c.id)).toContain(com.id);
    expect(overview.recentTimeline).toEqual([]);

    const viewed = eventsOfType('com.acorn.agent.customer-viewed').at(-1);
    expect(viewed).toBeDefined();
    expect(viewed!.data).toMatchObject({ customerId: customer.id, agentActorId: agent.actorId });

    expect(() => svc.customerOverview(agent, 'cus_missing')).toThrowError(/not found/);
  });

  it('resend delegates to delivery.deliver and emits agent.resend with agentActorId', async () => {
    const customer = seedCustomer({ name: 'Resend Target', email: 'resend@example.com' });
    const com = seedCommunication(customer.id);

    await svc.resend(agent, com.id, ['email']);
    expect(deliver).toHaveBeenCalledWith({
      tenantId,
      communicationId: com.id,
      channels: ['email'],
    });
    let event = eventsOfType('com.acorn.agent.resend').at(-1)!;
    expect(event.subject).toBe(com.id);
    expect(event.data).toMatchObject({
      communicationId: com.id,
      customerId: customer.id,
      agentActorId: agent.actorId,
      channels: ['email'],
    });

    await svc.resend(agent, com.id);
    event = eventsOfType('com.acorn.agent.resend').at(-1)!;
    expect(event.data).toMatchObject({ channels: 'preference-based' });

    await expect(svc.resend(agent, 'com_missing')).rejects.toMatchObject({ status: 404 });
  });

  it('reissueLink revokes the live link, returns a fresh URL, emits link-reissued', async () => {
    const customer = seedCustomer({ name: 'Link Holder' });
    const com = seedCommunication(customer.id);
    const oldLink = seedLink(com.id, customer.id);

    const { url, expiresAt } = await svc.reissueLink(agent, com.id);

    const revoked = links().get(oldLink.id)!;
    expect(revoked.revokedAt).toBeDefined();

    expect(url.startsWith('http://desk.local/view/')).toBe(true);
    expect(url).not.toContain(oldLink.token);
    expect(expiresAt).toBeDefined();
    expect(deliver).toHaveBeenCalledWith({
      tenantId,
      communicationId: com.id,
      channels: ['secure-link'],
    });

    const event = eventsOfType('com.acorn.agent.link-reissued').at(-1)!;
    expect(event.subject).toBe(com.id);
    expect(event.data).toMatchObject({
      communicationId: com.id,
      customerId: customer.id,
      agentActorId: agent.actorId,
      revokedCount: 1,
    });
  });

  it('addNote validates length and lands the note text in the event log', async () => {
    const customer = seedCustomer({ name: 'Note Target' });

    await expect(svc.addNote(agent, customer.id, '')).rejects.toMatchObject({ status: 400 });
    await expect(svc.addNote(agent, customer.id, 'x'.repeat(501))).rejects.toMatchObject({
      status: 400,
    });

    await svc.addNote(agent, customer.id, 'Customer called about the March statement.');
    const event = eventsOfType('com.acorn.agent.note-added').at(-1)!;
    expect(event.data).toMatchObject({
      customerId: customer.id,
      agentActorId: agent.actorId,
      note: 'Customer called about the March statement.',
    });
  });
});
