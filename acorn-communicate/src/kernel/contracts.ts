/**
 * Acorn Communicate — shared entity types and domain service contracts.
 *
 * This file is the coordination backbone between bounded contexts (see
 * platform/04-architecture.md and platform/05-data-models.md). Domain
 * implementations live in src/domains/<context>/ and MUST NOT modify this
 * file; domain-private types belong in the domain's own folder.
 */

// ---------------------------------------------------------------------------
// Tenancy, identity, access
// ---------------------------------------------------------------------------

export interface Tenant {
  id: string; // ten_
  tenantId: string; // == id (self-scoped, keeps Collection<T> uniform)
  name: string;
  industry?: string;
  createdAt: string;
  settings: {
    defaultLocale: string;
    quietHours?: { start: string; end: string }; // "21:00" local
    aiEnabled: boolean;
    /** defer deliveries beyond this many per customer per UTC day (unset = uncapped) */
    maxDeliveriesPerCustomerPerDay?: number;
  };
}

export interface Brand {
  id: string; // brd_
  tenantId: string;
  name: string;
  primaryColor: string;
  accentColor: string;
  logoText: string;
  fromEmail: string;
  fromSms: string;
}

export type Role =
  | 'tenant-admin'
  | 'business-author'
  | 'designer'
  | 'compliance-approver'
  | 'operator'
  | 'developer'
  | 'auditor'
  | 'service-agent';

export interface ApiKey {
  id: string; // key_
  tenantId: string;
  name: string;
  /** sha256 of the secret; the secret itself is returned once at creation. */
  secretHash: string;
  roles: Role[];
  actorId: string; // usr_ of the human/service this key acts as
  createdAt: string;
  revokedAt?: string;
}

export interface RequestCtx {
  tenantId: string;
  actorId: string;
  roles: Role[];
  keyId: string;
}

// ---------------------------------------------------------------------------
// Customers, consent, preferences
// ---------------------------------------------------------------------------

export type Channel = 'email' | 'sms' | 'secure-link' | 'webhook' | 'print';

export interface Customer {
  id: string; // cus_
  tenantId: string;
  externalRef?: string;
  name: string;
  email?: string;
  phone?: string;
  locale: string;
  address?: { line1: string; city: string; region: string; postalCode: string; country: string };
  createdAt: string;
}

export interface ConsentRecord {
  id: string; // cns_
  tenantId: string;
  customerId: string;
  channel: Channel;
  purpose: 'transactional' | 'marketing';
  granted: boolean;
  source: string;
  recordedAt: string;
}

export interface PreferenceRecord {
  id: string; // prf_
  tenantId: string;
  customerId: string;
  /** Ordered channel priority; delivery fails over down this list. */
  channelPriority: Channel[];
  language?: string;
  paperless: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Content management
// ---------------------------------------------------------------------------

export type ContentType = 'block' | 'clause' | 'disclosure' | 'faq' | 'tooltip';
export type ApprovalStatus = 'draft' | 'in-review' | 'approved' | 'rejected' | 'retired';

export interface ContentObject {
  id: string; // cnt_
  tenantId: string;
  key: string; // stable business key, e.g. "disclosure.efunds"
  type: ContentType;
  title: string;
  ownerId: string;
  createdAt: string;
  /** id of the currently approved version, if any */
  approvedVersionId?: string;
  latestVersionId?: string;
}

export interface ContentVersion {
  id: string; // cnv_
  tenantId: string;
  contentId: string;
  version: number;
  body: string; // markdown-lite text; {{path}} interpolation allowed
  locale: string;
  status: ApprovalStatus;
  authorId: string;
  createdAt: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
  effectiveFrom?: string;
  expiresAt?: string;
  /** advisory scores computed at save time */
  scores?: { readingLevel: number; sentiment: 'negative' | 'neutral' | 'positive' };
  aiAssisted: boolean;
}

// ---------------------------------------------------------------------------
// Templates and the document AST
// ---------------------------------------------------------------------------

export interface Rule {
  path: string;
  op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'contains';
  value?: unknown;
}

export type ValueFormat = 'text' | 'currency' | 'number' | 'date';

export type TemplateBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'text'; text: string; condition?: Rule }
  | { kind: 'summary'; title: string; text: string }
  | { kind: 'field-row'; label: string; value: string; format?: ValueFormat; condition?: Rule }
  | {
      kind: 'table';
      title?: string;
      itemsPath: string;
      columns: { header: string; valuePath: string; align?: 'left' | 'right'; format?: ValueFormat }[];
    }
  | {
      kind: 'section';
      id: string;
      title: string;
      collapsible?: boolean;
      condition?: Rule;
      /** plain-language explanation surfaced as in-document help + assistant grounding */
      explanation?: string;
      blocks: TemplateBlock[];
    }
  | { kind: 'content-ref'; contentKey: string; condition?: Rule }
  | {
      kind: 'action';
      action: 'pay' | 'dispute' | 'update-details' | 'contact' | 'download';
      label: string;
      condition?: Rule;
    }
  | { kind: 'divider' };

export interface DataContractField {
  path: string; // dot path, e.g. "account.balanceDue"
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  required: boolean;
  description?: string;
  pii?: boolean;
}

export interface DataContract {
  fields: DataContractField[];
  sample: Record<string, unknown>;
}

export type IntendedOutcome =
  | 'payment_completed'
  | 'renewal_completed'
  | 'dispute_resolved'
  | 'details_updated'
  | 'understood' // viewed without escalation
  | 'self_served';

