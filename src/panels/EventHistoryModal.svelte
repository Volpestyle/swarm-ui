<!--
  EventHistoryModal.svelte — full audit-log explorer.

  The Inspector's Activity timeline is a 500-row ring buffer fed by the live
  delta stream; once history scrolls past that cap it disappears from the UI
  even though `swarm.db` still has the full record. This modal queries the
  events table directly through the `event_history_query` Tauri command and
  paginates back through deep history with filter chips matching the
  Inspector's vocabulary (scope, category, actor, free text, time range).
-->
<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import {
    ACTIVITY_CATEGORIES,
    ALL_ACTIVITY_CATEGORY_FILTER,
    eventColor,
    eventDetail,
    eventSummary,
    formatInstanceRef,
    formatSubject,
    isSystemRow,
    subjectTitle,
    type ActivityCategoryFilter,
    type EventCategory,
  } from '../lib/eventFormat';
  import {
    availableScopes,
    instances as scopedInstances,
    tasks as scopedTasks,
  } from '../stores/swarm';
  import { formatRelative, formatTimestamp } from '../lib/time';
  import type { Event as SwarmEvent, Instance } from '../lib/types';

  const dispatch = createEventDispatcher<{ close: void }>();

  // ---------------------------------------------------------------------
  // Filter state
  // ---------------------------------------------------------------------

  /** Optional scope to seed the dropdown when opened from a scoped surface. */
  export let initialScope: string | null = null;

  type TimeRange = 'all' | '1h' | '24h' | '7d' | '30d';

  let scopeFilter: string = initialScope ?? '';
  let categoryFilter: Set<ActivityCategoryFilter> = new Set<ActivityCategoryFilter>([
    ALL_ACTIVITY_CATEGORY_FILTER,
  ]);
  let actorFilter: string = '';
  let textFilter: string = '';
  let textInputDebounced: string = '';
  let timeRange: TimeRange = 'all';
  const PAGE_SIZE = 200;

  const TIME_RANGE_OPTIONS: ReadonlyArray<{ id: TimeRange; label: string }> = [
    { id: 'all', label: 'all' },
    { id: '1h', label: '1h' },
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
  ];

  // ---------------------------------------------------------------------
  // Result state
  // ---------------------------------------------------------------------

  interface EventHistoryPage {
    events: SwarmEvent[];
    hasMore: boolean;
    oldestId: number | null;
    totalInDb: number;
  }

  let events: SwarmEvent[] = [];
  let oldestId: number | null = null;
  let hasMore = false;
  let totalInDb = 0;
  let loading = false;
  let loadingMore = false;
  let error: string | null = null;
  let expandedEventIds = new Set<number>();

  // Tick driving relative-time labels so timestamps refresh without
  // refetching. 5s matches the Inspector cadence.
  let nowMs = Date.now();
  let nowTimer: ReturnType<typeof setInterval> | null = null;

  let textDebounceHandle: ReturnType<typeof setTimeout> | null = null;

  // ---------------------------------------------------------------------
  // Derived: instance label list for the actor dropdown. Pulls from the
  // global (scope-filtered) store so a scope switch reshapes the list.
  // ---------------------------------------------------------------------
  $: actorOptions = buildActorOptions($scopedInstances);

  function buildActorOptions(map: Map<string, Instance>): Array<{
    id: string;
    label: string;
  }> {
    const opts: Array<{ id: string; label: string }> = [];
    for (const inst of map.values()) {
      opts.push({ id: inst.id, label: inst.label ?? shortId(inst.id) });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }

  function shortId(value: string): string {
    return value.length > 12 ? value.slice(0, 8) : value;
  }

  function timeRangeStartSecs(range: TimeRange): number | null {
    if (range === 'all') return null;
    const nowSec = Math.floor(Date.now() / 1000);
    switch (range) {
      case '1h': return nowSec - 3600;
      case '24h': return nowSec - 86_400;
      case '7d': return nowSec - 7 * 86_400;
      case '30d': return nowSec - 30 * 86_400;
      default: return null;
    }
  }

  function buildQuery(beforeId: number | null = null): {
    scope: string | null;
    categories: string[] | null;
    actor: string | null;
    text: string | null;
    startAt: number | null;
    beforeId: number | null;
    limit: number;
  } {
    const cats =
      categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER)
        ? null
        : Array.from(categoryFilter).filter(
            (cat): cat is EventCategory => cat !== ALL_ACTIVITY_CATEGORY_FILTER,
          );
    return {
      scope: scopeFilter || null,
      categories: cats,
      actor: actorFilter || null,
      text: textFilter.trim() || null,
      startAt: timeRangeStartSecs(timeRange),
      beforeId,
      limit: PAGE_SIZE,
    };
  }

  async function fetchPage(beforeId: number | null): Promise<EventHistoryPage> {
    return invoke<EventHistoryPage>('event_history_query', {
      query: buildQuery(beforeId),
    });
  }

  async function refresh(): Promise<void> {
    loading = true;
    error = null;
    try {
      const page = await fetchPage(null);
      events = page.events;
      hasMore = page.hasMore;
      oldestId = page.oldestId;
      totalInDb = page.totalInDb;
      expandedEventIds = new Set();
    } catch (err) {
      error = `Failed to load events: ${err instanceof Error ? err.message : err}`;
    } finally {
      loading = false;
    }
  }

  async function loadOlder(): Promise<void> {
    if (loadingMore || !hasMore || oldestId === null) return;
    loadingMore = true;
    error = null;
    try {
      const page = await fetchPage(oldestId);
      events = [...events, ...page.events];
      hasMore = page.hasMore;
      oldestId = page.oldestId;
      totalInDb = page.totalInDb;
    } catch (err) {
      error = `Failed to load older events: ${err instanceof Error ? err.message : err}`;
    } finally {
      loadingMore = false;
    }
  }

  // Reactive refetch on filter change. Text input has its own debounce so
  // typing a search string doesn't fire a query per keystroke.
  $: void scopeFilter, categoryFilter, actorFilter, textInputDebounced, timeRange,
    refresh();

  function onTextInput(event: globalThis.Event): void {
    const target = event.currentTarget as HTMLInputElement;
    textFilter = target.value;
    if (textDebounceHandle) clearTimeout(textDebounceHandle);
    textDebounceHandle = setTimeout(() => {
      textInputDebounced = textFilter;
    }, 250);
  }

  function toggleCategory(cat: EventCategory): void {
    const next = categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER)
      ? new Set<ActivityCategoryFilter>()
      : new Set(categoryFilter);
    next.delete(ALL_ACTIVITY_CATEGORY_FILTER);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    categoryFilter = next.size === 0 || next.size === ACTIVITY_CATEGORIES.length
      ? new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER])
      : next;
  }

  function selectAllCategories(): void {
    categoryFilter = new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER]);
  }

  function clearAllFilters(): void {
    scopeFilter = '';
    categoryFilter = new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER]);
    actorFilter = '';
    textFilter = '';
    textInputDebounced = '';
    timeRange = 'all';
  }

  function toggleEventRow(evt: SwarmEvent): void {
    const next = new Set(expandedEventIds);
    if (next.has(evt.id)) next.delete(evt.id);
    else next.add(evt.id);
    expandedEventIds = next;
  }

  function dismissError(): void {
    error = null;
  }

  function close(): void {
    dispatch('close');
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  function shortScope(scope: string): string {
    const parts = scope.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? scope;
  }

  onMount(() => {
    nowTimer = setInterval(() => {
      nowMs = Date.now();
    }, 5_000);
  });

  onDestroy(() => {
    if (nowTimer) clearInterval(nowTimer);
    if (textDebounceHandle) clearTimeout(textDebounceHandle);
  });

  // Filter summary badge for the header — shows how many filters are active
  // so the user can tell at a glance whether they're looking at a narrowed
  // slice or the full firehose.
  $: activeFilterCount = countActiveFilters(
    scopeFilter,
    categoryFilter,
    actorFilter,
    textInputDebounced,
    timeRange,
  );

  function countActiveFilters(
    scope: string,
    cats: Set<ActivityCategoryFilter>,
    actor: string,
    text: string,
    range: TimeRange,
  ): number {
    let n = 0;
    if (scope) n += 1;
    if (!cats.has(ALL_ACTIVITY_CATEGORY_FILTER)) n += 1;
    if (actor) n += 1;
    if (text.trim()) n += 1;
    if (range !== 'all') n += 1;
    return n;
  }
</script>

<svelte:window on:keydown={handleWindowKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="event-history-title">
  <div class="modal">
    <header class="header">
      <div class="title-block">
        <h2 id="event-history-title">Event History</h2>
        <p class="subtitle">
          {#if loading && events.length === 0}
            Loading…
          {:else}
            Showing {events.length} of {totalInDb.toLocaleString()} matching events
            {#if activeFilterCount > 0}
              · {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} active
            {/if}
          {/if}
        </p>
      </div>
      <div class="header-actions">
        <button type="button" class="ghost-btn" on:click={() => refresh()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          class="close-btn"
          on:click={close}
          aria-label="Close event history"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M3 3 L11 11 M11 3 L3 11" />
          </svg>
        </button>
      </div>
    </header>

    <div class="filter-bar">
      <label class="field">
        <span>scope</span>
        <select bind:value={scopeFilter}>
          <option value="">all scopes</option>
          {#each $availableScopes as scope (scope)}
            <option value={scope}>{shortScope(scope)}</option>
          {/each}
        </select>
      </label>

      <label class="field">
        <span>actor</span>
        <select bind:value={actorFilter}>
          <option value="">any actor</option>
          <option value="system">system</option>
          {#each actorOptions as opt (opt.id)}
            <option value={opt.id}>{opt.label}</option>
          {/each}
        </select>
      </label>

      <label class="field grow">
        <span>search</span>
        <input
          type="search"
          placeholder="type or payload substring"
          value={textFilter}
          on:input={onTextInput}
          spellcheck="false"
          autocomplete="off"
        />
      </label>

      <div class="field">
        <span>time</span>
        <div class="time-buttons" role="group" aria-label="Time range">
          {#each TIME_RANGE_OPTIONS as opt (opt.id)}
            <button
              type="button"
              class="time-btn"
              class:active={timeRange === opt.id}
              on:click={() => (timeRange = opt.id)}
            >
              {opt.label}
            </button>
          {/each}
        </div>
      </div>

      <div class="field categories">
        <span>categories</span>
        <div class="category-chips">
          <button
            type="button"
            class="chip"
            class:active={categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER)}
            style:color={categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) ? 'var(--terminal-fg, #c0caf5)' : '#6c7086'}
            style:border-color={categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) ? 'rgba(137, 180, 250, 0.5)' : 'rgba(108, 112, 134, 0.4)'}
            on:click={selectAllCategories}
          >
            all
          </button>
          {#each ACTIVITY_CATEGORIES as cat (cat.id)}
            {@const on = !categoryFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) && categoryFilter.has(cat.id)}
            <button
              type="button"
              class="chip"
              class:active={on}
              style:color={on ? cat.color : '#6c7086'}
              style:border-color={on ? cat.color : 'rgba(108, 112, 134, 0.4)'}
              on:click={() => toggleCategory(cat.id)}
            >
              {cat.label}
            </button>
          {/each}
        </div>
      </div>

      {#if activeFilterCount > 0}
        <button type="button" class="clear-btn" on:click={clearAllFilters}>
          clear filters
        </button>
      {/if}
    </div>

    {#if error}
      <div class="alert" role="alert">
        <span>{error}</span>
        <button type="button" class="alert-dismiss" on:click={dismissError} aria-label="Dismiss">×</button>
      </div>
    {/if}

    <div class="results">
      {#if loading && events.length === 0}
        <div class="empty">Loading events…</div>
      {:else if events.length === 0}
        <div class="empty">
          <span>No events match the current filters.</span>
          {#if activeFilterCount > 0}
            <button type="button" class="reset-btn" on:click={clearAllFilters}>
              clear filters
            </button>
          {/if}
        </div>
      {:else}
        <ol class="event-list">
          {#each events as evt (evt.id)}
            {@const expanded = expandedEventIds.has(evt.id)}
            {@const system = isSystemRow(evt)}
            <li class="row" class:expanded class:system>
              <button
                type="button"
                class="row-head"
                on:click={() => toggleEventRow(evt)}
              >
                <span class="time" title={formatTimestamp(evt.created_at)}>
                  {formatRelative(evt.created_at, nowMs)}
                </span>
                <span class="type" style:color={eventColor(evt.type)}>
                  {evt.type}
                </span>
                <span class="scope mono">{shortScope(evt.scope)}</span>
                <span
                  class="actor"
                  class:system-actor={evt.actor === 'system'}
                  title={evt.actor ?? '(no actor)'}
                >
                  {formatInstanceRef(evt.actor, $scopedInstances)}
                </span>
                <span class="arrow">›</span>
                <span class="subject" title={subjectTitle(evt)}>
                  {formatSubject(evt, $scopedInstances, $scopedTasks)}
                </span>
                <span class="summary">
                  {eventSummary(evt, $scopedInstances, $scopedTasks)}
                </span>
                <span class="id mono">#{evt.id}</span>
              </button>
              {#if expanded}
                <pre class="detail mono">{eventDetail(evt)}</pre>
                <div class="meta">
                  scope: <span class="mono">{evt.scope}</span>
                  · actor: <span class="mono">{evt.actor ?? '—'}</span>
                  · subject: <span class="mono">{evt.subject ?? '—'}</span>
                  · {formatTimestamp(evt.created_at)}
                </div>
              {/if}
            </li>
          {/each}
        </ol>

        <div class="pager">
          {#if hasMore}
            <button type="button" class="ghost-btn" on:click={loadOlder} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : `Load older (${PAGE_SIZE})`}
            </button>
          {:else}
            <span class="pager-end">End of history.</span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: stretch;
    justify-content: center;
    padding: 32px;
    background: rgba(6, 7, 12, 0.42);
    backdrop-filter: blur(18px) saturate(1.08);
    -webkit-backdrop-filter: blur(18px) saturate(1.08);
  }

  .modal {
    width: min(1200px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    border-radius: 16px;
    background: var(--panel-bg, rgba(30, 30, 46, 0.78));
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.38);
    backdrop-filter: blur(var(--surface-blur, 20px)) saturate(1.12);
    -webkit-backdrop-filter: blur(var(--surface-blur, 20px)) saturate(1.12);
    overflow: hidden;
    color: var(--terminal-fg, #c0caf5);
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
  }

  .title-block h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 650;
  }

  .subtitle {
    margin: 4px 0 0;
    font-size: 11.5px;
    color: #8f94b2;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .ghost-btn {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    background: rgba(17, 17, 27, 0.42);
    color: var(--terminal-fg, #c0caf5);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .ghost-btn:hover:not(:disabled) {
    background: rgba(108, 112, 134, 0.18);
    border-color: rgba(137, 180, 250, 0.5);
  }

  .ghost-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: #8f94b2;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s ease, color 0.12s ease;
  }

  .close-btn:hover {
    background: rgba(108, 112, 134, 0.16);
    color: var(--terminal-fg, #c0caf5);
  }

  .filter-bar {
    display: grid;
    grid-template-columns:
      minmax(140px, 1fr)
      minmax(140px, 1fr)
      minmax(180px, 2fr)
      minmax(180px, 1fr)
      minmax(280px, 2fr)
      auto;
    gap: 12px;
    padding: 14px 20px;
    align-items: end;
    border-bottom: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    background: rgba(17, 17, 27, 0.18);
  }

  @media (max-width: 1100px) {
    .filter-bar {
      grid-template-columns: repeat(2, minmax(180px, 1fr));
    }
    .filter-bar .grow {
      grid-column: span 2;
    }
    .filter-bar .categories {
      grid-column: span 2;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .field > span {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6c7086;
  }

  .field select,
  .field input[type="search"] {
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    background: rgba(17, 17, 27, 0.62);
    color: var(--terminal-fg, #c0caf5);
    padding: 6px 8px;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    outline: none;
  }

  .field select:focus,
  .field input[type="search"]:focus {
    border-color: rgba(137, 180, 250, 0.6);
    background: rgba(17, 17, 27, 0.78);
  }

  .field.grow {
    min-width: 0;
  }

  .time-buttons {
    display: flex;
    gap: 4px;
  }

  .time-btn {
    flex: 1;
    padding: 5px 6px;
    border-radius: 6px;
    border: 1px solid var(--node-border, rgba(108, 112, 134, 0.44));
    background: rgba(17, 17, 27, 0.42);
    color: #8f94b2;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  }

  .time-btn:hover {
    color: var(--terminal-fg, #c0caf5);
  }

  .time-btn.active {
    color: var(--terminal-fg, #c0caf5);
    border-color: rgba(137, 180, 250, 0.5);
    background: rgba(137, 180, 250, 0.16);
  }

  .category-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    padding: 3px 9px;
    border-radius: 11px;
    border: 1px solid;
    background: transparent;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: opacity 0.12s ease;
  }

  .chip.active {
    opacity: 1;
  }

  .chip:not(.active) {
    opacity: 0.55;
  }

  .reset-btn,
  .clear-btn {
    padding: 4px 10px;
    border-radius: 11px;
    border: 1px solid rgba(108, 112, 134, 0.4);
    background: transparent;
    color: #a6adc8;
    font: inherit;
    font-size: 10.5px;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }

  .clear-btn {
    align-self: end;
    height: 30px;
  }

  .reset-btn:hover,
  .clear-btn:hover {
    color: var(--terminal-fg, #c0caf5);
    border-color: var(--terminal-fg, #c0caf5);
  }

  .alert {
    margin: 10px 20px 0;
    padding: 8px 12px;
    border: 1px solid rgba(243, 139, 168, 0.5);
    background: rgba(243, 139, 168, 0.1);
    border-radius: 8px;
    color: #f38ba8;
    font-size: 11.5px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .alert-dismiss {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }

  .results {
    flex: 1;
    overflow-y: auto;
    padding: 8px 20px 20px;
    min-height: 240px;
  }

  .empty {
    color: #6c7086;
    font-size: 12px;
    padding: 32px 0;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .event-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .row {
    border-radius: 4px;
  }

  .row.expanded {
    background: rgba(108, 112, 134, 0.08);
  }

  .row.system .row-head {
    font-style: italic;
  }

  .row.system .type {
    opacity: 0.85;
  }

  .row-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 5px 8px;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    font-size: 11px;
    overflow: hidden;
  }

  .row-head:hover {
    background: rgba(108, 112, 134, 0.12);
  }

  .time {
    color: #6c7086;
    font-size: 10px;
    flex-shrink: 0;
    width: 64px;
    text-align: right;
  }

  .type {
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
    min-width: 130px;
  }

  .scope {
    color: #8f94b2;
    font-size: 10.5px;
    flex-shrink: 0;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actor {
    color: #a6adc8;
    flex-shrink: 0;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actor.system-actor {
    color: #6c7086;
    font-style: italic;
  }

  .arrow {
    color: #6c7086;
    flex-shrink: 0;
  }

  .subject {
    color: #cdd6f4;
    flex-shrink: 0;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary {
    color: #6c7086;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .id {
    color: #4f5266;
    font-size: 10px;
    flex-shrink: 0;
  }

  .detail {
    margin: 0 8px;
    padding: 8px 12px 10px;
    font-size: 10.5px;
    line-height: 1.45;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 320px;
    overflow: auto;
    background: rgba(17, 17, 27, 0.4);
    border-radius: 4px;
  }

  .meta {
    padding: 4px 16px 8px;
    color: #6c7086;
    font-size: 10px;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
  }

  .pager {
    display: flex;
    justify-content: center;
    padding: 16px 0 4px;
  }

  .pager-end {
    color: #6c7086;
    font-size: 10.5px;
    font-style: italic;
  }
</style>
