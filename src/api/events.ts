export type AcornAccessEventType =
  | 'acorn.access:ready'
  | 'acorn.access:open'
  | 'acorn.access:close'
  | 'acorn.access:feature-change'
  | 'acorn.access:profile-change'
  | 'acorn.access:reset';

export function dispatchEvent(
  type: AcornAccessEventType,
  detail?: Record<string, unknown>
): void {
  document.dispatchEvent(
    new CustomEvent(type, {
      bubbles: true,
      detail: detail ?? {},
    })
  );
}
