/**
 * MCP tool catalog for Acorn OS — the ALLOW-LIST of capabilities an
 * AI agent may invoke (platform/07 §5, platform/06 least-privilege model).
 *
 * Security model:
 * - The server is constructed with a RequestCtx derived from an API key, so
 *   every tool call is tenant-scoped and role-checked exactly like the REST
 *   layer (tenant-admin passes every role check, mirroring kernel/http.ts).
 * - Tools are read-mostly (risk tier T1) plus one sandboxed draft tool (T2).
 *   There is deliberately NO `initiate_delivery` / send tool here: delivery
 *   initiation is a T3 sensitive action with real-world effect that requires
 *   a human approval gate per platform/06 — agents must never trigger it
 *   directly. It is excluded from the allow-list rather than gated in-band.
 * - Every call (success, failure, or denial) is audited to the tamper-evident
 *   event log as `com.acorn.mcp.tool-invoked`.
 */
import { PlatformError } from '../kernel/errors.js';
import type { PlatformContext } from '../kernel/context.js';
import type { CommunicationStatus, RequestCtx, Role } from '../kernel/contracts.js';

export const AUDIT_EVENT_TYPE = 'com.acorn.mcp.tool-invoked';
const SOURCE = '/mcp';

// ---------------------------------------------------------------------------
// Minimal JSON Schema (all tool inputs are flat objects of strings)
// ---------------------------------------------------------------------------

