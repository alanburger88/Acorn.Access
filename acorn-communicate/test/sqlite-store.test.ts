/**
 * SQLite storage adapter tests:
 * (a) unit parity against the file-backed reference Collection,
 * (b) persistence across close/reopen,
 * (c) full-platform smoke — the entire communication lifecycle from
 *     test/e2e.test.ts condensed and run over SQL storage,
 * (d) collection-name sanitization guard.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store, type StorePort } from '../src/kernel/storage.js';
import { createSqliteStore } from '../src/adapters/sqlite-store.js';
import { buildPlatform } from '../src/server.js';
import { configFromEnv } from '../src/kernel/context.js';

interface Doc {
  id: string;
  tenantId: string;
  kind: string;
  n: number;
  nested: { tags: string[]; flag: boolean; nil: null };
}

const doc = (id: string, tenantId: string, kind: string, n: number): Doc => ({
  id,
  tenantId,
  kind,
  n,
  nested: { tags: [`tag-${n}`, 'common'], flag: n % 2 === 0, nil: null },
});

/** Run an identical operation script over any StorePort and collect results. */
function runScript(store: StorePort): unknown[] {
  const col = store.collection<Doc>('parity_docs');
  const results: unknown[] = [];

  results.push(col.put(doc('a1', 'tenant-a', 'invoice', 1)));
  results.push(col.put(doc('a2', 'tenant-a', 'notice', 2)));
  results.push(col.put(doc('b1', 'tenant-b', 'invoice', 3)));

  // update one
  results.push(col.put({ ...doc('a1', 'tenant-a', 'invoice', 10), kind: 'invoice-updated' }));
  results.push(col.get('a1'));

  // delete one
  results.push(col.delete('a2'));
  results.push(col.delete('a2')); // second delete → false
  results.push(col.get('a2'));

  // tenant scoping
  results.push(col.getFor('tenant-a', 'a1'));
  results.push(col.getFor('tenant-a', 'b1')); // cross-tenant → undefined
  results.push(col.getFor('tenant-b', 'b1'));

  const byId = (a: Doc, b: Doc) => a.id.localeCompare(b.id);
  results.push(col.list('tenant-a').sort(byId));
  results.push(col.list('tenant-a', (d) => d.kind === 'invoice-updated').sort(byId));
  results.push(col.list('tenant-b', (d) => d.n > 100).sort(byId));
  results.push(col.listAll().sort(byId));
  results.push(col.listAll((d) => d.nested.flag).sort(byId));

  return results;
}