export interface Template {
  id: string; // tpl_
  tenantId: string;
  key: string; // e.g. "credit-card-statement"
  name: string;
  communicationType: string; // statement | bill | notice | letter | welcome ...
  brandId: string;
  ownerId: string;
  createdAt: string;
  publishedVersionId?: string;
  latestVersionId?: string;
}

export interface TemplateVersion {
  id: string; // tpv_
  tenantId: string;
  templateId: string;
  version: number;
  status: ApprovalStatus | 'published';
  dataContract: DataContract;
  intendedOutcome: IntendedOutcome;
  /** master body composed once; channel renderers derive from it */
  blocks: TemplateBlock[];
  /** channel-specific overrides */
  channels: {
    email?: { subject: string; preheader?: string };
    sms?: { text: string }; // {{path}} interpolation; must include {{link}}
  };
  authorId: string;
  createdAt: string;
  publishedAt?: string;
  publishedBy?: string;
  aiAssisted: boolean;
  /** result of the last accessibility gate run (publication blocks on fail) */
  accessibility?: AccessibilityReport;
}

export interface AccessibilityIssue {
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
  blockPath?: string;
}

export interface AccessibilityReport {
  checkedAt: string;
  passed: boolean;
  issues: AccessibilityIssue[];
}

// ---------------------------------------------------------------------------
// Composition, rendering, communication lifecycle (event-sourced)
// ---------------------------------------------------------------------------

export type RenderFormat = 'html' | 'pdf' | 'email-html' | 'sms-text' | 'text';

/** A resolved (data-bound) block — same shapes as TemplateBlock but with values substituted. */
export interface ComposedSection {
  id: string;
  title: string;
  collapsible: boolean;
  explanation?: string;
  lines: ComposedLine[];
}

export type ComposedLine =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'summary'; title: string; text: string }
  | { kind: 'field-row'; label: string; value: string }
  | {
      kind: 'table';
      title?: string;
      headers: string[];
      aligns: ('left' | 'right')[];
      rows: string[][];
    }
  | { kind: 'content'; contentKey: string; contentVersionId: string; title: string; text: string }
  | { kind: 'action'; action: 'pay' | 'dispute' | 'update-details' | 'contact' | 'download'; label: string }
  | { kind: 'divider' };

/** Abstract Communication Document — "compose once, render many". */
export interface ComposedDocument {
  title: string;
  brand: Pick<Brand, 'name' | 'primaryColor' | 'accentColor' | 'logoText'>;
  customerName: string;
  locale: string;
  intendedOutcome: IntendedOutcome;
  sections: ComposedSection[];
  /** content versions pinned into this composition (chain of custody) */
  contentVersionIds: string[];
}

export type CommunicationStatus =
  | 'composed'
  | 'rendered'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'archived';

export interface Communication {
  id: string; // com_
  tenantId: string;
  templateId: string;
  templateVersionId: string;
  customerId: string;
  status: CommunicationStatus;
  /** sha256 of the input data snapshot (snapshot itself is in the object store) */
  dataSnapshotKey: string;
  dataSnapshotHash: string;
  composed: ComposedDocument;
  createdAt: string;
  requestedChannels?: Channel[];
  journeyRef?: string;
  outcome?: { achieved: boolean; at?: string; via?: string };
}

