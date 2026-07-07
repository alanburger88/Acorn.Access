import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configFromEnv, createBaseContext, type PlatformContext } from '../src/kernel/context.js';
import type { RequestCtx, WebhookSubscription } from '../src/kernel/contracts.js';
import { createWebhookService } from '../src/domains/webhooks/index.js';

describe('webhooks domain', () => {
  const tenantId = 'ten_WEBHOOKTEST';
  const rctx: RequestCtx = {
    tenantId,
    actorId: 'usr_test',
    roles: ['tenant-admin'],
    keyId: 'key_test',
  };

  let ctx: PlatformContext;
  let server: Server;
  let url: string;
  let responseStatus = 200;
  const received: { headers: IncomingHttpHeaders; body: string }[] = [];
  let sub: WebhookSubscription;

  beforeAll(async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'acorn-'));
    ctx = createBaseContext(
      configFromEnv({ dataDir: tmp, outboxDir: join(tmp, 'outbox'), baseUrl: 'http://test.local' }),
    );
    ctx.services.webhooks = createWebhookService(ctx);

    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = responseStatus;
        res.setHeader('content-type', 'application/json');
        res.end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no server port');
    url = `http://127.0.0.1:${address.port}/hook`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('delivers a matching event with a verifiable HMAC signature', async () => {
    sub = ctx.services.webhooks.subscribe(rctx, { url, events: ['com.acorn.test.*'] });
    expect(sub.id).toMatch(/^whk_/);
    expect(sub.active).toBe(true);
    expect(sub.secret).toBeTruthy();

    // bus.emit awaits handlers sequentially, so awaiting publish is enough
    await ctx.publish({
      type: 'com.acorn.test.ping',
      tenantId,
      source: '/test',
      subject: 'sub_ject',
      data: { hello: 'world' },
    });

    expect(received).toHaveLength(1);
    const req = received[0]!;
    expect(req.headers['content-type']).toBe('application/json');
    expect(req.headers['x-acorn-event-type']).toBe('com.acorn.test.ping');

    // recompute the HMAC over the exact received body with the sub's secret
    const expectedSig =
      'sha256=' + createHmac('sha256', sub.secret).update(req.body).digest('hex');
    expect(req.headers['x-acorn-signature']).toBe(expectedSig);

    const event = JSON.parse(req.body) as { type: string; data: { hello: string } };
    expect(event.type).toBe('com.acorn.test.ping');
    expect(event.data.hello).toBe('world');

    const rows = ctx.services.webhooks.deliveries(rctx, sub.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('delivered');
    expect(rows[0]!.attempts).toBe(1);
    expect(rows[0]!.lastStatusCode).toBe(200);
    expect(rows[0]!.eventType).toBe('com.acorn.test.ping');
  });

  it('does not deliver events that match no subscription pattern', async () => {
    await ctx.publish({
      type: 'com.acorn.other.x',
      tenantId,
      source: '/test',
      data: {},
    });
    expect(received).toHaveLength(1); // unchanged
    expect(ctx.services.webhooks.deliveries(rctx)).toHaveLength(1);
  });

  it('marks the delivery failed after 3 attempts against a 500 endpoint, then replays', async () => {
    responseStatus = 500;
    await ctx.publish({
      type: 'com.acorn.test.broken',
      tenantId,
      source: '/test',
      data: { n: 1 },
    });

    const failed = ctx.services.webhooks
      .deliveries(rctx, sub.id)
      .find((r) => r.eventType === 'com.acorn.test.broken');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('failed');
    expect(failed!.attempts).toBe(3);
    expect(failed!.lastStatusCode).toBe(500);
    expect(failed!.lastError).toContain('500');

    // endpoint recovers — replay re-dispatches the stored event
    responseStatus = 200;
    const before = received.length;
    const replayed = await ctx.services.webhooks.replay(rctx, failed!.id);
    expect(replayed.id).toBe(failed!.id);
    expect(replayed.status).toBe('delivered');
    expect(replayed.attempts).toBe(1);
    expect(received.length).toBe(before + 1);
    const replayEvent = JSON.parse(received.at(-1)!.body) as { type: string };
    expect(replayEvent.type).toBe('com.acorn.test.broken');
  });

  it('unsubscribe deactivates the subscription and stops fan-out, keeping history', async () => {
    ctx.services.webhooks.unsubscribe(rctx, sub.id);
    const listed = ctx.services.webhooks.list(rctx);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.active).toBe(false);

    const before = ctx.services.webhooks.deliveries(rctx).length;
    await ctx.publish({
      type: 'com.acorn.test.after-unsubscribe',
      tenantId,
      source: '/test',
      data: {},
    });
    expect(ctx.services.webhooks.deliveries(rctx)).toHaveLength(before);
  });

  it('replay of an unknown delivery id throws notFound', async () => {
    await expect(ctx.services.webhooks.replay(rctx, 'whd_missing')).rejects.toMatchObject({
      status: 404,
    });
  });
});