describe('sqlite store adapter', () => {
  it('is behaviorally identical to the file-backed reference store', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-sqlite-parity-'));
    const fileStore = new Store(join(tmp, 'collections'));
    const sqliteStore = createSqliteStore(join(tmp, 'parity.sqlite'));

    const fileResults = runScript(fileStore);
    const sqliteResults = runScript(sqliteStore);
    expect(sqliteResults).toEqual(fileResults);

    sqliteStore.close();
  });

  it('persists documents across close and reopen', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-sqlite-persist-'));
    const dbFile = join(tmp, 'nested', 'dir', 'persist.sqlite');

    const store = createSqliteStore(dbFile);
    const col = store.collection<Doc>('durable');
    col.put(doc('p1', 'tenant-a', 'invoice', 1));
    col.put(doc('p2', 'tenant-b', 'notice', 2));
    store.close();

    const reopened = createSqliteStore(dbFile);
    const col2 = reopened.collection<Doc>('durable');
    expect(col2.get('p1')).toEqual(doc('p1', 'tenant-a', 'invoice', 1));
    expect(col2.getFor('tenant-b', 'p2')).toEqual(doc('p2', 'tenant-b', 'notice', 2));
    expect(col2.listAll()).toHaveLength(2);
    reopened.close();
  });

  it('throws on non-alphanumeric collection names', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-sqlite-guard-'));
    const store = createSqliteStore(join(tmp, 'guard.sqlite'));
    expect(() => store.collection('bad;name')).toThrow(/invalid collection name/);
    store.close();
  });

  it('runs the full communication lifecycle over sqlite storage', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-sqlite-e2e-'));
    const store = createSqliteStore(join(tmp, 'test.sqlite'));
    const platform = buildPlatform(
      configFromEnv({
        dataDir: tmp,
        outboxDir: join(tmp, 'outbox'),
        baseUrl: 'http://sqlite.local',
        port: 0,
        anthropicApiKey: undefined,
      }),
      { store },
    );
    await platform.app.ready();
    const { app } = platform;
    const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

    try {
      // bootstrap tenant + role-scoped keys
      const tenant = await app.inject({
        method: 'POST',
        url: '/v1/tenants',
        payload: { name: 'SQLite Credit Union', industry: 'credit-union' },
      });
      expect([200, 201]).toContain(tenant.statusCode);
      const adminSecret = tenant.json().adminKey.secret;

      const authorRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: auth(adminSecret),
        payload: { name: 'author', roles: ['business-author', 'designer', 'operator'] },
      });
      const authorSecret = authorRes.json().secret;
      const approverRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        headers: auth(adminSecret),
        payload: { name: 'approver', roles: ['compliance-approver'] },
      });
      const approverSecret = approverRes.json().secret;
      expect(approverSecret).toBeTruthy();

      // customer
      const cust = await app.inject({
        method: 'POST',
        url: '/v1/customers',
        headers: auth(adminSecret),
        payload: { name: 'Sal Quartz', email: 'sal@example.com', phone: '+1-555-000-9876', locale: 'en-US' },
      });
      expect([200, 201]).toContain(cust.statusCode);
      const customerId = cust.json().id;

      // content create → submit → approve
      const created = await app.inject({
        method: 'POST',
        url: '/v1/content',
        headers: auth(authorSecret),
        payload: {
          key: 'disclosure.sqlite',
          type: 'disclosure',
          title: 'SQLite Disclosure',
          body: 'You may dispute any charge within 60 days of the statement date.',
        },
      });
      expect([200, 201]).toContain(created.statusCode);
      const versionId = created.json().version.id;
      await app.inject({
        method: 'POST',
        url: `/v1/content-versions/${versionId}/submit`,
        headers: auth(authorSecret),
      });
      const review = await app.inject({
        method: 'POST',
        url: `/v1/content-versions/${versionId}/review`,
        headers: auth(approverSecret),
        payload: { decision: 'approved' },
      });
      expect([200, 201]).toContain(review.statusCode);

      // brand + template (accessibility-passing fixture from e2e) + publish
      const brand = await app.inject({
        method: 'POST',
        url: '/v1/brands',
        headers: auth(adminSecret),
        payload: {
          name: 'SQLite CU',
          primaryColor: '#123456',
          accentColor: '#234567',
          logoText: 'SQL CU',
          fromEmail: 'no-reply@sqlite.example',
          fromSms: 'SQLCU',
        },
      });
      const brandId = brand.json().id;

      const template = await app.inject({
        method: 'POST',
        url: '/v1/templates',
        headers: auth(authorSecret),
        payload: {
          key: 'sqlite-statement',
          name: 'SQLite Statement',
          communicationType: 'statement',
          brandId,
          intendedOutcome: 'payment_completed',
          dataContract: {
            fields: [
              { path: 'period', type: 'string', required: true },
              { path: 'account.balanceDue', type: 'number', required: true },
              { path: 'account.dueDate', type: 'date', required: true },
            ],
            sample: { period: 'June 2026', account: { balanceDue: 120.5, dueDate: '2026-07-20' } },
          },
          blocks: [
            {
              kind: 'summary',
              title: 'Your {{period}} statement',
              text: 'Your balance of {{account.balanceDue|currency}} is due {{account.dueDate|date}}.',
            },
            {
              kind: 'section',
              id: 'summary',
              title: 'Account Summary',
              explanation: 'What you owe and when it is due.',
              blocks: [
                { kind: 'field-row', label: 'Balance Due', value: '{{account.balanceDue|currency}}' },
                { kind: 'field-row', label: 'Due Date', value: '{{account.dueDate|date}}' },
              ],
            },
            {
              kind: 'section',
              id: 'rights',
              title: 'Your Rights',
              explanation: 'Dispute rules that protect you.',
              blocks: [{ kind: 'content-ref', contentKey: 'disclosure.sqlite' }],
            },
            {
              kind: 'section',
              id: 'actions',
              title: 'Take action',
              explanation: 'Complete your payment without calling us.',
              blocks: [{ kind: 'action', action: 'pay', label: 'Pay now' }],
            },
          ],
          channels: { email: { subject: 'Your {{period}} statement' } },
        },
      });
      expect([200, 201]).toContain(template.statusCode);
      const templateId = template.json().template.id;
      const templateVersionId = template.json().version.id;

      const publish = await app.inject({
        method: 'POST',
        url: `/v1/template-versions/${templateVersionId}/publish`,
        headers: auth(approverSecret),
      });
      expect([200, 201]).toContain(publish.statusCode);

      // compose
      const composed = await app.inject({
        method: 'POST',
        url: '/v1/communications',
        headers: auth(authorSecret),
        payload: {
          templateId,
          customerId,
          data: { period: 'June 2026', account: { balanceDue: 245.1, dueDate: '2026-07-20' } },
        },
      });
      expect([200, 201]).toContain(composed.statusCode);
      const communicationId = composed.json().id;
      expect(composed.json().status).toBe('rendered');

      // deliver + secure link
      const deliver = await app.inject({
        method: 'POST',
        url: `/v1/communications/${communicationId}/deliver`,
        headers: auth(authorSecret),
        payload: {},
      });
      expect([200, 201]).toContain(deliver.statusCode);

      const link = await app.inject({
        method: 'GET',
        url: `/v1/communications/${communicationId}/secure-link`,
        headers: auth(authorSecret),
      });
      expect([200, 201]).toContain(link.statusCode);
      const viewToken = link.json().url.split('/view/')[1];
      expect(viewToken).toBeTruthy();

      // viewer
      const view = await app.inject({ method: 'GET', url: `/view/${viewToken}` });
      expect(view.statusCode).toBe(200);
      expect(view.body).toContain('data-section-id');

      // pay action → outcome achieved
      const pay = await app.inject({
        method: 'POST',
        url: `/api/view/${viewToken}/actions`,
        payload: { action: 'pay', payload: { amount: 245.1 } },
      });
      expect([200, 201]).toContain(pay.statusCode);

      const com = await app.inject({
        method: 'GET',
        url: `/v1/communications/${communicationId}`,
        headers: auth(authorSecret),
      });
      expect(com.json().outcome?.achieved).toBe(true);

      // evidence pack with intact event chain
      const pack = await app.inject({
        method: 'GET',
        url: `/v1/archive/${communicationId}/evidence-pack`,
        headers: auth(adminSecret),
      });
      expect(pack.statusCode).toBe(200);
      expect(pack.json().eventChain.intact).toBe(true);
    } finally {
      await app.close();
      store.close();
    }
  });
});