export interface RenderArtifact {
  id: string; // art_
  tenantId: string;
  communicationId: string;
  format: RenderFormat;
  objectKey: string;
  sha256: string;
  size: number;
  contentType: string;
  renderedAt: string;
  rendererVersion: string;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'queued' | 'scheduled' | 'sent' | 'delivered' | 'bounced' | 'failed';

export interface DeliveryAttempt {
  id: string; // dlv_
  tenantId: string;
  communicationId: string;
  customerId: string;
  channel: Channel;
  provider: string;
  to: string;
  status: DeliveryStatus;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  providerMessageId?: string;
  failureReason?: string;
  /** set when this attempt was a failover from another channel */
  failoverFrom?: Channel;
  /** status 'scheduled': when the deferred delivery should execute */
  scheduledFor?: string;
  /** why the delivery was deferred (audit/ops visibility) */
  deferReason?: 'explicit-schedule' | 'quiet-hours' | 'frequency-cap';
}

export interface SecureLink {
  id: string; // lnk_
  tenantId: string;
  communicationId: string;
  customerId: string;
  token: string;
  expiresAt: string;
  /** when set, viewer must present this one-time code (simulated OTP) */
  otpCode?: string;
  createdAt: string;
  revokedAt?: string;
}

// ---------------------------------------------------------------------------
// Viewer: access, interaction, actions
// ---------------------------------------------------------------------------

export interface AccessEvent {
  id: string; // acc_
  tenantId: string;
  communicationId: string;
  customerId: string;
  linkId: string;
  at: string;
  authMethod: 'link' | 'link+otp';
  userAgent?: string;
}

export interface InteractionEvent {
  id: string; // ixn_
  tenantId: string;
  communicationId: string;
  customerId: string;
  at: string;
  kind: 'section-viewed' | 'section-expanded' | 'faq-searched' | 'assistant-asked' | 'download';
  detail?: string; // section id, query text, format...
}

export type ActionType = 'pay' | 'dispute' | 'update-details' | 'contact';

export interface ActionTransaction {
  id: string; // act_
  tenantId: string;
  communicationId: string;
  customerId: string;
  action: ActionType;
  status: 'completed' | 'failed';
  payload: Record<string, unknown>;
  at: string;
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface AiInvocation {
  id: string; // aii_
  tenantId: string;
  task: 'assistant-answer' | 'draft-content' | 'improve-readability' | 'summarize';
  model: string;
  grounded: boolean;
  confidence: number; // 0..1
  citations: string[]; // section ids / content version ids used
  inputHash: string;
  outputPreview: string;
  latencyMs: number;
  at: string;
  subject?: string; // com_ / cnv_ affected
  escalated: boolean;
}

export interface AssistantAnswer {
  answer: string;
  confidence: number;
  citations: { sectionId: string; title: string }[];
  /** true when the assistant declined to guess and routed to a human */
  escalated: boolean;
  invocationId: string;
}

export interface AiGateway {
  /**
   * Answer a question grounded ONLY in the supplied context passages. The
   * implementation must never invent facts beyond the passages; when
   * confidence is low it returns escalated=true with a routing message
   * (platform/06 AIG hard rules).
   */
  answer(args: {
    tenantId: string;
    question: string;
    passages: { id: string; title: string; text: string }[];
    subject?: string;
  }): Promise<AssistantAnswer>;
  /** Draft or improve content text (returns a draft requiring human approval). */
  draft(args: {
    tenantId: string;
    instruction: string;
    baseText?: string;
    subject?: string;
  }): Promise<{ text: string; invocationId: string }>;
}

// ---------------------------------------------------------------------------
// NBA, analytics, archive, webhooks, ingestion
// ---------------------------------------------------------------------------

export interface Recommendation {
  id: string; // rec_
  tenantId: string;
  communicationId: string;
  customerId: string;
  action: ActionType | 'go-paperless' | 'view-document';
  reason: string; // human-readable explanation (explainability requirement)
  ruleId: string;
  createdAt: string;
  taken?: boolean;
}

export interface MetricsOverview {
  communications: number;
  delivered: number;
  failed: number;
  viewed: number;
  actionsCompleted: number;
  outcomesAchieved: number;
  outcomeRate: number; // outcomesAchieved / communications
  callDeflectionProxy: number; // self-served actions / (self-served + contact escalations)
  byChannel: Record<string, { sent: number; delivered: number; failed: number }>;
}

export interface FunnelStep {
  step: 'composed' | 'delivered' | 'viewed' | 'interacted' | 'action-completed' | 'outcome';
  count: number;
}

export interface TimelineEntry {
  at: string;
  type: string;
  subject?: string;
  summary: string;
}

export interface ArchiveRecord {
  id: string; // arc_
  tenantId: string;
  communicationId: string;
  customerId: string;
  templateVersionId: string;
  storedAt: string;
  retentionClass: 'standard-7y' | 'permanent';
  legalHold: boolean;
  /** everything needed to reproduce the communication exactly */
  manifest: {
    dataSnapshotKey: string;
    dataSnapshotHash: string;
    templateVersionId: string;
    contentVersionIds: string[];
    artifacts: { format: RenderFormat; objectKey: string; sha256: string }[];
    rendererVersion: string;
  };
}

export interface EvidencePack {
  generatedAt: string;
  communicationId: string;
  record: ArchiveRecord;
  proofs: {
    proofOfContent: { dataSnapshotHash: string; artifactHashes: Record<string, string> };
    proofOfDelivery: DeliveryAttempt[];
    proofOfAccess: AccessEvent[];
    proofOfCustomerAction: ActionTransaction[];
    proofOfVersion: { templateVersionId: string; contentVersionIds: string[] };
    proofOfAiChanges: AiInvocation[];
  };
  eventChain: { intact: boolean; length: number };
}

export interface WebhookSubscription {
  id: string; // whk_
  tenantId: string;
  url: string;
  /** event type patterns, e.g. ["com.acorn.delivery.*"] */
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string; // whd_
  tenantId: string;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  status: 'delivered' | 'failed' | 'retrying';
  attempts: number;
  lastStatusCode?: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionJob {
  id: string; // ing_
  tenantId: string;
  templateId: string;
  sourceFormat: 'json' | 'csv';
  status: 'received' | 'validated' | 'completed' | 'failed';
  receivedAt: string;
  completedAt?: string;
  recordCount: number;
  validCount: number;
  errorCount: number;
  errors: { record: number; message: string }[];
  piiFindings: { path: string; kind: string; count: number }[];
  communicationIds: string[];
}

// ---------------------------------------------------------------------------
// Domain service contracts
// ---------------------------------------------------------------------------

export interface TenantService {
  createTenant(args: { name: string; industry?: string }): {
    tenant: Tenant;
    adminKey: { id: string; secret: string };
  };
  getTenant(tenantId: string): Tenant;
  createApiKey(ctx: RequestCtx, args: { name: string; roles: Role[] }): {
    key: ApiKey;
    secret: string;
  };
  revokeApiKey(ctx: RequestCtx, keyId: string): void;
  authenticate(secret: string): RequestCtx | undefined;
  createBrand(ctx: RequestCtx, args: Omit<Brand, 'id' | 'tenantId'>): Brand;
  listBrands(ctx: RequestCtx): Brand[];
  // customers
  createCustomer(ctx: RequestCtx, args: Omit<Customer, 'id' | 'tenantId' | 'createdAt'>): Customer;
  getCustomer(ctx: RequestCtx, id: string): Customer;
  listCustomers(ctx: RequestCtx): Customer[];
  recordConsent(
    ctx: RequestCtx,
    args: Omit<ConsentRecord, 'id' | 'tenantId' | 'recordedAt'>,
  ): ConsentRecord;
  getConsents(ctx: RequestCtx, customerId: string): ConsentRecord[];
  setPreferences(
    ctx: RequestCtx,
    customerId: string,
    args: { channelPriority: Channel[]; language?: string; paperless?: boolean },
  ): PreferenceRecord;
  getPreferences(ctx: RequestCtx, customerId: string): PreferenceRecord | undefined;
  hasConsent(tenantId: string, customerId: string, channel: Channel): boolean;
  preferredChannels(tenantId: string, customerId: string): Channel[];
}

export interface ContentService {
  createContent(
    ctx: RequestCtx,
    args: { key: string; type: ContentType; title: string; body: string; locale?: string },
  ): { content: ContentObject; version: ContentVersion };
  newVersion(
    ctx: RequestCtx,
    contentId: string,
    args: { body: string; aiAssisted?: boolean },
  ): ContentVersion;
  submitForReview(ctx: RequestCtx, versionId: string): ContentVersion;
  review(
    ctx: RequestCtx,
    versionId: string,
    decision: 'approved' | 'rejected',
    note?: string,
  ): ContentVersion;
  getContent(ctx: RequestCtx, contentId: string): ContentObject;
  getByKey(tenantId: string, key: string): { content: ContentObject; approved?: ContentVersion } | undefined;
  listContent(ctx: RequestCtx, type?: ContentType): ContentObject[];
  listVersions(ctx: RequestCtx, contentId: string): ContentVersion[];
  getVersion(tenantId: string, versionId: string): ContentVersion | undefined;
  search(tenantId: string, query: string): { content: ContentObject; version: ContentVersion; score: number }[];
}

export interface TemplateService {
  createTemplate(
    ctx: RequestCtx,
    args: {
      key: string;
      name: string;
      communicationType: string;
      brandId: string;
      dataContract: DataContract;
      intendedOutcome: IntendedOutcome;
      blocks: TemplateBlock[];
      channels?: TemplateVersion['channels'];
    },
  ): { template: Template; version: TemplateVersion };
  newVersion(
    ctx: RequestCtx,
    templateId: string,
    args: Partial<
      Pick<TemplateVersion, 'dataContract' | 'intendedOutcome' | 'blocks' | 'channels' | 'aiAssisted'>
    >,
  ): TemplateVersion;
  /** Runs the accessibility gate; throws PlatformError 'accessibility-gate-failed' when blocked. */
  publish(ctx: RequestCtx, versionId: string): TemplateVersion;
  checkAccessibility(tenantId: string, versionId: string): AccessibilityReport;
  getTemplate(ctx: RequestCtx, templateId: string): Template;
  getByKey(tenantId: string, key: string): Template | undefined;
  listTemplates(ctx: RequestCtx): Template[];
  getVersion(tenantId: string, versionId: string): TemplateVersion | undefined;
  listVersions(ctx: RequestCtx, templateId: string): TemplateVersion[];
  publishedVersion(tenantId: string, templateId: string): TemplateVersion | undefined;
  /** Validates a data record against the version's data contract. Returns field errors. */
  validateData(version: TemplateVersion, data: Record<string, unknown>): string[];
}

export interface CompositionService {
  /**
   * Compose a communication for one customer from the template's published
   * version and a data record. Validates against the data contract, snapshots
   * the data to the object store, resolves content refs to approved versions,
   * evaluates conditions, interpolates values, emits communication.composed,
   * then renders all formats and emits communication.rendered.
   */
  compose(args: {
    tenantId: string;
    templateId: string;
    customerId: string;
    data: Record<string, unknown>;
    requestedChannels?: Channel[];
    journeyRef?: string;
  }): Promise<Communication>;
  getCommunication(tenantId: string, id: string): Communication | undefined;
  listCommunications(
    tenantId: string,
    filter?: { customerId?: string; templateId?: string; status?: CommunicationStatus },
  ): Communication[];
  setStatus(tenantId: string, id: string, status: CommunicationStatus): Communication;
  markOutcome(tenantId: string, id: string, via: string): Communication;
  listArtifacts(tenantId: string, communicationId: string): RenderArtifact[];
  getArtifact(tenantId: string, communicationId: string, format: RenderFormat): RenderArtifact | undefined;
}

export interface RenderingService {
  readonly rendererVersion: string;
  /** Render every applicable format for a composed communication and persist artifacts. */
  renderAll(args: {
    tenantId: string;
    communication: Communication;
    templateVersion: TemplateVersion;
    /** absolute base URL used to embed the secure-link placeholder {{link}} */
    viewerBaseUrl: string;
  }): Promise<RenderArtifact[]>;
  /** Render one format to a buffer without persisting (preview). */
  renderPreview(args: {
    doc: ComposedDocument;
    format: RenderFormat;
    templateVersion: TemplateVersion;
  }): Promise<{ buf: Buffer; contentType: string }>;
}

export interface DeliveryService {
  /**
   * Orchestrate delivery: resolve channel plan from request + preferences,
   * enforce consent, create a secure link, attempt channels in order with
   * failover, retry transient failures, emit delivery.* events.
   *
   * Scheduling: an explicit `scheduleAt` in the future defers the send (one
   * 'scheduled' attempt row carrying scheduledFor); tenant quiet hours
   * (settings.quietHours) defer outbound message channels (email/sms) that
   * would fire inside the window to the window's end; a tenant
   * maxDeliveriesPerCustomerPerDay cap defers overflow to the next day.
   * tick() promotes due scheduled attempts by running the normal orchestration.
   */
  deliver(args: {
    tenantId: string;
    communicationId: string;
    channels?: Channel[];
    scheduleAt?: string;
  }): Promise<DeliveryAttempt[]>;
  listAttempts(tenantId: string, communicationId?: string): DeliveryAttempt[];
  getSecureLink(tenantId: string, communicationId: string): SecureLink | undefined;
  /** Simulated provider callback (bounce/delivery receipts). */
  providerCallback(args: {
    tenantId: string;
    attemptId: string;
    status: 'delivered' | 'bounced';
  }): Promise<DeliveryAttempt>;
  /** Execute scheduled deliveries whose time has come. Returns count promoted. */
  tick(now?: number): Promise<number>;
}

export interface ViewerService {
  /** Resolve a secure-link token; enforces expiry/revocation and OTP when set. */
  resolveLink(token: string, otp?: string):
    | { ok: true; link: SecureLink; communication: Communication }
    | { ok: false; reason: 'not-found' | 'expired' | 'revoked' | 'otp-required' | 'otp-invalid' };
  recordAccess(args: {
    link: SecureLink;
    authMethod: AccessEvent['authMethod'];
    userAgent?: string;
  }): Promise<AccessEvent>;
  recordInteraction(args: {
    tenantId: string;
    communicationId: string;
    customerId: string;
    kind: InteractionEvent['kind'];
    detail?: string;
  }): Promise<InteractionEvent>;
  performAction(args: {
    tenantId: string;
    communicationId: string;
    customerId: string;
    action: ActionType;
    payload: Record<string, unknown>;
  }): Promise<ActionTransaction>;
  /** Grounded Q&A over the communication + approved FAQ content. */
  ask(args: {
    tenantId: string;
    communicationId: string;
    question: string;
  }): Promise<AssistantAnswer>;
}

export interface NbaService {
  /** Compute (and persist) explainable recommendations for a communication. */
  recommend(tenantId: string, communicationId: string): Recommendation[];
  listRecommendations(tenantId: string, communicationId?: string): Recommendation[];
}

export interface AnalyticsService {
  overview(tenantId: string): MetricsOverview;
  funnel(tenantId: string, templateId: string): FunnelStep[];
  communicationTimeline(tenantId: string, communicationId: string): TimelineEntry[];
  customerTimeline(tenantId: string, customerId: string): TimelineEntry[];
  /** Section-level engagement for a template (hotspot reporting). */
  hotspots(tenantId: string, templateId: string): { sectionId: string; views: number; expands: number }[];
}

export interface ArchiveService {
  /** Store the immutable statement-of-record for a communication. */
  archive(tenantId: string, communicationId: string): Promise<ArchiveRecord>;
  get(tenantId: string, communicationId: string): ArchiveRecord | undefined;
  search(tenantId: string, filter: { customerId?: string; templateId?: string }): ArchiveRecord[];
  setLegalHold(ctx: RequestCtx, recordId: string, hold: boolean): ArchiveRecord;
  evidencePack(tenantId: string, communicationId: string): EvidencePack;
  /** Re-render the communication from its manifest and verify hashes match. */
  verifyReproducibility(tenantId: string, communicationId: string): Promise<{ reproducible: boolean; detail: string }>;
}

export interface WebhookService {
  subscribe(ctx: RequestCtx, args: { url: string; events: string[] }): WebhookSubscription;
  unsubscribe(ctx: RequestCtx, subscriptionId: string): void;
  list(ctx: RequestCtx): WebhookSubscription[];
  deliveries(ctx: RequestCtx, subscriptionId?: string): WebhookDelivery[];
  replay(ctx: RequestCtx, deliveryId: string): Promise<WebhookDelivery>;
}

export interface IngestionService {
  /**
   * Ingest a batch (JSON array or CSV text) for a template. Detects schema,
   * validates each record against the data contract, detects PII, resolves the
   * customer per record (by `customerRef` matching Customer.externalRef or id),
   * composes+delivers valid records, and returns the job with errors.
   */
  ingestBatch(args: {
    ctx: RequestCtx;
    templateId: string;
    sourceFormat: 'json' | 'csv';
    payload: string;
    deliver?: boolean;
    /** optional mapping profile applied to each record before validation */
    mappingProfileId?: string;
  }): Promise<IngestionJob>;
  getJob(ctx: RequestCtx, jobId: string): IngestionJob;
  listJobs(ctx: RequestCtx): IngestionJob[];
  /** Standalone PII/PHI scan of an arbitrary payload. */
  scanPii(payload: string): { path: string; kind: string; count: number }[];
}

// ---------------------------------------------------------------------------
// Journey orchestration (tier 2)
// ---------------------------------------------------------------------------

/**
 * Journey steps form an explicit state machine. `send` composes + delivers a
 * communication from the trigger data; `wait` pauses until a lifecycle signal
 * for the journey's communication arrives or the timeout elapses; `remind`
 * re-delivers (optionally on specific channels); `end` terminates.
 */
export type JourneyStep =
  | { id: string; kind: 'send'; templateId: string; channels?: Channel[]; next: string }
  | {
      id: string;
      kind: 'wait';
      until: 'outcome-achieved' | 'viewed' | 'action-completed';
      timeoutMs: number;
      onEvent: string; // step id to advance to when the signal arrives
      onTimeout: string; // step id to advance to when the deadline passes
    }
  | { id: string; kind: 'remind'; channels?: Channel[]; next: string }
  | { id: string; kind: 'end'; result: 'completed' | 'abandoned' };

export interface Journey {
  id: string; // jny_
  tenantId: string;
  key: string;
  name: string;
  /** first step id */
  entryStepId: string;
  steps: JourneyStep[];
  active: boolean;
  createdAt: string;
}

export interface JourneyInstance {
  id: string; // jni_
  tenantId: string;
  journeyId: string;
  customerId: string;
  status: 'running' | 'completed' | 'abandoned' | 'failed';
  currentStepId: string;
  /** communication created by the journey's send step */
  communicationId?: string;
  /** set while parked on a wait step */
  deadlineAt?: string;
  data: Record<string, unknown>;
  history: { at: string; stepId: string; note: string }[];
  startedAt: string;
  endedAt?: string;
}

export interface JourneyService {
  createJourney(
    ctx: RequestCtx,
    args: { key: string; name: string; entryStepId: string; steps: JourneyStep[] },
  ): Journey;
  listJourneys(ctx: RequestCtx): Journey[];
  getJourney(ctx: RequestCtx, journeyId: string): Journey;
  /** Start an instance: runs steps until the first wait/end. */
  start(args: {
    tenantId: string;
    journeyId: string;
    customerId: string;
    data: Record<string, unknown>;
  }): Promise<JourneyInstance>;
  getInstance(tenantId: string, id: string): JourneyInstance | undefined;
  listInstances(
    tenantId: string,
    filter?: { journeyId?: string; customerId?: string; status?: JourneyInstance['status'] },
  ): JourneyInstance[];
  /** Advance every instance whose wait deadline has passed. Returns count advanced. */
  tick(now?: number): Promise<number>;
}

// ---------------------------------------------------------------------------
// Print production (tier 2)
// ---------------------------------------------------------------------------

export interface PrintPiece {
  id: string; // pcs_
  tenantId: string;
  batchId: string;
  communicationId: string;
  customerId: string;
  /** normalized address grouping key (householding) */
  householdKey: string;
  postalCode: string;
  /** presort ordering key (postalCode + householdKey) */
  sortKey: string;
  /** Intelligent Mail barcode (simulated 31-digit) */
  imb: string;
  status: 'queued' | 'printed' | 'mailed' | 'delivered' | 'returned';
  updatedAt: string;
}

export interface PrintBatch {
  id: string; // pbt_
  tenantId: string;
  status: 'spooled' | 'shipped' | 'reconciled';
  createdAt: string;
  communicationIds: string[];
  suppressed: { communicationId: string; reason: string }[];
  /** households in presort order */
  households: { householdKey: string; postalCode: string; pieceIds: string[] }[];
  pieceIds: string[];
  /** spool manifest written to the object store */
  manifestObjectKey?: string;
}

export interface PrintService {
  /**
   * Spool a batch: validate addresses (suppress pieces without one),
   * household by normalized address, presort by postal code, assign IMB
   * codes, and write a spool manifest (JSON) referencing each piece's PDF
   * artifact to the object store and outbox.
   */
  createBatch(
    ctx: RequestCtx,
    args: { communicationIds?: string[]; templateId?: string },
  ): Promise<PrintBatch>;
  getBatch(tenantId: string, batchId: string): PrintBatch | undefined;
  listBatches(ctx: RequestCtx): PrintBatch[];
  listPieces(tenantId: string, batchId: string): PrintPiece[];
  /**
   * Record a mail event from the print/postal provider. 'returned' also
   * records a bounced print delivery attempt so downstream rules
   * (NBA update-details) fire.
   */
  recordPieceEvent(
    ctx: RequestCtx,
    pieceId: string,
    status: 'printed' | 'mailed' | 'delivered' | 'returned',
  ): Promise<PrintPiece>;
  reconcile(
    ctx: RequestCtx,
    batchId: string,
  ): { expected: number; mailed: number; delivered: number; returned: number; outstanding: number };
}

// ---------------------------------------------------------------------------
// Multilingual translations (tier 3)
// ---------------------------------------------------------------------------

/**
 * Locale variants of approved content live beside the source ContentObject
 * with their own approval lifecycle (approving a Spanish variant must never
 * retire the English source), and are resolved at composition time by the
 * customer's locale with fallback to the source content.
 */
export interface ContentTranslation {
  id: string; // tnl_
  tenantId: string;
  contentId: string;
  /** the approved source version this translation was produced from */
  sourceVersionId: string;
  locale: string; // BCP-47, e.g. "es" or "es-MX"
  title: string;
  body: string;
  status: ApprovalStatus;
  method: 'dictionary' | 'llm' | 'human';
  authorId: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  aiAssisted: boolean;
  /** segments served from translation memory (reuse metric) */
  memoryHits: number;
}

export interface ResolvedContent {
  title: string;
  body: string;
  /** version pinned into the chain of custody: cnv_ (source) or tnl_ (variant) */
  ref: string;
  locale: string;
}

export interface TranslationService {
  /** Machine-translate the approved source version into a locale (draft — human approval required). */
  translateContent(ctx: RequestCtx, contentId: string, targetLocale: string): Promise<ContentTranslation>;
  /** SoD-enforced review, mirroring the content approval workflow. */
  review(ctx: RequestCtx, translationId: string, decision: 'approved' | 'rejected', note?: string): ContentTranslation;
  /**
   * Resolve content for a key preferring an approved translation matching the
   * locale (exact, then language-prefix), falling back to the approved source
   * version. Undefined when the key has no approved content at all.
   */
  resolveContent(tenantId: string, key: string, locale: string): ResolvedContent | undefined;
  list(ctx: RequestCtx, contentId?: string): ContentTranslation[];
  /** translation-memory statistics */
  memoryStats(ctx: RequestCtx): { entries: number };
}

// ---------------------------------------------------------------------------
// Experiments / A-B testing (tier 3)
// ---------------------------------------------------------------------------

export interface Experiment {
  id: string; // exp_
  tenantId: string;
  templateId: string;
  name: string;
  status: 'running' | 'concluded';
  /** weighted variants; each versionId is a TemplateVersion of the template */
  variants: { versionId: string; weight: number }[];
  createdAt: string;
  concludedAt?: string;
  winnerVersionId?: string;
}

export interface VariantResult {
  versionId: string;
  assigned: number;
  delivered: number;
  viewed: number;
  outcomes: number;
  outcomeRate: number;
}

export interface ExperimentService {
  create(
    ctx: RequestCtx,
    args: { templateId: string; name: string; variants: { versionId: string; weight: number }[] },
  ): Experiment;
  /**
   * Deterministic variant assignment (hash of experimentId + customerId over
   * the weight space) for the template's running experiment; undefined when
   * no experiment is running so composition falls back to the published
   * version. Every variant must have passed the accessibility gate.
   */
  selectVersion(tenantId: string, templateId: string, customerId: string): TemplateVersion | undefined;
  results(ctx: RequestCtx, experimentId: string): VariantResult[];
  conclude(ctx: RequestCtx, experimentId: string, winnerVersionId?: string): Experiment;
  list(ctx: RequestCtx): Experiment[];
  get(ctx: RequestCtx, experimentId: string): Experiment;
}

// ---------------------------------------------------------------------------
// Usage metering & FinOps (tier 3)
// ---------------------------------------------------------------------------

export interface UsageSummary {
  period: string; // YYYY-MM
  metrics: Record<string, number>;
  /** reference unit rates applied (per platform/10 cost model) */
  rates: Record<string, number>;
  estimatedCostUsd: number;
}

export interface UsageService {
  record(tenantId: string, metric: string, qty?: number): void;
  summary(tenantId: string, period?: string): UsageSummary;
  listPeriods(tenantId: string): string[];
  /** In-memory token bucket per API-key hash (production: gateway-level). */
  checkRateLimit(bucketKey: string): {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetSeconds: number;
  };
}

// ---------------------------------------------------------------------------
// Migration Studio (tier 4) — platform/09-migration-strategy.md
// ---------------------------------------------------------------------------

export interface MigrationJob {
  id: string; // mig_
  tenantId: string;
  name: string;
  sourceFormat: 'html' | 'text';
  status: 'extracted' | 'drafted' | 'failed';
  createdAt: string;
  extracted: {
    blocks: TemplateBlock[];
    /** dot-path variable suggestions discovered in the legacy document */
    variables: { path: string; sample: string; kind: 'currency' | 'date' | 'number' | 'text' }[];
    /** reusable-content candidates with similarity hits against the library */
    contentCandidates: {
      title: string;
      body: string;
      similarTo?: { contentId: string; contentKey: string; similarity: number };
    }[];
  };
  /** rubric score 0-100 (blocks, tables, variables, length) */
  complexityScore: number;
  /** effort estimate derived from the complexity rubric */
  effortHours: number;
  draftTemplateId?: string;
  draftVersionId?: string;
  error?: string;
}

export interface DuplicatePair {
  aContentId: string;
  aKey: string;
  bContentId: string;
  bKey: string;
  similarity: number; // Jaccard over shingles, 0..1
}

export interface ParallelRunResult {
  similarity: number; // 0..1 normalized line match ratio
  matches: boolean; // similarity >= threshold
  addedLines: string[]; // present in B, not in A
  removedLines: string[]; // present in A, not in B
}

export interface MigrationService {
  /**
   * Ingest a legacy communication (HTML or plain text): extract structure into
   * template blocks, detect variable regions (amounts, dates, account-like
   * tokens) as data-contract suggestions, surface reusable-content candidates
   * with near-duplicate matches against the approved library, score
   * complexity/effort, and create a DRAFT template (never published — the
   * normal accessibility/publish gates still apply).
   */
  ingestLegacy(
    ctx: RequestCtx,
    args: { name: string; sourceFormat: 'html' | 'text'; payload: string; brandId?: string },
  ): Promise<MigrationJob>;
  getJob(ctx: RequestCtx, jobId: string): MigrationJob;
  listJobs(ctx: RequestCtx): MigrationJob[];
  /** Near-duplicate report across the approved content library (rationalization input). */
  duplicateReport(ctx: RequestCtx, threshold?: number): DuplicatePair[];
  /**
   * Parallel-run verification: render the 'text' format of two template
   * versions with the same data and diff the normalized output
   * (platform/09 §5 comparison harness).
   */
  parallelRun(
    ctx: RequestCtx,
    args: { versionAId: string; versionBId: string; data?: Record<string, unknown> },
  ): Promise<ParallelRunResult>;
}

// ---------------------------------------------------------------------------
// Agent desk (tier 4) — contact-center assist
// ---------------------------------------------------------------------------

export interface CustomerOverview {
  customer: Customer;
  preferences?: PreferenceRecord;
  consents: ConsentRecord[];
  communications: Communication[];
  recentTimeline: TimelineEntry[];
}

export interface AgentDeskService {
  /** Substring search over name/email/phone/externalRef. */
  searchCustomers(ctx: RequestCtx, query: string): Customer[];
  customerOverview(ctx: RequestCtx, customerId: string): CustomerOverview;
  /** Re-deliver an existing communication; audited as an on-behalf agent action. */
  resend(ctx: RequestCtx, communicationId: string, channels?: Channel[]): Promise<DeliveryAttempt[]>;
  /** Revoke all live secure links for a communication and issue a fresh one; audited. */
  reissueLink(ctx: RequestCtx, communicationId: string): Promise<{ url: string; expiresAt: string }>;
  /** Attach a service note to the customer timeline; audited. */
  addNote(ctx: RequestCtx, customerId: string, note: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Data lifecycle (tier 4) — retention, erasure, hygiene
// ---------------------------------------------------------------------------

export interface ErasureReport {
  customerId: string;
  erased: boolean;
  /** archive records under legal hold that blocked full erasure */
  blockedBy: string[];
  redactedCustomerFields: number;
  revokedLinks: number;
  deletedObjects: number;
  tombstonedArchiveRecords: number;
}

export interface LifecycleService {
  /**
   * Housekeeping sweep: revoke expired secure links and count retention-due
   * archive records (standard-7y). Returns what was done.
   */
  sweep(now?: number): Promise<{ expiredLinksRevoked: number; retentionDue: number }>;
  /**
   * GDPR/CCPA erasure: refuses when any of the customer's archive records is
   * under legal hold; otherwise redacts customer PII to tombstone values,
   * revokes links, deletes rendered artifacts and data snapshots from the
   * object store, and tombstones archive records. The hash-chained event log
   * is NOT rewritten (tamper-evidence wins; events carry pseudonymous ids —
   * production adds crypto-shredding per platform/06).
   */
  eraseCustomer(ctx: RequestCtx, customerId: string, reason: string): Promise<ErasureReport>;
}

// ---------------------------------------------------------------------------
// Archive replication (tier 5) — offsite WORM copy to S3-compatible storage
// ---------------------------------------------------------------------------

export interface ReplicationRecord {
  id: string; // rpl_
  tenantId: string;
  communicationId: string;
  status: 'replicated' | 'failed' | 'skipped';
  attempts: number;
  objectsReplicated: number;
  bucketKeyPrefix: string;
  lastError?: string;
  updatedAt: string;
}

export interface ReplicationService {
  /** Whether an S3-compatible target is configured (env-driven). */
  enabled(): boolean;
  /** Replicate one archived communication's manifest + artifacts. */
  replicate(tenantId: string, communicationId: string): Promise<ReplicationRecord>;
  status(ctx: RequestCtx): { enabled: boolean; replicated: number; failed: number; records: ReplicationRecord[] };
}

// ---------------------------------------------------------------------------
// High-volume batch production (tier 6) — platform/04 batch pipeline
// ---------------------------------------------------------------------------

export interface BatchRun {
  id: string; // bat_
  tenantId: string;
  templateId: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  concurrency: number;
  total: number;
  /** records fully processed (compose + optional deliver) — the checkpoint */
  processed: number;
  succeeded: number;
  errors: { record: number; message: string }[];
  deliver: boolean;
  startedAt: string;
  completedAt?: string;
  /** throughput snapshot at completion */
  perSecond?: number;
  communicationIds: string[];
}

export interface BatchService {
  /**
   * Run a batch of records through compose(+deliver) with a bounded worker
   * pool. The run checkpoints `processed` as it goes; a crash/pause can be
   * resumed with resume() which skips already-processed records
   * (platform/11: checkpointed restartability).
   */
  run(
    ctx: RequestCtx,
    args: {
      templateId: string;
      records: Record<string, unknown>[];
      concurrency?: number; // default 8, max 32
      deliver?: boolean; // default true
      mappingProfileId?: string; // applied per record before compose
    },
  ): Promise<BatchRun>;
  /** Continue a paused/failed run from its checkpoint (records re-supplied by caller). */
  resume(ctx: RequestCtx, batchId: string, records: Record<string, unknown>[]): Promise<BatchRun>;
  pause(ctx: RequestCtx, batchId: string): BatchRun;
  get(ctx: RequestCtx, batchId: string): BatchRun;
  list(ctx: RequestCtx): BatchRun[];
}

// ---------------------------------------------------------------------------
// Data mapping profiles (tier 6) — platform/05 ingestion mapping
// ---------------------------------------------------------------------------

export type MappingTransform =
  | { kind: 'copy'; source: string }
  | { kind: 'number'; source: string }
  | { kind: 'trim'; source: string }
  | { kind: 'date-iso'; source: string } // parse to YYYY-MM-DD
  | { kind: 'concat'; sources: string[]; separator?: string }
  | { kind: 'constant'; value: unknown };

export interface MappingRule {
  /** dot path in the template's data contract */
  target: string;
  transform: MappingTransform;
}

export interface MappingProfile {
  id: string; // map_
  tenantId: string;
  templateId: string;
  name: string;
  rules: MappingRule[];
  createdAt: string;
  updatedAt: string;
}

export interface MappingSuggestion {
  target: string;
  transform: MappingTransform | null; // null = no confident source found
  confidence: number; // 0..1 name-similarity score
  sample?: unknown;
}

export interface MappingService {
  create(
    ctx: RequestCtx,
    args: { templateId: string; name: string; rules: MappingRule[] },
  ): MappingProfile;
  update(ctx: RequestCtx, profileId: string, rules: MappingRule[]): MappingProfile;
  get(ctx: RequestCtx, profileId: string): MappingProfile;
  list(ctx: RequestCtx, templateId?: string): MappingProfile[];
  /**
   * Suggest rules mapping a messy source record onto the template's data
   * contract via normalized field-name similarity (platform/05 AI-assisted
   * mapping — deterministic heuristic in the reference implementation).
   */
  suggest(ctx: RequestCtx, templateId: string, sampleRecord: Record<string, unknown>): MappingSuggestion[];
  /** Apply a profile to one source record, producing a contract-shaped record. */
  apply(tenantId: string, profileId: string, record: Record<string, unknown>): Record<string, unknown>;
}
