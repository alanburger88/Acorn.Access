import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createBaseContext, configFromEnv, type PlatformContext } from '../src/kernel/context.js';
import { PlatformError } from '../src/kernel/errors.js';
import { newId } from '../src/kernel/ids.js';
import type {
  AccessEvent,
  Communication,
  CommunicationStatus,
  DataContract,
  Experiment,
  RequestCtx,
  TemplateBlock,
  TemplateVersion,
} from '../src/kernel/contracts.js';
import { createContentService } from '../src/domains/content/index.js';
import { createTemplateService } from '../src/domains/templates/index.js';
import { createExperimentService } from '../src/domains/experiments/index.js';

const TENANT = 'ten_experiments_test';

const author: RequestCtx = {
  tenantId: TENANT,
  actorId: 'usr_author',
  roles: ['business-author', 'designer'],
  keyId: 'key_author',
};

const contract: DataContract = {
  fields: [{ path: 'account.balanceDue', type: 'number', required: true }],
  sample: { account: { balanceDue: 42.5 } },
};

// Simple template WITHOUT content-refs so publish needs no approved content.
const goodBlocks: TemplateBlock[] = [
  { kind: 'heading', level: 1, text: 'Your Bill' },
  {
    kind: 'section',
    id: 'summary',
    title: 'Summary',
    explanation: 'What you owe.',
    blocks: [
      { kind: 'field-row', label: 'Balance due', value: '{{account.balanceDue|currency}}' },
      { kind: 'action', action: 'pay', label: 'Pay now' },
    ],
  },
];

function seedCommunication(
  ctx: PlatformContext,
  args: {
    templateId: string;
    templateVersionId: string;
    customerId: string;
    status: CommunicationStatus;
    createdAt: string;
    outcomeAchieved?: boolean;
    viewed?: boolean;
  },
): Communication {
  const communication: Communication = {
    id: newId('com'),
    tenantId: TENANT,
    templateId: args.templateId,
    templateVersionId: args.templateVersionId,
    customerId: args.customerId,
    status: args.status,
    dataSnapshotKey: `${TENANT}/snapshot`,
    dataSnapshotHash: 'deadbeef',
    composed: {
      title: 'Your Bill',
      brand: { name: 'Test', primaryColor: '#111111', accentColor: '#222222', logoText: 'T' },
      customerName: 'Test Customer',
      locale: 'en',
      intendedOutcome: 'payment_completed',
      sections: [],
      contentVersionIds: [],
    },
    createdAt: args.createdAt,
    ...(args.outcomeAchieved ? { outcome: { achieved: true, at: args.createdAt, via: 'pay' } } : {}),
  };
  ctx.store.collection<Communication>('communications').put(communication);
  if (args.viewed) {
    const access: AccessEvent = {
      id: newId('acc'),
      tenantId: TENANT,
      communicationId: communication.id,
      customerId: args.customerId,
      linkId: newId('lnk'),
      at: args.createdAt,
      authMethod: 'link',
    };
    ctx.store.collection<AccessEvent>('accessEvents').put(access);
  }
  return communication;
}

