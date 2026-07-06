import { join } from 'node:path';
import { EventBus, EventLog, makeEvent, type PlatformEvent } from './events.js';
import { ObjectStore, Store } from './storage.js';
import type {
  AiGateway,
  AnalyticsService,
  ArchiveService,
  CompositionService,
  ContentService,
  DeliveryService,
  IngestionService,
  NbaService,
  RenderingService,
  TemplateService,
  TenantService,
  ViewerService,
  WebhookService,
} from './contracts.js';

export interface PlatformConfig {
  dataDir: string;
  port: number;
  /** public base URL for secure viewer links */
  baseUrl: string;
  /** directory where simulated channel providers write outbound messages */
  outboxDir: string;
  anthropicApiKey?: string;
  anthropicModel: string;
}

export function configFromEnv(overrides: Partial<PlatformConfig> = {}): PlatformConfig {
  const dataDir = overrides.dataDir ?? process.env.ACORN_DATA_DIR ?? './data';
  const port = overrides.port ?? Number(process.env.PORT ?? 4000);
  return {
    dataDir,
    port,
    baseUrl: overrides.baseUrl ?? process.env.ACORN_BASE_URL ?? `http://localhost:${port}`,
    outboxDir: overrides.outboxDir ?? process.env.ACORN_OUTBOX_DIR ?? join(dataDir, 'outbox'),
    anthropicApiKey: overrides.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY,
    anthropicModel:
      overrides.anthropicModel ?? process.env.ACORN_ANTHROPIC_MODEL ?? 'claude-sonnet-5',
  };
}

export interface PlatformServices {
  tenants: TenantService;
  content: ContentService;
  templates: TemplateService;
  composition: CompositionService;
  rendering: RenderingService;
  delivery: DeliveryService;
  viewer: ViewerService;
  ai: AiGateway;
  nba: NbaService;
  analytics: AnalyticsService;
  archive: ArchiveService;
  webhooks: WebhookService;
  ingestion: IngestionService;
}

export interface PlatformContext {
  config: PlatformConfig;
  store: Store;
  objects: ObjectStore;
  bus: EventBus;
  log: EventLog;
  /** Append to the tamper-evident log AND publish on the bus. */
  publish<T>(args: { type: string; tenantId: string; source: string; subject?: string; data: T }): Promise<PlatformEvent<T>>;
  services: PlatformServices;
}

/**
 * Create the base context. `services` starts empty and is wired by
 * src/wiring.ts — domain factories receive the context and may subscribe to
 * bus events in their factory, but must only call peer services lazily (at
 * request/event time), never during construction.
 */
export function createBaseContext(config: PlatformConfig): PlatformContext {
  const store = new Store(join(config.dataDir, 'collections'));
  const objects = new ObjectStore(join(config.dataDir, 'objects'));
  const bus = new EventBus();
  const log = new EventLog(join(config.dataDir, 'events'));

  const ctx: PlatformContext = {
    config,
    store,
    objects,
    bus,
    log,
    services: {} as PlatformServices,
    async publish(args) {
      const event = makeEvent(args);
      log.append(event);
      await bus.emit(event);
      return event;
    },
  };
  return ctx;
}
