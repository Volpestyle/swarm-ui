<!--
  Inspector.svelte — Selected node/edge detail panel

  Shows detail for selected node or edge:
  - Node selected: instance metadata, PTY metadata, task list, recent messages, file locks
  - Edge selected: full message history (message edge) or task detail (task edge)
  - Scrollable content area with close button to deselect
-->
<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import type {
    Annotation,
    Event,
    Instance,
    KvEntry,
    Task,
    SwarmNodeData,
    ConnectionEdgeData,
    XYFlowNode,
    XYFlowEdge,
  } from '../lib/types';
  import { formatRelative, formatTimestamp, timestampToMillis } from '../lib/time';
  import { isSystemMessage } from '../lib/messages';
  import { buildTaskTree, type TaskTreeRow } from '../lib/tasks';
  import {
    ACTIVITY_CATEGORIES,
    ALL_ACTIVITY_CATEGORY_FILTER,
    categoryOf,
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
  import Markdown from '../lib/Markdown.svelte';
  import WorkerLogViewer from './WorkerLogViewer.svelte';
  import {
    annotations,
    events as eventsStore,
    kvEntries,
    instances,
    tasks as taskStore,
  } from '../stores/swarm';

  export let selectedNode: XYFlowNode | null = null;
  export let selectedEdge: XYFlowEdge | null = null;

  const dispatch = createEventDispatcher<{ viewFullHistory: { scope: string | null } }>();

  // Determine what we're inspecting
  $: inspectingNode = selectedNode !== null;
  $: inspectingEdge = selectedEdge !== null && selectedNode === null;
  $: nodeData = selectedNode?.data as SwarmNodeData | null;

  // Every edge is now a unified `connection` bundling messages, tasks, and
  // dependencies between the same unordered instance pair.
  $: edgeData = selectedEdge?.data as ConnectionEdgeData | null;

  // Reference edgeData.messages directly so Svelte's reactive dep tracker
  // picks up the update. A wrapper function call would hide the read and
  // freeze messageHistory at its mount-time value.
  $: rawMessageHistory = (inspectingEdge && edgeData?.messages) || [];
  $: systemMessageCount = rawMessageHistory.filter(isSystemMessage).length;
  let hideSystemMessages = false;
  $: messageHistory = hideSystemMessages
    ? rawMessageHistory.filter((m) => !isSystemMessage(m))
    : rawMessageHistory;

  $: tasks = edgeData?.tasks ?? [];
  $: deps = edgeData?.deps ?? [];

  // Parent/subtask hierarchy. Each list builds an independent tree from
  // its own subset of tasks; tasks whose parent is in the global map but
  // missing from the subset get an externalParent for breadcrumbing.
  $: assignedTaskTree = buildTaskTree(
    nodeData?.assignedTasks ?? [],
    $taskStore,
  );
  $: requestedTaskTree = buildTaskTree(
    nodeData?.requestedTasks ?? [],
    $taskStore,
  );
  $: edgeTaskTree = buildTaskTree(tasks, $taskStore);

  function indentStyle(depth: number): string {
    return `padding-left: ${depth * 14}px;`;
  }

  function externalParentLabel(parent: { title: string }): string {
    const t = parent.title;
    return t.length > 40 ? `${t.slice(0, 40)}…` : t;
  }

  // -------------------------------------------------------------------
  // Coordination (KV) section state. Filter to the selected scope when a
  // node or edge is selected; otherwise show every non-`ui/*` entry.
  // -------------------------------------------------------------------

  $: selectedScope = deriveSelectedScope(nodeData, edgeData, $instances);
  $: visibleKv = filterKvByScope($kvEntries, selectedScope);

  let kvCollapsed = false;
  let expandedKvKeys = new Set<string>();

  function deriveSelectedScope(
    node: SwarmNodeData | null,
    edge: ConnectionEdgeData | null,
    instMap: Map<string, { scope: string }>,
  ): string | null {
    if (node?.instance?.scope) return node.instance.scope;
    if (edge) {
      const source = instMap.get(edge.sourceInstanceId);
      if (source?.scope) return source.scope;
      const target = instMap.get(edge.targetInstanceId);
      if (target?.scope) return target.scope;
    }
    return null;
  }

  function filterKvByScope(entries: KvEntry[], scope: string | null): KvEntry[] {
    if (!scope) return entries;
    return entries.filter((entry) => entry.scope === scope);
  }

  function kvRowKey(entry: KvEntry): string {
    return `${entry.scope}::${entry.key}`;
  }

  function toggleKvRow(entry: KvEntry): void {
    const key = kvRowKey(entry);
    const next = new Set(expandedKvKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedKvKeys = next;
  }

  function isKvExpanded(entry: KvEntry, expanded: Set<string>): boolean {
    return expanded.has(kvRowKey(entry));
  }

  function kvSummary(value: string): string {
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
  }

  function kvDetail(value: string): string {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }

  // -------------------------------------------------------------------
  // Worker log surfacing. Clanky writes a session record per worker into
  // KV at `clanky:code_worker_session:worker:<id>`. When the worker was
  // spawned via direct_child fallback (no swarm-server PTY), the record
  // includes `logPath` pointing at a file we can tail through the
  // worker_log_read Tauri command.
  // -------------------------------------------------------------------

  type WorkerLogTarget = {
    workerId: string;
    taskId: string | null;
    path: string;
  };

  let openWorkerLog: WorkerLogTarget | null = null;

  function parseWorkerLogTarget(entry: KvEntry): WorkerLogTarget | null {
    if (!entry.key.startsWith('clanky:code_worker_session:worker:')) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(entry.value);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const logPath = typeof record.logPath === 'string' ? record.logPath : '';
    if (!logPath) return null;
    const workerId = typeof record.workerId === 'string' ? record.workerId : '';
    if (!workerId) return null;
    const taskId = typeof record.taskId === 'string' && record.taskId ? record.taskId : null;
    return { workerId, taskId, path: logPath };
  }

  // -------------------------------------------------------------------
  // Context (annotations) section. When a node is selected, filter to
  // rows where instance_id === node.instance.id; otherwise filter by
  // selected scope, falling back to all entries.
  // -------------------------------------------------------------------

  $: visibleAnnotations = filterAnnotations(
    $annotations,
    nodeData?.instance?.id ?? null,
    selectedScope,
  );
  $: annotationsByType = groupAnnotationsByType(visibleAnnotations);
  $: annotationTypeOrder = orderTypes([...annotationsByType.keys()]);

  function filterAnnotations(
    rows: Annotation[],
    instanceId: string | null,
    scope: string | null,
  ): Annotation[] {
    if (instanceId) return rows.filter((a) => a.instance_id === instanceId);
    if (scope) return rows.filter((a) => a.scope === scope);
    return rows;
  }

  function groupAnnotationsByType(rows: Annotation[]): Map<string, Annotation[]> {
    const map = new Map<string, Annotation[]>();
    for (const row of rows) {
      const group = map.get(row.type);
      if (group) group.push(row);
      else map.set(row.type, [row]);
    }
    return map;
  }

  // Lock first (it's the high-frequency type), then everything else
  // alphabetically so the section stays predictable as new types appear.
  function orderTypes(types: string[]): string[] {
    const known = ['lock', 'finding', 'warning', 'bug', 'todo', 'note'];
    const seen = new Set(types);
    const ordered: string[] = [];
    for (const t of known) {
      if (seen.has(t)) {
        ordered.push(t);
        seen.delete(t);
      }
    }
    return [...ordered, ...[...seen].sort()];
  }

  function annotationTypeColor(type: string): string {
    switch (type) {
      case 'lock': return 'var(--status-stale, #f9e2af)';
      case 'finding': return 'var(--edge-message, #89b4fa)';
      case 'warning': return 'var(--status-stale, #f9e2af)';
      case 'bug': return 'var(--edge-task-failed, #f38ba8)';
      case 'todo': return 'var(--edge-task-open, #fab387)';
      case 'note': return '#a6adc8';
      default: return '#a6adc8';
    }
  }

  // -------------------------------------------------------------------
  // Activity section. Filter chips for the five event categories; when
  // a node or edge is selected, also restrict to events whose actor or
  // subject is one of the selected instance ids.
  // -------------------------------------------------------------------

  // Heartbeat thresholds mirror the server's `STALE` / offline cutoffs in
  // src/registry.ts (30s / 60s). Used by the liveness header below.
  const STALE_AFTER_MS = 30_000;
  const OFFLINE_AFTER_MS = 60_000;

  // Ring-buffer cap used by stores/swarm.ts. Surfaced in the UI when the
  // buffer is full so users know history is being dropped.
  const EVENTS_BUFFER_CAP = 500;

  let activityCollapsed = false;
  let activityFilter: Set<ActivityCategoryFilter> = new Set<ActivityCategoryFilter>([
    ALL_ACTIVITY_CATEGORY_FILTER,
  ]);
  let expandedEventIds = new Set<number>();

  // Tick driving relative-time labels and liveness staleness. Cheap reactive
  // dependency so timestamp-derived strings refresh without churning the
  // event store. Matches the pattern used in PairingSessionModal.
  let nowMs = Date.now();
  let nowTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    nowMs = Date.now();
    nowTimer = setInterval(() => {
      nowMs = Date.now();
    }, 5_000);
  });
  onDestroy(() => {
    if (nowTimer) {
      clearInterval(nowTimer);
      nowTimer = null;
    }
  });

  function toggleCategory(cat: EventCategory): void {
    const next = activityFilter.has(ALL_ACTIVITY_CATEGORY_FILTER)
      ? new Set<ActivityCategoryFilter>()
      : new Set(activityFilter);
    next.delete(ALL_ACTIVITY_CATEGORY_FILTER);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    activityFilter = next.size === 0 || next.size === ACTIVITY_CATEGORIES.length
      ? new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER])
      : next;
  }

  function selectAllActivityCategories(): void {
    activityFilter = new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER]);
  }

  function resetActivityFilters(): void {
    selectAllActivityCategories();
  }

  // Selected actors: when a node is selected we narrow to its instance id;
  // when an edge is selected we narrow to both endpoints. Empty set means
  // "no actor narrowing" (global scope-level view).
  $: selectedActors = deriveSelectedActors(nodeData, edgeData);

  function deriveSelectedActors(
    node: SwarmNodeData | null,
    edge: ConnectionEdgeData | null,
  ): Set<string> {
    const ids = new Set<string>();
    if (node?.instance?.id) ids.add(node.instance.id);
    if (edge?.sourceInstanceId) ids.add(edge.sourceInstanceId);
    if (edge?.targetInstanceId) ids.add(edge.targetInstanceId);
    return ids;
  }

  $: scopeMatchedEvents = filterEvents(
    $eventsStore,
    activityFilter,
    selectedScope,
    selectedActors,
  );
  $: scopeMatchedCount = filterEvents(
    $eventsStore,
    new Set<ActivityCategoryFilter>([ALL_ACTIVITY_CATEGORY_FILTER]),
    selectedScope,
    selectedActors,
  ).length;
  $: visibleEvents = scopeMatchedEvents;
  $: bufferFull = $eventsStore.length >= EVENTS_BUFFER_CAP;

  function filterEvents(
    rows: Event[],
    chips: Set<ActivityCategoryFilter>,
    scope: string | null,
    actors: Set<string>,
  ): Event[] {
    const out: Event[] = [];
    const includeAllCategories = chips.has(ALL_ACTIVITY_CATEGORY_FILTER);
    for (const row of rows) {
      if (scope && row.scope !== scope) continue;
      const cat = categoryOf(row.type);
      if (!cat || (!includeAllCategories && !chips.has(cat))) continue;
      if (actors.size > 0) {
        const actorMatch = row.actor !== null && actors.has(row.actor);
        const subjectMatch = row.subject !== null && actors.has(row.subject);
        if (!actorMatch && !subjectMatch) continue;
      }
      out.push(row);
    }
    // Newest first — store keeps the natural append order.
    return out.slice().reverse();
  }

  function toggleEventRow(evt: Event): void {
    const next = new Set(expandedEventIds);
    if (next.has(evt.id)) next.delete(evt.id);
    else next.add(evt.id);
    expandedEventIds = next;
  }

  // Liveness summary for the selected instance (single-node selection
  // only). Combines heartbeat freshness and the row-level `status` so the
  // user can tell at a glance whether quiet activity = "alive but idle"
  // vs "agent has gone away".
  type Liveness = {
    label: string;
    color: string;
    heartbeatRel: string;
    heartbeatAbs: string;
  };

  $: liveness = nodeData?.instance
    ? deriveLiveness(nodeData.instance, nowMs)
    : null;

  function deriveLiveness(inst: Instance, now: number): Liveness {
    const beatMs = timestampToMillis(inst.heartbeat) ?? 0;
    const age = beatMs ? now - beatMs : Infinity;
    let label: string;
    let color: string;
    if (age < STALE_AFTER_MS) {
      label = 'alive';
      color = 'var(--status-online, #a6e3a1)';
    } else if (age < OFFLINE_AFTER_MS) {
      label = 'stale';
      color = 'var(--status-stale, #f9e2af)';
    } else {
      label = 'offline';
      color = 'var(--status-offline, #f38ba8)';
    }
    return {
      label,
      color,
      heartbeatRel: formatRelative(inst.heartbeat, now),
      heartbeatAbs: formatTimestamp(inst.heartbeat),
    };
  }

  // -------------------------------------------------------------------
  // Per-section delete actions. Each writes to swarm.db via a dedicated
  // Tauri command; the 500ms poll then re-emits the snapshot and the
  // Inspector re-renders with the updated edgeData. No optimistic UI.
  // -------------------------------------------------------------------

  let pendingAction: string | null = null;
  let actionError: string | null = null;

  async function handleClearMessages(): Promise<void> {
    if (!edgeData) return;
    pendingAction = 'messages';
    actionError = null;
    try {
      await invoke<number>('ui_clear_messages', {
        instanceA: edgeData.sourceInstanceId,
        instanceB: edgeData.targetInstanceId,
      });
    } catch (err) {
      actionError = `Failed to clear messages: ${err}`;
    } finally {
      pendingAction = null;
    }
  }

  async function handleUnassignTask(taskId: string): Promise<void> {
    pendingAction = `task:${taskId}`;
    actionError = null;
    try {
      await invoke<boolean>('ui_unassign_task', { taskId });
    } catch (err) {
      actionError = `Failed to unassign task: ${err}`;
    } finally {
      pendingAction = null;
    }
  }

  async function handleRemoveDependency(
    dependentTaskId: string,
    dependencyTaskId: string,
  ): Promise<void> {
    pendingAction = `dep:${dependencyTaskId}->${dependentTaskId}`;
    actionError = null;
    try {
      await invoke<boolean>('ui_remove_dependency', {
        dependentTaskId,
        dependencyTaskId,
      });
    } catch (err) {
      actionError = `Failed to remove dependency: ${err}`;
    } finally {
      pendingAction = null;
    }
  }

  function statusBadgeColor(status: string): string {
    switch (status) {
      case 'online': return 'var(--status-online)';
      case 'stale': return 'var(--status-stale)';
      case 'offline': return 'var(--status-offline)';
      case 'pending': return 'var(--status-pending)';
      case 'open': case 'claimed': return 'var(--edge-task-open)';
      case 'in_progress': return 'var(--edge-task-in-progress)';
      case 'done': return 'var(--edge-task-done)';
      case 'failed': return 'var(--edge-task-failed)';
      case 'cancelled': case 'blocked': return 'var(--edge-task-cancelled)';
      default: return '#6c7086';
    }
  }
