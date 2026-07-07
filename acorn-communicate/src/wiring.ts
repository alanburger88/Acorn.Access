import type { FastifyInstance } from 'fastify';
import type { PlatformContext } from './kernel/context.js';
import { createTenantService, registerTenantRoutes } from './domains/tenants/index.js';
import { createContentService, registerContentRoutes } from './domains/content/index.js';
import { createTemplateService, registerTemplateRoutes } from './domains/templates/index.js';
import {
  createCompositionService,
  registerCompositionRoutes,
} from './domains/composition/index.js';
import { createRenderingService, registerRenderingRoutes } from './domains/rendering/index.js';
import { createDeliveryService, registerDeliveryRoutes } from './domains/delivery/index.js';
import { createWebhookService, registerWebhookRoutes } from './domains/webhooks/index.js';
import { createAiGateway } from './domains/ai/index.js';
import { createViewerService, registerViewerRoutes } from './domains/viewer/index.js';
import { createNbaService, registerNbaRoutes } from './domains/nba/index.js';
import { createAnalyticsService, registerAnalyticsRoutes } from './domains/analytics/index.js';
import { createArchiveService, registerArchiveRoutes } from './domains/archive/index.js';
import { createIngestionService, registerIngestionRoutes } from './domains/ingestion/index.js';
import { createJourneyService, registerJourneyRoutes } from './domains/journeys/index.js';
import { createPrintService, registerPrintRoutes } from './domains/print/index.js';
import { registerGraphqlRoutes } from './api/graphql/index.js';
import { registerOpenApiRoute } from './api/openapi.js';

/**
 * Wire every bounded context into the shared context. Order matters only for
 * bus subscriptions (webhooks and archive subscribe in their factories);
 * services call peers lazily via ctx.services at request/event time.
 */
export function wireServices(ctx: PlatformContext): void {
  ctx.services.tenants = createTenantService(ctx);
  ctx.services.content = createContentService(ctx);
  ctx.services.templates = createTemplateService(ctx);
  ctx.services.rendering = createRenderingService(ctx);
  ctx.services.composition = createCompositionService(ctx);
  ctx.services.ai = createAiGateway(ctx);
  ctx.services.nba = createNbaService(ctx);
  ctx.services.delivery = createDeliveryService(ctx);
  ctx.services.viewer = createViewerService(ctx);
  ctx.services.analytics = createAnalyticsService(ctx);
  ctx.services.archive = createArchiveService(ctx);
  ctx.services.webhooks = createWebhookService(ctx);
  ctx.services.ingestion = createIngestionService(ctx);
  ctx.services.journeys = createJourneyService(ctx);
  ctx.services.print = createPrintService(ctx);
}

export function registerAllRoutes(app: FastifyInstance, ctx: PlatformContext): void {
  registerTenantRoutes(app, ctx);
  registerContentRoutes(app, ctx);
  registerTemplateRoutes(app, ctx);
  registerCompositionRoutes(app, ctx);
  registerRenderingRoutes(app, ctx);
  registerDeliveryRoutes(app, ctx);
  registerWebhookRoutes(app, ctx);
  registerViewerRoutes(app, ctx);
  registerNbaRoutes(app, ctx);
  registerAnalyticsRoutes(app, ctx);
  registerArchiveRoutes(app, ctx);
  registerIngestionRoutes(app, ctx);
  registerJourneyRoutes(app, ctx);
  registerPrintRoutes(app, ctx);
  registerGraphqlRoutes(app, ctx);
  registerOpenApiRoute(app, ctx);
}
