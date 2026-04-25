export function timestampToMillis(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
}

export function formatTimestamp(value: number | null | undefined): string {
  const millis = timestampToMillis(value);
  if (millis === null) {
    return '--';
  }

  return new Date(millis).toLocaleString();
}

export function isRecentTimestamp(
  value: number | null | undefined,
  windowMs: number,
): boolean {
  const millis = timestampToMillis(value);
  return millis !== null && Date.now() - millis < windowMs;
}

/**
 * Compact relative formatter for live timelines: "now", "5s ago", "12m ago",
 * "3h ago", "2d ago". Future timestamps render as "in 5s", "in 3h" etc.
 * Pass `nowMs` so callers can drive re-renders from a tick variable rather
 * than reading the wall clock inside reactive expressions.
 */
export function formatRelative(
  value: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  const millis = timestampToMillis(value);
  if (millis === null) return '--';

  const diffSec = Math.round((nowMs - millis) / 1000);
  const abs = Math.abs(diffSec);
  const suffix = diffSec >= 0 ? ' ago' : '';
  const prefix = diffSec >= 0 ? '' : 'in ';

  if (abs < 5) return 'now';
  if (abs < 60) return `${prefix}${abs}s${suffix}`;
  if (abs < 3600) return `${prefix}${Math.floor(abs / 60)}m${suffix}`;
  if (abs < 86_400) return `${prefix}${Math.floor(abs / 3600)}h${suffix}`;
  return `${prefix}${Math.floor(abs / 86_400)}d${suffix}`;
}