</script>

<div class="inspector">
  <div class="inspector-body">
    {#if inspectingNode && nodeData}
      <!-- ===== Node Inspection ===== -->

      <!-- Instance metadata -->
      {#if nodeData.instance}
        <section>
          <h4>Instance</h4>
          <div class="detail-grid">
            <span class="detail-label">ID</span>
            <span class="detail-value mono">{nodeData.instance.id}</span>

            <span class="detail-label">Status</span>
            <span class="detail-value">
              <span class="inline-badge" style="color: {statusBadgeColor(nodeData.instance.status)}">
                {nodeData.instance.status}
              </span>
            </span>

            <span class="detail-label">Scope</span>
            <span class="detail-value">{nodeData.instance.scope}</span>

            <span class="detail-label">PID</span>
            <span class="detail-value mono">{nodeData.instance.pid}</span>

            <span class="detail-label">Directory</span>
            <span class="detail-value mono" title={nodeData.instance.directory}>
              {nodeData.instance.directory}
            </span>

            <span class="detail-label">Label</span>
            <span class="detail-value">{nodeData.instance.label ?? '--'}</span>

            <span class="detail-label">Heartbeat</span>
            <span class="detail-value">{formatTimestamp(nodeData.instance.heartbeat)}</span>

            <span class="detail-label">Registered</span>
            <span class="detail-value">{formatTimestamp(nodeData.instance.registered_at)}</span>
          </div>
        </section>
      {/if}

      <!-- PTY metadata -->
      {#if nodeData.ptySession}
        <section>
          <h4>PTY Session</h4>
          <div class="detail-grid">
            <span class="detail-label">PTY ID</span>
            <span class="detail-value mono">{nodeData.ptySession.id}</span>

            <span class="detail-label">Command</span>
            <span class="detail-value mono">{nodeData.ptySession.command}</span>

            <span class="detail-label">CWD</span>
            <span class="detail-value mono" title={nodeData.ptySession.cwd}>
              {nodeData.ptySession.cwd}
            </span>

            <span class="detail-label">Started</span>
            <span class="detail-value">{formatTimestamp(nodeData.ptySession.started_at)}</span>

            {#if nodeData.ptySession.exit_code !== null}
              <span class="detail-label">Exit Code</span>
              <span class="detail-value" style="color: {nodeData.ptySession.exit_code === 0 ? 'var(--status-online)' : 'var(--edge-task-failed)'}">
                {nodeData.ptySession.exit_code}
              </span>
            {/if}

            {#if nodeData.ptySession.launch_token}
              <span class="detail-label">Token</span>
              <span class="detail-value mono">{nodeData.ptySession.launch_token}</span>
            {/if}
          </div>
        </section>
      {/if}

      <!-- Assigned tasks -->
      {#if assignedTaskTree.length > 0}
        <section>
          <h4>Assigned Tasks ({assignedTaskTree.length})</h4>
          <div class="task-list">
            {#each assignedTaskTree as row (row.task.id)}
              {#if row.externalParent}
                <div class="task-breadcrumb" style={indentStyle(row.depth)}>
                  ↑ parent: {externalParentLabel(row.externalParent)}
                </div>
              {/if}
              <div class="task-item" style={indentStyle(row.depth)}>
                {#if row.depth > 0}<span class="task-connector mono">└─</span>{/if}
                <span class="inline-badge" style="color: {statusBadgeColor(row.task.status)}">
                  {row.task.status}
                </span>
                <span class="task-title">{row.task.title}</span>
                <span class="task-type">{row.task.type}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Requested tasks -->
      {#if requestedTaskTree.length > 0}
        <section>
          <h4>Requested Tasks ({requestedTaskTree.length})</h4>
          <div class="task-list">
            {#each requestedTaskTree as row (row.task.id)}
              {#if row.externalParent}
                <div class="task-breadcrumb" style={indentStyle(row.depth)}>
                  ↑ parent: {externalParentLabel(row.externalParent)}
                </div>
              {/if}
              <div class="task-item" style={indentStyle(row.depth)}>
                {#if row.depth > 0}<span class="task-connector mono">└─</span>{/if}
                <span class="inline-badge" style="color: {statusBadgeColor(row.task.status)}">
                  {row.task.status}
                </span>
                <span class="task-title">{row.task.title}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}

    {:else if inspectingEdge && edgeData}
      <!-- ===== Edge Inspection =====
           Every selected edge is now a unified connection bundling every
           relationship between the two endpoints: messages either way,
           shared tasks, and task-level dependencies. -->

      <section class="endpoints">
        <div class="detail-grid">
          <span class="detail-label">A</span>
          <span class="detail-value mono">{edgeData.sourceInstanceId.slice(0, 12)}</span>
          <span class="detail-label">B</span>
          <span class="detail-value mono">{edgeData.targetInstanceId.slice(0, 12)}</span>
        </div>
      </section>

      {#if actionError}
        <div class="error-banner">{actionError}</div>
      {/if}

      {#if rawMessageHistory.length > 0}
        <section>
          <div class="section-head">
            <h4>
              Messages ({messageHistory.length}{hideSystemMessages && systemMessageCount > 0
                ? ` · ${systemMessageCount} hidden`
                : ''})
            </h4>
            {#if systemMessageCount > 0}
              <label class="hide-system-toggle" title="Hide [auto] and [signal:*] messages">
                <input
                  type="checkbox"
                  bind:checked={hideSystemMessages}
                />
                hide system
              </label>
            {/if}
            <button
              class="delete-btn"
              disabled={pendingAction === 'messages'}
              on:click={handleClearMessages}
            >
              {pendingAction === 'messages' ? 'Clearing…' : 'Clear history'}
            </button>
          </div>
          <div class="message-list">
            {#each messageHistory as msg (msg.id)}
              {@const sysMsg = isSystemMessage(msg)}
              <div class="message-item" class:system={sysMsg}>
                <div class="message-meta">
                  {#if sysMsg}
                    <span class="system-badge" title="Swarm-internal event, not a peer message">
                      SYSTEM
                    </span>
                  {/if}
                  <span class="message-sender mono">{msg.sender.slice(0, 8)}</span>
                  <span class="message-arrow">-&gt;</span>
                  <span class="message-recipient mono">{msg.recipient?.slice(0, 8) ?? 'broadcast'}</span>
                  <span class="message-time">{formatTimestamp(msg.created_at)}</span>
                </div>
                <div class="message-content">
                  <Markdown content={msg.content} />
                </div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if edgeTaskTree.length > 0}
        <section>
          <h4>Tasks ({edgeTaskTree.length})</h4>
          <div class="task-list">
            {#each edgeTaskTree as row (row.task.id)}
              {#if row.externalParent}
                <div class="task-breadcrumb" style={indentStyle(row.depth)}>
                  ↑ parent: {externalParentLabel(row.externalParent)}
                </div>
              {/if}
              <div class="task-row" style={indentStyle(row.depth)}>
                {#if row.depth > 0}<span class="task-connector mono">└─</span>{/if}
                <span class="inline-badge" style="color: {statusBadgeColor(row.task.status)}">
                  {row.task.status}
                </span>
                <span class="task-title" title={row.task.description ?? ''}>{row.task.title}</span>
                <span class="task-type">{row.task.type}</span>
                <button
                  class="delete-btn small"
                  disabled={pendingAction === `task:${row.task.id}`}
                  on:click={() => handleUnassignTask(row.task.id)}
                  title="Unassign this task (clears the assignee)"
                >
                  {pendingAction === `task:${row.task.id}` ? '…' : 'Unassign'}
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if deps.length > 0}
        <section>
          <h4>Dependencies ({deps.length})</h4>
          <div class="task-list">
            {#each deps as dep (dep.dependencyTaskId + dep.dependentTaskId)}
              <div class="task-row">
                <span
                  class="inline-badge"
                  style:color={dep.satisfied ? 'var(--edge-dep-satisfied)' : 'var(--edge-dep-blocked)'}
                >
                  {dep.satisfied ? 'satisfied' : 'blocked'}
                </span>
                <span class="task-title mono">{dep.dependencyTaskId.slice(0, 8)} → {dep.dependentTaskId.slice(0, 8)}</span>
                <button
                  class="delete-btn small"
                  disabled={pendingAction === `dep:${dep.dependencyTaskId}->${dep.dependentTaskId}`}
                  on:click={() => handleRemoveDependency(dep.dependentTaskId, dep.dependencyTaskId)}
                  title="Remove this dependency from the dependent task"
                >
                  {pendingAction === `dep:${dep.dependencyTaskId}->${dep.dependentTaskId}` ? '…' : 'Remove'}
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      {#if rawMessageHistory.length === 0 && edgeTaskTree.length === 0 && deps.length === 0}
        <div class="empty-state">No activity on this connection</div>
      {/if}

    {:else}
      <div class="empty-state">
        Select a node or edge to inspect
      </div>
    {/if}

    {#if visibleAnnotations.length > 0}
      <section class="context-section">
        <h4>
          Context ({visibleAnnotations.length}{nodeData?.instance ? '' : selectedScope ? '' : ' · all scopes'})
        </h4>
        <div class="annotation-groups">
          {#each annotationTypeOrder as type (type)}
            {@const rows = annotationsByType.get(type) ?? []}
            <div class="annotation-group">
              <div class="annotation-group-head">
                <span
                  class="type-chip"
                  style:color={annotationTypeColor(type)}
                  style:border-color={annotationTypeColor(type)}
                >
                  {type}
                </span>
                <span class="annotation-group-count">{rows.length}</span>
              </div>
              <div class="annotation-list">
                {#each rows as ann (ann.id)}
                  <div class="annotation-item">
                    {#if type === 'lock'}
                      <div class="annotation-file mono" title={ann.file}>{ann.file}</div>
                    {:else}
                      <div class="annotation-meta">
                        <span class="annotation-file mono" title={ann.file}>{ann.file}</span>
                        <span class="annotation-time">{formatTimestamp(ann.created_at)}</span>
                      </div>
                      <div class="annotation-content"><Markdown content={ann.content} /></div>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    {#if $eventsStore.length > 0}
      <section class="activity-section">
        <button
          type="button"
          class="kv-toggle"
          on:click={() => (activityCollapsed = !activityCollapsed)}
          aria-expanded={!activityCollapsed}
        >
          <span class="kv-caret" class:open={!activityCollapsed}>▸</span>
          <span class="kv-title">
            Activity ({visibleEvents.length}{selectedActors.size > 0
              ? ' · this selection'
              : selectedScope
              ? ''
              : ' · all scopes'})
          </span>
        </button>
        {#if !activityCollapsed}
          {#if liveness}
            <div class="activity-liveness" title={`heartbeat: ${liveness.heartbeatAbs}`}>
              <span class="liveness-dot" style:background={liveness.color}></span>
              <span class="liveness-label" style:color={liveness.color}>
                {liveness.label}
              </span>
              <span class="liveness-detail">
                · last beat {liveness.heartbeatRel}
              </span>
            </div>
          {/if}
          <div class="activity-chips">
            <button
              type="button"
              class="activity-chip"
              class:active={activityFilter.has(ALL_ACTIVITY_CATEGORY_FILTER)}
              style:color={activityFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) ? 'var(--terminal-fg, #c0caf5)' : '#6c7086'}
              style:border-color={activityFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) ? 'rgba(137, 180, 250, 0.5)' : 'rgba(108, 112, 134, 0.4)'}
              on:click={selectAllActivityCategories}
            >
              all
            </button>
            {#each ACTIVITY_CATEGORIES as cat (cat.id)}
              {@const on = !activityFilter.has(ALL_ACTIVITY_CATEGORY_FILTER) && activityFilter.has(cat.id)}
              <button
                type="button"
                class="activity-chip"
                class:active={on}
                style:color={on ? cat.color : '#6c7086'}
                style:border-color={on ? cat.color : 'rgba(108, 112, 134, 0.4)'}
                on:click={() => toggleCategory(cat.id)}
              >
                {cat.label}
              </button>
            {/each}
          </div>
          {#if bufferFull}
            <div class="activity-meta">
              Showing latest {EVENTS_BUFFER_CAP} events — older entries dropped.
              <button
                type="button"
                class="activity-reset"
                on:click={() => dispatch('viewFullHistory', { scope: selectedScope })}
              >
                view full history
              </button>
            </div>
          {:else}
            <div class="activity-meta-actions">
              <button
                type="button"
                class="activity-reset"
                on:click={() => dispatch('viewFullHistory', { scope: selectedScope })}
                title="Open the full event history modal with current scope"
              >
                view full history
              </button>
            </div>
          {/if}
          {#if visibleEvents.length === 0}
            <div class="activity-empty">
              {#if scopeMatchedCount > 0}
                <span>No events match the active category filters.</span>
                <button
                  type="button"
                  class="activity-reset"
                  on:click={resetActivityFilters}
                >
                  reset filters
                </button>
              {:else if selectedActors.size > 0}
                <span>No events involve this selection yet.</span>
              {:else if selectedScope}
                <span>No events recorded in this scope yet.</span>
              {:else}
                <span>No events recorded yet.</span>
              {/if}
            </div>
          {:else}
            <div class="activity-list">
              {#each visibleEvents as evt (evt.id)}
                {@const expanded = expandedEventIds.has(evt.id)}
                {@const system = isSystemRow(evt)}
                <div class="activity-row" class:expanded class:system>
                  <button
                    type="button"
                    class="activity-row-head"
                    on:click={() => toggleEventRow(evt)}
                  >
                    <span
                      class="activity-time"
                      title={formatTimestamp(evt.created_at)}
                    >
                      {formatRelative(evt.created_at, nowMs)}
                    </span>
                    <span class="activity-type" style:color={eventColor(evt.type)}>
                      {evt.type}
                    </span>
                    <span
                      class="activity-actor"
                      class:system-actor={evt.actor === 'system'}
                      title={evt.actor ?? '(no actor)'}
                    >
                      {formatInstanceRef(evt.actor, $instances)}
                    </span>
                    <span class="activity-arrow">›</span>
                    <span class="activity-subject" title={subjectTitle(evt)}>
                      {formatSubject(evt, $instances, $taskStore)}
                    </span>
                    <span class="activity-summary">
                      {eventSummary(evt, $instances, $taskStore)}
                    </span>
                  </button>
                  {#if expanded}
                    <pre class="activity-detail mono">{eventDetail(evt)}</pre>
                    {#if !selectedScope}
                      <div class="kv-meta">scope: <span class="mono">{evt.scope}</span></div>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    {#if visibleKv.length > 0}
      <section class="kv-section">
        <button
          type="button"
          class="kv-toggle"
          on:click={() => (kvCollapsed = !kvCollapsed)}
          aria-expanded={!kvCollapsed}
        >
          <span class="kv-caret" class:open={!kvCollapsed}>▸</span>
          <span class="kv-title">
            Coordination (KV) ({visibleKv.length}{selectedScope ? '' : ' · all scopes'})
          </span>
        </button>
        {#if !kvCollapsed}
          <div class="kv-list">
            {#each visibleKv as entry (kvRowKey(entry))}
              {@const expanded = isKvExpanded(entry, expandedKvKeys)}
              {@const workerLog = parseWorkerLogTarget(entry)}
              <div class="kv-row" class:expanded>
                <button
                  type="button"
                  class="kv-row-head"
                  on:click={() => toggleKvRow(entry)}
                  title={`updated ${formatTimestamp(entry.updated_at)}`}
                >
                  <span class="kv-key mono">{entry.key}</span>
                  {#if !expanded}
                    <span class="kv-value-summary mono">{kvSummary(entry.value)}</span>
                  {/if}
                </button>
                {#if workerLog}
                  <button
                    type="button"
                    class="kv-worker-log-btn"
                    on:click={() => (openWorkerLog = workerLog)}
                    title={`Tail ${workerLog.path}`}
                  >
                    view log
                  </button>
                {/if}
                {#if expanded}
                  <pre class="kv-value-detail mono">{kvDetail(entry.value)}</pre>
                  {#if !selectedScope}
                    <div class="kv-meta">scope: <span class="mono">{entry.scope}</span></div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

{#if openWorkerLog}
  <WorkerLogViewer
    path={openWorkerLog.path}
    workerId={openWorkerLog.workerId}
    taskId={openWorkerLog.taskId}
    onClose={() => (openWorkerLog = null)}
  />
{/if}

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    color: var(--terminal-fg, #c0caf5);
  }

  .inspector-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px 16px;
  }

  section {
    margin-bottom: 16px;
  }

  h4 {
    font-size: 11px;
    font-weight: 600;
    color: #a6adc8;
    margin: 0 0 8px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(108, 112, 134, 0.18);
  }

  section.endpoints {
    margin-bottom: 12px;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }

  .section-head h4 {
    flex: 1;
    margin: 0;
    padding-bottom: 0;
    border: none;
  }

  .delete-btn {
    background: transparent;
    border: 1px solid rgba(243, 139, 168, 0.35);
    color: var(--edge-task-failed, #f38ba8);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .delete-btn.small {
    padding: 2px 6px;
    font-size: 9.5px;
  }

  .delete-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--edge-task-failed) 15%, transparent);
    border-color: var(--edge-task-failed);
  }

  .delete-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .error-banner {
    margin-bottom: 10px;
    padding: 6px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--edge-task-failed) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--edge-task-failed) 35%, transparent);
    color: var(--edge-task-failed);
    font-size: 11px;
  }

  .task-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 12px;
    border-bottom: 1px solid rgba(108, 112, 134, 0.12);
  }

  .task-row:last-child {
    border-bottom: none;
  }

  .detail-grid {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 10px;
    font-size: 12px;
  }

  .detail-label {
    color: #6c7086;
    font-weight: 500;
  }

  .detail-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .inline-badge {
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
  }

  .task-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .task-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
    font-size: 12px;
  }

  .task-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-type {
    color: #6c7086;
    font-size: 10px;
    text-transform: uppercase;
  }

  .task-connector {
    color: #6c7086;
    font-size: 11px;
    flex-shrink: 0;
    margin-right: 2px;
  }

  .task-breadcrumb {
    color: #6c7086;
    font-size: 10px;
    font-style: italic;
    padding: 2px 0;
    border-bottom: none;
  }

  .annotation-groups {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .annotation-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .annotation-group-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .annotation-group-count {
    color: #6c7086;
    font-size: 10px;
  }

  .type-chip {
    display: inline-block;
    border: 1px solid;
    border-radius: 3px;
    padding: 1px 6px;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: transparent;
  }

  .annotation-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .annotation-item {
    padding: 3px 0;
    font-size: 11px;
    border-bottom: 1px solid rgba(108, 112, 134, 0.1);
  }

  .annotation-item:last-child {
    border-bottom: none;
  }

  .annotation-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 2px;
  }

  .annotation-file {
    color: #a6adc8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .annotation-time {
    color: #6c7086;
    font-size: 10px;
    flex-shrink: 0;
  }

  .annotation-content {
    color: #cdd6f4;
    font-size: 11px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .message-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .message-item {
    padding: 6px 0;
    border-bottom: 1px solid var(--node-border, #313244);
  }

  .message-item:last-child {
    border-bottom: none;
  }

  .message-item.system {
    background: rgba(108, 112, 134, 0.08);
    border-left: 2px solid #6c7086;
    padding-left: 8px;
    margin-left: -8px;
  }

  .message-item.system .message-content {
    color: #7a7f99;
  }

  .system-badge {
    display: inline-block;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(108, 112, 134, 0.2);
    color: #a6adc8;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    border: 1px solid rgba(108, 112, 134, 0.4);
  }

  .hide-system-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #6c7086;
    cursor: pointer;
    user-select: none;
  }

  .hide-system-toggle input {
    margin: 0;
    cursor: pointer;
    accent-color: #6c7086;
  }

  .hide-system-toggle:hover {
    color: #a6adc8;
  }

  .message-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #6c7086;
    margin-bottom: 4px;
  }

  .message-sender {
    color: var(--edge-message, #89b4fa);
  }

  .message-arrow {
    color: #6c7086;
  }

  .message-recipient {
    color: var(--badge-reviewer, #a6e3a1);
  }

  .message-time {
    margin-left: auto;
  }

  .message-content {
    font-size: 12px;
    line-height: 1.4;
    color: #a6adc8;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .empty-state {
    text-align: center;
    color: #6c7086;
    font-size: 12px;
    padding: 20px 0;
  }

  .context-section,
  .kv-section,
  .activity-section {
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid rgba(108, 112, 134, 0.18);
  }

  .activity-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .activity-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid;
    background: transparent;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: opacity 0.12s ease;
  }

  .activity-chip.active {
    opacity: 1;
  }

  .activity-chip:not(.active) {
    opacity: 0.55;
  }

  .activity-empty {
    color: #6c7086;
    font-size: 11px;
    padding: 4px 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .activity-reset {
    background: transparent;
    border: 1px solid rgba(108, 112, 134, 0.4);
    color: #a6adc8;
    border-radius: 10px;
    padding: 2px 8px;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: border-color 0.12s ease, color 0.12s ease;
  }

  .activity-reset:hover {
    border-color: var(--terminal-fg, #c0caf5);
    color: var(--terminal-fg, #c0caf5);
  }

  .activity-meta {
    color: #6c7086;
    font-size: 9.5px;
    padding: 2px 0 4px 0;
    font-style: italic;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .activity-meta-actions {
    display: flex;
    justify-content: flex-end;
    padding: 2px 0 4px 0;
  }

  .activity-liveness {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0 8px 0;
    font-size: 10.5px;
  }

  .liveness-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .liveness-label {
    font-weight: 600;
    text-transform: lowercase;
    letter-spacing: 0.04em;
  }

  .liveness-detail {
    color: #6c7086;
  }

  .activity-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .activity-row {
    border-radius: 3px;
  }

  .activity-row.expanded {
    background: rgba(108, 112, 134, 0.06);
  }

  .activity-row.system .activity-row-head {
    font-style: italic;
  }

  .activity-row.system .activity-type {
    opacity: 0.85;
  }

  .activity-row-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 3px 6px;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    overflow: hidden;
  }

  .activity-row-head:hover {
    background: rgba(108, 112, 134, 0.1);
  }

  .activity-time {
    color: #6c7086;
    font-size: 9.5px;
    flex-shrink: 0;
    width: 52px;
    text-align: right;
  }

  .activity-type {
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .activity-actor {
    color: #a6adc8;
    font-size: 10px;
    flex-shrink: 0;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-actor.system-actor {
    color: #6c7086;
    font-style: italic;
  }

  .activity-arrow {
    color: #6c7086;
    font-size: 10px;
    flex-shrink: 0;
  }

  .activity-subject {
    color: #a6adc8;
    font-size: 10px;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-summary {
    color: #6c7086;
    font-size: 10px;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-detail {
    margin: 0;
    padding: 4px 8px 6px 8px;
    font-size: 10.5px;
    line-height: 1.4;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 240px;
    overflow: auto;
  }

  .kv-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 0 0 8px 0;
    color: #a6adc8;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    text-align: left;
  }

  .kv-toggle:hover {
    color: var(--terminal-fg, #c0caf5);
  }

  .kv-caret {
    display: inline-block;
    color: #6c7086;
    font-size: 9px;
    transition: transform 0.12s ease;
  }

  .kv-caret.open {
    transform: rotate(90deg);
  }

  .kv-title {
    flex: 1;
  }

  .kv-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .kv-row {
    border-radius: 3px;
  }

  .kv-row.expanded {
    background: rgba(108, 112, 134, 0.06);
  }

  .kv-row-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 4px 6px;
    text-align: left;
    cursor: pointer;
    color: inherit;
    font: inherit;
    overflow: hidden;
  }

  .kv-worker-log-btn {
    margin: 0 6px 4px;
    padding: 2px 8px;
    background: rgba(137, 180, 250, 0.16);
    border: 1px solid rgba(137, 180, 250, 0.45);
    color: var(--accent, #89b4fa);
    border-radius: 3px;
    font-size: 10px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    cursor: pointer;
  }

  .kv-worker-log-btn:hover {
    background: rgba(137, 180, 250, 0.28);
  }

  .kv-row-head:hover {
    background: rgba(108, 112, 134, 0.1);
  }

  .kv-key {
    color: var(--edge-message, #89b4fa);
    flex-shrink: 0;
    font-size: 11px;
  }

  .kv-value-summary {
    color: #a6adc8;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .kv-value-detail {
    margin: 0;
    padding: 6px 8px 8px 8px;
    font-size: 11px;
    line-height: 1.4;
    color: #cdd6f4;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 280px;
    overflow: auto;
  }

  .kv-meta {
    padding: 0 8px 6px 8px;
    color: #6c7086;
    font-size: 10px;
  }
</style>
