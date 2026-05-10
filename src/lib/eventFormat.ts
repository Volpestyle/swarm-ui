// Shared event-row formatting used by the Activity timeline (Inspector) and
// the full Event History modal. Pure functions only — no Svelte deps — so
// they can be unit-tested or reused in any context.

import type { Event, Instance, Task } from './types';

export type EventCategory = 'message' | 'task' | 'kv' | 'context' | 'instance';
export const ALL_ACTIVITY_CATEGORY_FILTER = 'all' as const;
export type ActivityCategoryFilter = EventCategory | typeof ALL_ACTIVITY_CATEGORY_FILTER;

export interface EventCategoryDescriptor {
  id: EventCategory;
  label: string;
  color: string;
}

export const ACTIVITY_CATEGORIES: EventCategoryDescriptor[] = [
  { id: 'message',  label: 'messages',  color: 'var(--edge-message, #89b4fa)' },
  { id: 'task',     label: 'tasks',     color: 'var(--edge-task-in-progress, #f9e2af)' },
  { id: 'kv',       label: 'kv',        color: 'var(--badge-reviewer, #a6e3a1)' },
  { id: 'context',  label: 'context',   color: 'var(--edge-task-open, #fab387)' },
  { id: 'instance', label: 'instances', color: '#a6adc8' },
];

export function categoryOf(type: string): EventCategory | null {
  if (type.startsWith('message.')) return 'message';
  if (type.startsWith('task.')) return 'task';
  if (type.startsWith('kv.')) return 'kv';
  if (type.startsWith('context.')) return 'context';
  if (type.startsWith('instance.')) return 'instance';
  return null;
}

export function eventColor(type: string): string {
  const cat = categoryOf(type);
  if (!cat) return '#a6adc8';
  const found = ACTIVITY_CATEGORIES.find((c) => c.id === cat);
  return found?.color ?? '#a6adc8';
}

export function shortId(value: string | null): string {
  if (!value) return '';
  return value.length > 12 ? value.slice(0, 8) : value;
}

export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export type ParsedPayload = Record<string, unknown> | null;

