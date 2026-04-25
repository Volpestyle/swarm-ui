<!--
  NodeHeader.svelte — Shared node header chrome
  
  Displays role badge, status dot, label, CWD, task count, and control buttons.
  Used as the top bar of every TerminalNode card.
-->
<script lang="ts">
  import type { Lock, NodeType, InstanceStatus, Task } from '../lib/types';
  import {
    closePty,
    deregisterInstance,
    respawnInstance,
    retirableInstanceIds,
  } from '../stores/pty';
  import { createEventDispatcher } from 'svelte';

  export let role: string = '';
  export let instanceId: string | null = null;
  export let status: InstanceStatus | 'pending' = 'offline';
  export let cwd: string = '';
  export let nodeType: NodeType = 'instance';
  export let assignedTasks: Task[] = [];
  export let locks: Lock[] = [];
  export let ptyId: string | null = null;
  export let launchToken: string | null = null;
  /**
   * Optional friendly identifier set at launch time. Takes priority over the
   * instance UUID prefix in the header label.
   */
  export let displayName: string | null = null;
  export let mobileControlled: boolean = false;
  export let mobileLeaseHolder: string | null = null;
  export let compact: boolean = false;
  /**
   * `false` while this node's instance row was UI-pre-created and the
   * child process inside the PTY hasn't yet called `swarm.register`. The
   * node is connectable (messages route via the known instance id) but
   * the child isn't guaranteed to consume them until adoption lands.
   */
  export let adopted: boolean = true;

  const dispatch = createEventDispatcher<{
    inspect: void;
    focus: void;
    compact: void;
    fullscreen: void;
    fillCanvas: void;
  }>();

  // Determine the role class for badge styling
  $: roleClass = getRoleClass(role);
  $: displayLabel = deriveDisplayLabel(displayName, instanceId, launchToken, ptyId);
  $: statusLabel = getStatusLabel(status);
  $: activeTaskCount = assignedTasks.filter(
    (t) => t.status === 'in_progress' || t.status === 'claimed' || t.status === 'open'
  ).length;
  $: lockCount = locks.length;
  $: lockTooltip = lockCount > 0
    ? locks.map((l) => l.file).join('\n')
    : '';
  $: isAppOwned = nodeType === 'pty' || nodeType === 'bound';
  $: showAdopting = instanceId !== null && !adopted;
  $: canRetireRecentlyStopped =
    instanceId !== null && $retirableInstanceIds.has(instanceId);
  // Disconnected instance-only rows can be retired once their heartbeat ages
  // out, or immediately when this UI observed the bound PTY exit.
  $: canRemoveInstance =
    nodeType === 'instance' &&
    instanceId !== null &&
    (status === 'offline' || status === 'stale' || canRetireRecentlyStopped);
  // Show the respawn button only on instance-only nodes whose heartbeat has
  // aged out — meaning the owning process is gone and reviving the swarm
  // row with a fresh PTY is useful. Online externals are excluded so we
  // don't spawn a duplicate PTY competing with a live process.
  $: canRespawnInstance =
    nodeType === 'instance' &&
    instanceId !== null &&
    (status === 'offline' || status === 'stale');
  $: canClose = Boolean(ptyId) || canRemoveInstance;
  $: canFullscreen = Boolean(ptyId);
  let respawning = false;
  let nextAlertId = 1;
  let errorAlerts: Array<{ id: number; message: string }> = [];
  $: mobileTooltip = mobileLeaseHolder
    ? `Controlled from mobile (${mobileLeaseHolder})`
    : 'Controlled from mobile';

  function deriveDisplayLabel(
    name: string | null,
    instId: string | null,
    token: string | null,
    pty: string | null,
  ): string {
    if (name) return name;
    if (instId) return instId.slice(0, 12);
    if (token) return 'Pending...';
    if (pty) return pty.slice(0, 8);
    return '—';
  }

  function getStatusLabel(s: InstanceStatus | 'pending'): string {
    switch (s) {
      case 'online': return 'Online';
      case 'stale': return 'Stale';
      case 'offline': return 'Offline';
      case 'pending': return 'Connecting';
      default: return 'Offline';
    }
  }

  function getRoleClass(r: string): string {
    const lower = r.toLowerCase();
    if (lower.includes('planner')) return 'planner';
    if (lower.includes('implement')) return 'implementer';
    if (lower.includes('review')) return 'reviewer';
    if (lower.includes('research')) return 'researcher';
    if (lower.includes('shell') || lower === '$shell') return 'shell';
    if (!r) return 'shell';
    return 'custom';
  }

  function describeError(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const obj = err as { message?: unknown; kind?: unknown };
      if (typeof obj.message === 'string' && obj.message) return obj.message;
      if (typeof obj.kind === 'string' && obj.kind) return obj.kind;
    }
    return String(err);
  }

  function pushErrorAlert(message: string): void {
    errorAlerts = [...errorAlerts, { id: nextAlertId++, message }];
  }

  function dismissErrorAlert(id: number): void {
    errorAlerts = errorAlerts.filter((alert) => alert.id !== id);
  }

  function clearErrorAlerts(): void {
    errorAlerts = [];
  }

  async function handleStop() {
    if (!ptyId) return;
    try {
      await closePty(ptyId);
      clearErrorAlerts();
    } catch (err) {
      console.error('[NodeHeader] failed to close PTY:', err);
      pushErrorAlert(`Failed to stop PTY: ${describeError(err)}`);
    }
  }

  async function handleRemoveInstance() {
    if (!instanceId) return;
    try {
      await deregisterInstance(instanceId);
      clearErrorAlerts();
    } catch (err) {
      console.error('[NodeHeader] failed to deregister instance:', err);
      pushErrorAlert(`Failed to remove agent: ${describeError(err)}`);
    }
  }

  async function handleRespawnInstance() {
    if (!instanceId || respawning) return;
    respawning = true;
    try {
      await respawnInstance(instanceId);
      clearErrorAlerts();
    } catch (err) {
      console.error('[NodeHeader] failed to respawn instance:', err);
      pushErrorAlert(`Failed to respawn agent: ${describeError(err)}`);
    } finally {
      respawning = false;
    }
  }

  $: closeTitle = ptyId
    ? 'Stop agent process'
    : canRemoveInstance
      ? 'Retire disconnected agent from swarm'
      : 'Close unavailable for this node';

  // Red traffic-light X is the single live-process stop action. It closes the
  // PTY but leaves any adopted swarm identity recoverable; disconnected rows
  // are removed only after the process is already gone.
  async function handleTrafficClose() {
    const targetPty = ptyId;

    if (targetPty) {
      await handleStop();
      return;
    }

    if (canRemoveInstance) {
      await handleRemoveInstance();
    }
  }
