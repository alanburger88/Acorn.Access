/**
 * COMPOSITION — pure document builder. Turns a template version's block AST +
 * a data record into an abstract ComposedDocument ("compose once, render
 * many"). Shared by the composition service and the rendering preview route so
 * the block-resolution logic lives in exactly one place.
 */
import type {
  Brand,
  ComposedDocument,
  ComposedLine,
  ComposedSection,
  Template,
  TemplateBlock,
  TemplateVersion,
} from '../../kernel/contracts.js';
import { invalid } from '../../kernel/errors.js';
import { evaluateRule, formatValue, getPath, interpolate } from '../../kernel/values.js';

export interface ResolvedContent {
  versionId: string;
  title: string;
  body: string;
}

export interface ComposeDocumentArgs {
  version: TemplateVersion;
  template?: Template;
  brand: Pick<Brand, 'name' | 'primaryColor' | 'accentColor' | 'logoText'>;
  customerName: string;
  locale: string;
  data: Record<string, unknown>;
  /** Resolve a content key to its APPROVED version; undefined blocks composition. */
  resolveContent: (key: string) => ResolvedContent | undefined;
}

/** Compose blocks into lines, appending to `lines` and collecting pinned content versions. */
function composeLines(
  blocks: TemplateBlock[],
  args: ComposeDocumentArgs,
  lines: ComposedLine[],
  contentVersionIds: string[],
): void {
  const { data, locale } = args;
  for (const block of blocks) {
    // Every conditional block kind carries an optional `condition` Rule.
    const condition = (block as { condition?: Parameters<typeof evaluateRule>[0] }).condition;
    if (!evaluateRule(condition, data)) continue;

    switch (block.kind) {
      case 'heading':
        lines.push({ kind: 'heading', level: block.level, text: interpolate(block.text, data, locale) });
        break;
      case 'text':
        lines.push({ kind: 'text', text: interpolate(block.text, data, locale) });
        break;
      case 'summary':
        lines.push({
          kind: 'summary',
          title: interpolate(block.title, data, locale),
          text: interpolate(block.text, data, locale),
        });
        break;
      case 'field-row': {
        // The value may carry its own format suffix ({{x|currency}}) which
        // interpolate() handles directly; when the block declares a `format`
        // instead, inject it into bare placeholders so both spellings work.
        let raw = block.value;
        if (block.format && block.format !== 'text') {
          raw = raw.replace(/\{\{\s*([\w.]+)\s*\}\}/g, `{{$1|${block.format}}}`);
        }
        lines.push({
          kind: 'field-row',
          label: interpolate(block.label, data, locale),
          value: interpolate(raw, data, locale),
        });
        break;
      }
      case 'table': {
        const items = getPath(data, block.itemsPath);
        const records = Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
        lines.push({
          kind: 'table',
          ...(block.title !== undefined ? { title: interpolate(block.title, data, locale) } : {}),
          headers: block.columns.map((col) => col.header),
          aligns: block.columns.map((col) => col.align ?? 'left'),
          rows: records.map((item) =>
            block.columns.map((col) => formatValue(getPath(item, col.valuePath), col.format ?? 'text', locale)),
          ),
        });
        break;
      }
      case 'content-ref': {
        const resolved = args.resolveContent(block.contentKey);
        if (!resolved) {
          throw invalid(`content-ref '${block.contentKey}' has no approved content version`);
        }
        contentVersionIds.push(resolved.versionId);
        lines.push({
          kind: 'content',
          contentKey: block.contentKey,
          contentVersionId: resolved.versionId,
          title: resolved.title,
          text: interpolate(resolved.body, data, locale),
        });
        break;
      }
      case 'action':
        lines.push({ kind: 'action', action: block.action, label: interpolate(block.label, data, locale) });
        break;
      case 'divider':
        lines.push({ kind: 'divider' });
        break;
      case 'section':
        // NESTED sections are flattened into their parent as lines: the
        // document model is one level of sections deep, so a nested section
        // contributes a heading followed by its resolved child lines.
        lines.push({ kind: 'heading', level: 3, text: interpolate(block.title, data, locale) });
        composeLines(block.blocks, args, lines, contentVersionIds);
        break;
      default:
        break;
    }
  }
}

/**
 * Pure composition: evaluate conditions, interpolate values, resolve content
 * refs to approved versions, and shape everything into sections. Top-level
 * blocks appearing before the first section are gathered into an implicit
 * 'Overview' section so every line lives inside a section.
 */
export function composeDocument(args: ComposeDocumentArgs): ComposedDocument {
  const { version, template, data, locale } = args;
  const sections: ComposedSection[] = [];
  const contentVersionIds: string[] = [];
  let current: ComposedSection | undefined;

  const ensureCurrent = (): ComposedSection => {
    if (!current) {
      // Implicit section for top-level blocks before the first explicit section.
      current = { id: 'overview', title: 'Overview', collapsible: false, lines: [] };
      sections.push(current);
    }
    return current;
  };

  for (const block of version.blocks) {
    if (block.kind === 'section') {
      if (!evaluateRule(block.condition, data)) continue;
      const section: ComposedSection = {
        id: block.id,
        title: interpolate(block.title, data, locale),
        collapsible: block.collapsible ?? false,
        ...(block.explanation !== undefined
          ? { explanation: interpolate(block.explanation, data, locale) }
          : {}),
        lines: [],
      };
      composeLines(block.blocks, args, section.lines, contentVersionIds);
      sections.push(section);
      current = section;
    } else {
      composeLines([block], args, ensureCurrent().lines, contentVersionIds);
    }
  }

  return {
    title: template?.name ?? 'Document preview',
    brand: {
      name: args.brand.name,
      primaryColor: args.brand.primaryColor,
      accentColor: args.brand.accentColor,
      logoText: args.brand.logoText,
    },
    customerName: args.customerName,
    locale,
    intendedOutcome: version.intendedOutcome,
    sections,
    contentVersionIds,
  };
}