export function parsePayload(raw: string | null): ParsedPayload {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Resolve an actor or instance-typed subject to its label. The literal
 * "system" string is preserved (server-side actor for cascades and
 * stale-reclaim sweeps). Falls back to a short UUID for unknown ids.
 */
export function formatInstanceRef(
  id: string | null,
  instMap: Map<string, Instance>,
): string {
  if (!id) return '—';
  if (id === 'system') return 'system';
  const inst = instMap.get(id);
  if (inst?.label) return inst.label;
  return shortId(id);
}

export function formatTaskRef(
  id: string | null,
  tasks: Map<string, Task>,
): string {
  if (!id) return '—';
  const task = tasks.get(id);
  if (task?.title) return truncate(task.title, 36);
  return shortId(id);
}

export function formatSubject(
  evt: Event,
  instMap: Map<string, Instance>,
  tasks: Map<string, Task>,
): string {
  if (!evt.subject) {
    return evt.type === 'message.broadcast' ? 'broadcast' : '—';
  }
  if (evt.type.startsWith('instance.') || evt.type.startsWith('message.')) {
    return formatInstanceRef(evt.subject, instMap);
  }
  if (evt.type.startsWith('task.')) {
    return formatTaskRef(evt.subject, tasks);
  }
  if (evt.type.startsWith('context.')) {
    return basename(evt.subject);
  }
  if (evt.type.startsWith('kv.')) {
    return truncate(evt.subject, 36);
  }
  return shortId(evt.subject);
}

export function subjectTitle(evt: Event): string {
  if (!evt.subject) return '';
  return evt.subject;
}

/**
 * Per-event-type one-line summary derived from the JSON payload. Returns
 * '' rather than dumping raw JSON when the type is unknown — the expanded
 * detail view is responsible for showing the full payload.
 */
export function eventSummary(
  evt: Event,
  instMap: Map<string, Instance>,
  tasks: Map<string, Task>,
): string {
  const p = parsePayload(evt.payload);

  switch (evt.type) {
    case 'message.sent': {
      const content = typeof p?.content === 'string' ? p.content : '';
      const len = typeof p?.length === 'number' ? p.length : null;
      if (content) return formatMessagePreview(content, len);
      return len !== null ? `${len} chars` : '';
    }
    case 'message.broadcast': {
      const r = typeof p?.recipients === 'number' ? p.recipients : null;
      const content = typeof p?.content === 'string' ? p.content : '';
      const len = typeof p?.length === 'number' ? p.length : null;
      const head = r !== null ? `→ ${r}` : '';
      if (content) {
        const preview = formatMessagePreview(content, len);
        return head ? `${head} · ${preview}` : preview;
      }
      if (r === null) return '';
      return len !== null
        ? `${head} recipient(s) · ${len} chars`
        : `${head} recipient(s)`;
    }
    case 'task.created': {
      const title = typeof p?.title === 'string' ? p.title : '';
      const status = typeof p?.status === 'string' ? p.status : '';
      const t = typeof p?.task_type === 'string' ? `[${p.task_type}] ` : '';
      const head = title ? truncate(title, 40) : '';
      if (head && status) return `${t}${head} · ${status}`;
      if (head) return `${t}${head}`;
      if (status) return `${t}→ ${status}`;
      return t.trim();
    }
    case 'task.claimed': {
      const prior = typeof p?.prior_status === 'string' ? p.prior_status : '';
      const status = typeof p?.status === 'string' ? p.status : 'in_progress';
      return prior ? `${prior} → ${status}` : 'claimed';
    }
    case 'task.updated': {
      const status = typeof p?.status === 'string' ? p.status : '';
      const prior = typeof p?.prior_status === 'string' ? p.prior_status : '';
      const result = typeof p?.result === 'string' ? p.result : '';
      const arrow = prior && status ? `${prior} → ${status}` : status ? `→ ${status}` : 'updated';
      return result ? `${arrow} · ${truncate(result, 80)}` : arrow;
    }
    case 'task.approved': {
      const status = typeof p?.status === 'string' ? p.status : '';
      return status ? `approved → ${status}` : 'approved';
    }
    case 'task.cascade.unblocked': {
      const status = typeof p?.status === 'string' ? p.status : '';
      return status
        ? `auto-unblocked → ${status}`
        : 'auto-unblocked';
    }
    case 'task.cascade.cancelled': {
      const reason = typeof p?.reason === 'string' ? p.reason : '';
      const trigger =
        typeof p?.trigger === 'string'
          ? formatTaskRef(p.trigger, tasks)
          : '';
      if (reason && trigger) {
        return `auto-cancelled · ${reason} (${trigger})`;
      }
      if (reason) return `auto-cancelled · ${reason}`;
      return 'auto-cancelled';
    }
    case 'kv.set': {
      const value = typeof p?.value === 'string' ? p.value : '';
      const len = typeof p?.length === 'number' ? p.length : null;
      if (value) return `set · ${truncate(stripJson(value), 80)}`;
      return len !== null ? `set · ${len} bytes` : 'set';
    }
    case 'kv.deleted': {
      const prior = typeof p?.prior_value === 'string' ? p.prior_value : '';
      return prior ? `deleted · was ${truncate(stripJson(prior), 60)}` : 'deleted';
    }
    case 'kv.appended': {
      const len = typeof p?.length === 'number' ? p.length : null;
      const appended = p?.appended;
      const preview =
        typeof appended === 'string'
          ? truncate(appended, 60)
          : appended !== undefined
          ? truncate(JSON.stringify(appended), 60)
          : '';
      const head = len !== null ? `appended · now ${len} item(s)` : 'appended';
      return preview ? `${head} · ${preview}` : head;
    }
    case 'context.lock_acquired': {
      const content = typeof p?.content === 'string' ? p.content : '';
      return content ? `locked · ${truncate(content, 80)}` : 'locked';
    }
    case 'context.lock_released': {
      const n = typeof p?.released === 'number' ? p.released : null;
      return n !== null && n !== 1 ? `released · ${n}` : 'released';
    }
    case 'instance.registered': {
      const label = typeof p?.label === 'string' ? p.label : '';
      const adopted = p?.adopted === true;
      const pid = typeof p?.pid === 'number' ? `pid ${p.pid}` : '';
      const dir = typeof p?.directory === 'string' ? basename(p.directory) : '';
      const head = adopted ? 'adopted' : 'registered';
      const parts = [head, label, dir, pid].filter(Boolean);
      return parts.join(' · ');
    }
    case 'instance.deregistered': {
      const label = typeof p?.label === 'string' ? p.label : '';
      const pid = typeof p?.pid === 'number' ? `pid ${p.pid}` : '';
      const parts = ['deregistered', label, pid].filter(Boolean);
      return parts.join(' · ');
    }
    case 'instance.stale_reclaimed': {
      const label = typeof p?.label === 'string' ? p.label : '';
      const pid = typeof p?.pid === 'number' ? `pid ${p.pid}` : '';
      const parts = ['timed out', label, pid].filter(Boolean);
      return parts.join(' · ');
    }
    default:
      return '';
  }
}

/**
 * Render a message body inline. Collapses internal whitespace so a multi-line
 * message becomes one readable line; the expanded payload still shows the
 * original formatting verbatim.
 */
function formatMessagePreview(content: string, length: number | null): string {
  const collapsed = content.replace(/\s+/g, ' ').trim();
  const head = truncate(collapsed, 120);
  if (length === null || collapsed.length === content.length) return head;
  return `${head} (${length} chars)`;
}

/**
 * Drop surrounding quotes from JSON-encoded strings so a value like
 * `"hello"` reads as `hello` in the inline summary. Leaves objects and
 * arrays untouched.
 */
function stripJson(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      // fall through
    }
  }
  return value;
}

export function eventDetail(evt: Event): string {
  if (!evt.payload) return '(no payload)';
  try {
    return JSON.stringify(JSON.parse(evt.payload), null, 2);
  } catch {
    return evt.payload;
  }
}

export function isSystemRow(evt: Event): boolean {
  return evt.actor === 'system' || evt.type.startsWith('task.cascade.');
}