describe('experiments domain', () => {
  let ctx: PlatformContext;
  let templateId: string;
  let v1: TemplateVersion;
  let v2: TemplateVersion;
  let foreignVersionId: string;
  let experiment: Experiment;

  beforeAll(() => {
    ctx = createBaseContext(configFromEnv({ dataDir: mkdtempSync(join(tmpdir(), 'acorn-')) }));
    ctx.services.content = createContentService(ctx);
    ctx.services.templates = createTemplateService(ctx);
    ctx.services.experiments = createExperimentService(ctx);

    // Template with published v1 and draft v2 (both accessibility-passing).
    const created = ctx.services.templates.createTemplate(author, {
      key: 'utility-bill',
      name: 'Utility Bill',
      communicationType: 'bill',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'payment_completed',
      blocks: goodBlocks,
    });
    templateId = created.template.id;
    v1 = ctx.services.templates.publish(author, created.version.id); // 'designer' may publish
    v2 = ctx.services.templates.newVersion(author, templateId, {
      channels: { email: { subject: 'A better bill' } },
    });

    // A second template whose version must be rejected as a foreign variant.
    const other = ctx.services.templates.createTemplate(author, {
      key: 'other-notice',
      name: 'Other Notice',
      communicationType: 'notice',
      brandId: 'brd_test',
      dataContract: contract,
      intendedOutcome: 'understood',
      blocks: goodBlocks,
    });
    foreignVersionId = other.version.id;
  });

  it('create validates variants and template ownership', () => {
    // fewer than 2 variants
    expect(() =>
      ctx.services.experiments.create(author, {
        templateId,
        name: 'One variant',
        variants: [{ versionId: v1.id, weight: 1 }],
      }),
    ).toThrowError(/at least 2 variants/);

    // versionId belonging to another template
    expect(() =>
      ctx.services.experiments.create(author, {
        templateId,
        name: 'Foreign variant',
        variants: [
          { versionId: v1.id, weight: 1 },
          { versionId: foreignVersionId, weight: 1 },
        ],
      }),
    ).toThrowError(/not a version of template/);

    // non-positive weight
    expect(() =>
      ctx.services.experiments.create(author, {
        templateId,
        name: 'Zero weight',
        variants: [
          { versionId: v1.id, weight: 0 },
          { versionId: v2.id, weight: 1 },
        ],
      }),
    ).toThrowError(/weight must be > 0/);

    // happy path — created BEFORE communications are seeded so that
    // createdAt ordering counts them as assignments
    experiment = ctx.services.experiments.create(author, {
      templateId,
      name: 'Subject line test',
      variants: [
        { versionId: v1.id, weight: 1 },
        { versionId: v2.id, weight: 1 },
      ],
    });
    expect(experiment.id).toMatch(/^exp_/);
    expect(experiment.status).toBe('running');

    // at most one running experiment per template
    try {
      ctx.services.experiments.create(author, {
        templateId,
        name: 'Second concurrent',
        variants: [
          { versionId: v1.id, weight: 1 },
          { versionId: v2.id, weight: 1 },
        ],
      });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformError);
      expect((err as PlatformError).status).toBe(409);
    }
  });

  it('selectVersion is deterministic and covers both variants across customers', () => {
    const first = ctx.services.experiments.selectVersion(TENANT, templateId, 'cus_stable');
    expect(first).toBeDefined();
    for (let i = 0; i < 20; i++) {
      expect(ctx.services.experiments.selectVersion(TENANT, templateId, 'cus_stable')?.id).toBe(
        first!.id,
      );
    }

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const version = ctx.services.experiments.selectVersion(TENANT, templateId, `cus_${i}`);
      expect([v1.id, v2.id]).toContain(version!.id);
      seen.add(version!.id);
    }
    expect(seen).toEqual(new Set([v1.id, v2.id]));
  });

  it('results counts assigned/delivered/viewed/outcomes per variant', () => {
    // seeded strictly AFTER experiment.createdAt so they count as assignments
    const after = new Date(new Date(experiment.createdAt).getTime() + 1000).toISOString();
    // a backdated communication BEFORE the experiment must be excluded
    const before = new Date(new Date(experiment.createdAt).getTime() - 1000).toISOString();
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v1.id,
      customerId: 'cus_old',
      status: 'delivered',
      createdAt: before,
      outcomeAchieved: true,
      viewed: true,
    });

    // v1: 3 assigned, 2 delivered (delivered+archived), 1 viewed, 1 outcome
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v1.id,
      customerId: 'cus_a',
      status: 'delivered',
      createdAt: after,
      outcomeAchieved: true,
      viewed: true,
    });
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v1.id,
      customerId: 'cus_b',
      status: 'archived',
      createdAt: after,
    });
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v1.id,
      customerId: 'cus_c',
      status: 'composed',
      createdAt: after,
    });

    // v2: 2 assigned, 2 delivered, 1 viewed, 2 outcomes
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v2.id,
      customerId: 'cus_d',
      status: 'delivered',
      createdAt: after,
      outcomeAchieved: true,
      viewed: true,
    });
    seedCommunication(ctx, {
      templateId,
      templateVersionId: v2.id,
      customerId: 'cus_e',
      status: 'delivered',
      createdAt: after,
      outcomeAchieved: true,
    });

    const results = ctx.services.experiments.results(author, experiment.id);
    expect(results.map((r) => r.versionId)).toEqual([v1.id, v2.id]); // variant order
    const [r1, r2] = results;
    expect(r1).toEqual({
      versionId: v1.id,
      assigned: 3,
      delivered: 2,
      viewed: 1,
      outcomes: 1,
      outcomeRate: 1 / 3,
    });
    expect(r2).toEqual({
      versionId: v2.id,
      assigned: 2,
      delivered: 2,
      viewed: 1,
      outcomes: 2,
      outcomeRate: 1,
    });
  });

  it('conclude blocks a non-variant winner, else picks the highest outcomeRate', () => {
    // non-variant winner rejected (experiment stays running)
    expect(() =>
      ctx.services.experiments.conclude(author, experiment.id, foreignVersionId),
    ).toThrowError(/not a variant/);
    expect(ctx.services.experiments.get(author, experiment.id).status).toBe('running');

    // winner omitted: v2 (outcomeRate 1) beats v1 (1/3)
    const concluded = ctx.services.experiments.conclude(author, experiment.id);
    expect(concluded.status).toBe('concluded');
    expect(concluded.winnerVersionId).toBe(v2.id);
    expect(concluded.concludedAt).toBeTruthy();

    // concluding does NOT auto-publish the winner — v2 stays a draft behind
    // the template publish gate
    expect(ctx.services.templates.getVersion(TENANT, v2.id)?.status).toBe('draft');

    // a concluded experiment no longer affects assignment
    expect(ctx.services.experiments.selectVersion(TENANT, templateId, 'cus_stable')).toBeUndefined();

    // concluding twice conflicts
    expect(() => ctx.services.experiments.conclude(author, experiment.id)).toThrowError(
      PlatformError,
    );
  });

  it('rejects a variant version that fails the accessibility gate', () => {
    // v3: a section missing its title — an accessibility error
    const v3 = ctx.services.templates.newVersion(author, templateId, {
      blocks: [
        { kind: 'heading', level: 1, text: 'Your Bill' },
        {
          kind: 'section',
          id: 'untitled',
          title: '',
          explanation: 'Broken section.',
          blocks: [{ kind: 'field-row', label: 'Balance due', value: '{{account.balanceDue}}' }],
        },
      ],
    });
    // experiments must not smuggle inaccessible versions past the publish gate
    expect(() =>
      ctx.services.experiments.create(author, {
        templateId,
        name: 'Inaccessible variant',
        variants: [
          { versionId: v1.id, weight: 1 },
          { versionId: v3.id, weight: 1 },
        ],
      }),
    ).toThrowError(/accessibility/);
  });
});