</script>

<div class="node-header">
  <div class="traffic-lights" role="group" aria-label="Window controls">
    <button
      type="button"
      class="light red"
      title={closeTitle}
      aria-label={closeTitle}
      disabled={!canClose}
      on:click|stopPropagation={handleTrafficClose}
    ></button>
    <button
      type="button"
      class="light yellow"
      class:active={compact}
      title={compact ? 'Expand card' : 'Compact card (Cmd/Ctrl+Shift+M)'}
      aria-label={compact ? 'Expand card' : 'Compact card'}
      on:click|stopPropagation={() => dispatch('compact')}
    ></button>
    <button
      type="button"
      class="light green"
      title={canFullscreen ? 'Open immersive workspace (Cmd/Ctrl+Shift+F)' : 'Fullscreen unavailable for this node'}
      aria-label="Open immersive workspace"
      disabled={!canFullscreen}
      on:click|stopPropagation={() => dispatch('fullscreen')}
    ></button>
  </div>

  {#if role}
    <span class="role-badge {roleClass}">{role}</span>
  {/if}

  <span class="node-label" title={instanceId ?? 'Pending'}>
    {displayLabel}
  </span>

  {#if cwd}
    <span class="node-cwd" title={cwd}>{cwd}</span>
  {/if}

  {#if mobileControlled}
    <span class="mobile-lease-badge" title={mobileTooltip}>
      <svg
        class="mobile-lease-icon"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" ry="2"></rect>
        <line x1="12" y1="18" x2="12.01" y2="18"></line>
      </svg>
      Mobile
    </span>
  {/if}

  {#if showAdopting}
    <span
      class="adopting-badge"
      title="Instance row pre-created by swarm-ui. Waiting for the child process to call swarm.register and adopt it."
    >
      ADOPTING
    </span>
  {/if}

  {#if activeTaskCount > 0}
    <span class="task-count-badge">{activeTaskCount}</span>
  {/if}

  {#if lockCount > 0}
    <span class="lock-badge" title={`Locked: ${lockTooltip}`}>
      <svg
        class="lock-icon"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="11" width="16" height="10" rx="2"/>
        <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
      </svg>
      {lockCount}
    </span>
  {/if}

  <!-- Connection status on the right, matching the ghostty-web demo's
       "● Connected" indicator. Status dot + text label together. -->
  <div class="connection-status" title={instanceId ?? 'Pending'}>
    <span class="connection-dot {status}"></span>
    <span class="connection-text">{statusLabel}</span>
  </div>

  <div class="node-controls">
    <button
      title="Fullscreen in canvas (Cmd/Ctrl+Alt+F)"
      aria-label="Fullscreen in canvas"
      on:click|stopPropagation={() => dispatch('fillCanvas')}
    >
      <!-- Maximize icon -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
        <path d="M16 3h3a2 2 0 0 1 2 2v3"/>
        <path d="M8 21H5a2 2 0 0 1-2-2v-3"/>
        <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
      </svg>
    </button>

    <button
      title="Focus terminal"
      on:click|stopPropagation={() => dispatch('focus')}
    >
      <!-- Focus icon (crosshair) -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="4"/>
        <line x1="12" y1="2" x2="12" y2="6"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="2" y1="12" x2="6" y2="12"/>
        <line x1="18" y1="12" x2="22" y2="12"/>
      </svg>
    </button>

    <button
      title="Inspect details"
      on:click|stopPropagation={() => dispatch('inspect')}
    >
      <!-- Info icon -->
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="16" x2="12" y2="12"/>
        <line x1="12" y1="8" x2="12.01" y2="8"/>
      </svg>
    </button>

    {#if !isAppOwned || !ptyId}
      {#if canRespawnInstance}
        <button
          class="respawn"
          title="Relaunch this agent so it comes back online"
          disabled={respawning}
          on:click|stopPropagation={handleRespawnInstance}
        >
          <!-- Refresh / respawn icon -->
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      {/if}
      {#if canRemoveInstance}
          <button
            class="stop"
            title="Retire disconnected agent from swarm"
            on:click|stopPropagation={handleRemoveInstance}
          >
          <!-- Trash icon -->
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/>
            <path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      {/if}
    {/if}
  </div>
</div>

{#each errorAlerts as alert (alert.id)}
  <div class="node-alert error" role="alert">
    <span class="node-alert-message">{alert.message}</span>
    <button
      type="button"
      class="node-alert-dismiss"
      aria-label="Dismiss alert"
      on:click|stopPropagation={() => dismissErrorAlert(alert.id)}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>
{/each}