export interface JsonSchemaProperty {
  type: 'string';
  description?: string;
  enum?: string[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

/** Hand-rolled validation of tool arguments against the tool's inputSchema. */
export function validateInput(schema: JsonSchema, input: unknown): string[] {
  const errors: string[] = [];
  const value = input ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    return ['arguments must be a JSON object'];
  }
  const args = value as Record<string, unknown>;
  for (const name of schema.required ?? []) {
    if (args[name] === undefined || args[name] === null || args[name] === '') {
      errors.push(`missing required property: ${name}`);
    }
  }
  for (const [name, provided] of Object.entries(args)) {
    if (provided === undefined) continue;
    const prop = schema.properties[name];
    if (!prop) {
      errors.push(`unknown property: ${name}`);
      continue;
    }
    if (typeof provided !== 'string') {
      errors.push(`property ${name} must be a string`);
      continue;
    }
    if (prop.enum && !prop.enum.includes(provided)) {
      errors.push(`property ${name} must be one of: ${prop.enum.join(', ')}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Tool catalog
// ---------------------------------------------------------------------------

export interface McpToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Least privilege: any of these roles (tenant-admin always passes). */
  requiredRoles?: Role[];
  /** Primary entity id for the audit event subject. */
  subject?: (args: Record<string, string>) => string | undefined;
  handler: (
    ctx: PlatformContext,
    rctx: RequestCtx,
    args: Record<string, string>,
  ) => Promise<unknown> | unknown;
}

const noInput: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };

const COMMUNICATION_STATUSES: CommunicationStatus[] = [
  'composed',
  'rendered',
  'delivering',
  'delivered',
  'failed',
  'archived',
];

const TOOLS: ToolSpec[] = [
  {
    name: 'list_templates',
    description: 'List the tenant\'s communication templates (id, key, name, published).',
    inputSchema: noInput,
    handler: (ctx, rctx) =>
      ctx.services.templates.listTemplates(rctx).map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        published: Boolean(t.publishedVersionId),
      })),
  },
  {
    name: 'search_content',
    description: 'Full-text search over the tenant\'s managed content library (clauses, disclosures, FAQs...).',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search terms' } },
      required: ['query'],
      additionalProperties: false,
    },
    handler: (ctx, rctx, args) =>
      ctx.services.content.search(rctx.tenantId, args.query!).map((hit) => ({
        id: hit.content.id,
        key: hit.content.key,
        type: hit.content.type,
        title: hit.content.title,
        version: hit.version.version,
        status: hit.version.status,
        score: hit.score,
      })),
  },
  {
    name: 'search_communications',
    description: 'Search composed communications by customer, template, and/or status. Returns summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Filter by customer id (cus_...)' },
        templateId: { type: 'string', description: 'Filter by template id (tpl_...)' },
        status: { type: 'string', enum: COMMUNICATION_STATUSES },
      },
      additionalProperties: false,
    },
    subject: (args) => args.customerId ?? args.templateId,
    handler: (ctx, rctx, args) =>
      ctx.services.composition
        .listCommunications(rctx.tenantId, {
          customerId: args.customerId,
          templateId: args.templateId,
          status: args.status as CommunicationStatus | undefined,
        })
        .map((c) => ({
          id: c.id,
          title: c.composed.title,
          customerName: c.composed.customerName,
          status: c.status,
          outcome: c.outcome,
        })),
  },
  {
    name: 'get_communication',
    description: 'Get one communication: status, composed title and section titles, outcome, artifact formats.',
    inputSchema: {
      type: 'object',
      properties: { communicationId: { type: 'string', description: 'com_... id' } },
      required: ['communicationId'],
      additionalProperties: false,
    },
    subject: (args) => args.communicationId,
    handler: (ctx, rctx, args) => {
      const communication = ctx.services.composition.getCommunication(
        rctx.tenantId,
        args.communicationId!,
      );
      if (!communication) {
        throw new PlatformError('not-found', 404, `communication ${args.communicationId} not found`);
      }
      const artifacts = ctx.services.composition.listArtifacts(rctx.tenantId, communication.id);
      return {
        id: communication.id,
        status: communication.status,
        customerId: communication.customerId,
        templateId: communication.templateId,
        title: communication.composed.title,
        sections: communication.composed.sections.map((s) => ({ id: s.id, title: s.title })),
        outcome: communication.outcome,
        artifacts: artifacts.map((a) => a.format),
      };
    },
  },
  {
    name: 'explain_communication',
    description:
      'Ask a grounded question about a communication. Answers come ONLY from the composed document ' +
      'and approved FAQs via the governed AI gateway (full invocation audit); low confidence escalates to a human.',
    inputSchema: {
      type: 'object',
      properties: {
        communicationId: { type: 'string', description: 'com_... id' },
        question: { type: 'string', description: 'Natural-language question about the document' },
      },
      required: ['communicationId', 'question'],
      additionalProperties: false,
    },
    subject: (args) => args.communicationId,
    // GROUNDED by construction: viewer.ask builds passages from the composed
    // document + approved FAQ content and routes through ctx.services.ai
    // (the single audited model choke point) — never free-form generation.
    handler: (ctx, rctx, args) =>
      ctx.services.viewer.ask({
        tenantId: rctx.tenantId,
        communicationId: args.communicationId!,
        question: args.question!,
      }),
  },
  {
    name: 'get_customer_timeline',
    description: 'Chronological event timeline for a customer (compositions, deliveries, views, actions).',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string', description: 'cus_... id' } },
      required: ['customerId'],
      additionalProperties: false,
    },
    subject: (args) => args.customerId,
    handler: (ctx, rctx, args) =>
      ctx.services.analytics.customerTimeline(rctx.tenantId, args.customerId!),
  },
  {
    name: 'get_delivery_status',
    description: 'Delivery attempts for a communication: channel, status, attempt number, failover source.',
    inputSchema: {
      type: 'object',
      properties: { communicationId: { type: 'string', description: 'com_... id' } },
      required: ['communicationId'],
      additionalProperties: false,
    },
    subject: (args) => args.communicationId,
    handler: (ctx, rctx, args) => ({
      communicationId: args.communicationId,
      attempts: ctx.services.delivery
        .listAttempts(rctx.tenantId, args.communicationId!)
        .map((a) => ({
          channel: a.channel,
          status: a.status,
          attempt: a.attempt,
          failoverFrom: a.failoverFrom,
        })),
    }),
  },
  {
    name: 'get_analytics_overview',
    description: 'Tenant-wide outcome metrics: delivery, engagement, outcome rate, call-deflection proxy.',
    inputSchema: noInput,
    handler: (ctx, rctx) => ctx.services.analytics.overview(rctx.tenantId),
  },
  {
    name: 'search_archive',
    description: 'Search the immutable statement-of-record archive by customer and/or template.',
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', description: 'Filter by customer id (cus_...)' },
        templateId: { type: 'string', description: 'Filter by template id (tpl_...)' },
      },
      additionalProperties: false,
    },
    subject: (args) => args.customerId ?? args.templateId,
    handler: (ctx, rctx, args) =>
      ctx.services.archive
        .search(rctx.tenantId, { customerId: args.customerId, templateId: args.templateId })
        .map((r) => ({
          communicationId: r.communicationId,
          storedAt: r.storedAt,
          retentionClass: r.retentionClass,
          legalHold: r.legalHold,
        })),
  },
  {
    name: 'generate_evidence_pack',
    description:
      'Generate the compliance evidence pack for an archived communication (proof of content, delivery, ' +
      'access, action, version, AI changes). Requires auditor, compliance-approver, or tenant-admin role.',
    inputSchema: {
      type: 'object',
      properties: { communicationId: { type: 'string', description: 'com_... id' } },
      required: ['communicationId'],
      additionalProperties: false,
    },
    // Least privilege: mirrors the REST evidence-pack route's role gate.
    requiredRoles: ['auditor', 'compliance-approver'],
    subject: (args) => args.communicationId,
    handler: (ctx, rctx, args) =>
      ctx.services.archive.evidencePack(rctx.tenantId, args.communicationId!),
  },
  {
    name: 'check_template_accessibility',
    description: 'Run the accessibility gate against a template version and return the report.',
    inputSchema: {
      type: 'object',
      properties: { templateVersionId: { type: 'string', description: 'tpv_... id' } },
      required: ['templateVersionId'],
      additionalProperties: false,
    },
    subject: (args) => args.templateVersionId,
    handler: (ctx, rctx, args) =>
      ctx.services.templates.checkAccessibility(rctx.tenantId, args.templateVersionId!),
  },
  {
    name: 'draft_content',
    description:
      'Draft or improve content text via the governed AI gateway. Risk tier T2: the output is a DRAFT ' +
      'ONLY and must pass human review and compliance approval before any use.',
    inputSchema: {
      type: 'object',
      properties: {
        instruction: { type: 'string', description: 'What to draft or how to improve the base text' },
        baseText: { type: 'string', description: 'Optional existing text to improve' },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
    handler: async (ctx, rctx, args) => {
      const { text, invocationId } = await ctx.services.ai.draft({
        tenantId: rctx.tenantId,
        instruction: args.instruction!,
        baseText: args.baseText,
      });
      return {
        notice:
          'DRAFT ONLY — this text requires human review and compliance approval before any use ' +
          '(platform/06 human-review gates). Submit it through the content approval workflow.',
        draft: text,
        invocationId,
      };
    },
  },
];

/** Tool definitions as exposed by the MCP `tools/list` method. */
export function listToolDefinitions(): {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

const hasAnyRole = (rctx: RequestCtx, roles: Role[]): boolean =>
  rctx.roles.includes('tenant-admin') || roles.some((r) => rctx.roles.includes(r));

const textResult = (text: string, isError?: boolean): McpToolResult => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

/**
 * Execute one allow-listed tool. Handler failures (PlatformError or thrown)
 * become an in-band isError result — NEVER a protocol failure. Every call,
 * including denials and failures, is written to the audit log.
 */
export async function callTool(
  ctx: PlatformContext,
  rctx: RequestCtx,
  name: string,
  rawArgs: unknown,
): Promise<McpToolResult> {
  const audit = async (ok: boolean, summary: string, subject?: string): Promise<void> => {
    await ctx.publish({
      type: AUDIT_EVENT_TYPE,
      tenantId: rctx.tenantId,
      source: SOURCE,
      subject,
      data: {
        tool: name,
        actorId: rctx.actorId,
        keyId: rctx.keyId,
        ok,
        summary: summary.slice(0, 140),
      },
    });
  };

  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    await audit(false, `unknown tool: ${name}`);
    return textResult(
      `error: unknown tool '${name}'. Only allow-listed tools may be called; use tools/list.`,
      true,
    );
  }

  const args =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, string>)
      : {};
  const subject = tool.subject?.(args);

  if (tool.requiredRoles && !hasAnyRole(rctx, tool.requiredRoles)) {
    const message =
      `permission denied: ${name} requires one of roles: ` +
      `${[...tool.requiredRoles, 'tenant-admin'].join(', ')} (you have: ${rctx.roles.join(', ')})`;
    await audit(false, message, subject);
    return textResult(`error: ${message}`, true);
  }

  const validationErrors = validateInput(tool.inputSchema, rawArgs);
  if (validationErrors.length > 0) {
    const message = `invalid input: ${validationErrors.join('; ')}`;
    await audit(false, message, subject);
    return textResult(`error: ${message}`, true);
  }

  try {
    const result = await tool.handler(ctx, rctx, args);
    await audit(true, JSON.stringify(result) ?? 'null', subject);
    return textResult(JSON.stringify(result, null, 2));
  } catch (err) {
    const message =
      err instanceof PlatformError
        ? `${err.code}: ${err.message}`
        : String((err as Error | undefined)?.message ?? err);
    await audit(false, message, subject);
    return textResult(`error: ${message}`, true);
  }
}
