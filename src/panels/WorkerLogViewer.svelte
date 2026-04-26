<!--
  WorkerLogViewer.svelte — modal stdout/stderr tail for direct_child workers.

  Polls the Tauri worker_log_read command every ~750ms, appending new bytes
  to a fixed-height pre that auto-scrolls. Used when a Clanky-managed code
  worker spawned via direct_child fallback (no swarm-server PTY available)
  so the operator can still see what the harness is doing.
-->
<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { onDestroy, tick } from 'svelte';

  export let path: string;
  export let workerId: string;
  export let taskId: string | null = null;
  export let onClose: () => void;

  type Chunk = {
    data: string;
    from_offset: number;
    new_offset: number;
    size: number;
    eof: boolean;
    truncated: boolean;
  };

  let buffer = '';
  let offset = 0;
  let totalSize = 0;
  let error: string | null = null;
  let polling = false;
  let pollHandle: ReturnType<typeof setTimeout> | null = null;
  let preEl: HTMLPreElement | null = null;
  let userScrolled = false;

  const POLL_INTERVAL_MS = 750;

  async function pollOnce(): Promise<void> {
    if (polling) return;
    polling = true;
    try {
      const chunk = await invoke<Chunk>('worker_log_read', {
        path,
        fromOffset: offset,
      });
      offset = chunk.new_offset;
      totalSize = chunk.size;
      if (chunk.data.length > 0) {
        buffer += chunk.data;
        await tick();
        if (!userScrolled && preEl) {
          preEl.scrollTop = preEl.scrollHeight;
        }
      }
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      polling = false;
    }
  }

  function schedulePoll(): void {
    pollHandle = setTimeout(async () => {
      await pollOnce();
      schedulePoll();
    }, POLL_INTERVAL_MS);
  }

  function handleScroll(): void {
    if (!preEl) return;
    const distanceFromBottom =
      preEl.scrollHeight - preEl.scrollTop - preEl.clientHeight;
    userScrolled = distanceFromBottom > 24;
  }

  function jumpToTail(): void {
    if (!preEl) return;
    preEl.scrollTop = preEl.scrollHeight;
    userScrolled = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onClose();
  }

  // Kick off the first poll immediately so the modal shows content without
  // a 750ms blank flash, then settle into the polling cadence.
  void pollOnce().then(schedulePoll);

  onDestroy(() => {
    if (pollHandle !== null) {
      clearTimeout(pollHandle);
      pollHandle = null;
    }
  });

  $: byteLabel = formatBytes(totalSize);

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div
  class="backdrop"
  role="presentation"
  on:click|self={onClose}
>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Worker log viewer"
  >
    <header class="header">
      <div class="header-text">
        <div class="title mono">worker {workerId}</div>
        <div class="subtitle mono">
          {path}
          <span class="size">· {byteLabel}</span>
          {#if taskId}
            <span class="task">· task {taskId.slice(0, 8)}</span>
          {/if}
        </div>
      </div>
      <button type="button" class="close" on:click={onClose} aria-label="Close">×</button>
    </header>

    {#if error}
      <div class="error" role="alert">{error}</div>
    {/if}

    <pre
      class="log mono"
      bind:this={preEl}
      on:scroll={handleScroll}
    >{buffer}</pre>

    <footer class="footer">
      {#if userScrolled}
        <button type="button" class="jump" on:click={jumpToTail}>jump to tail</button>
      {:else}
        <span class="tailing">tailing…</span>
      {/if}
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    width: min(960px, 90vw);
    height: min(720px, 85vh);
    background: var(--surface, #1e1e2e);
    color: var(--text, #cdd6f4);
    border: 1px solid var(--border, #45475a);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border, #45475a);
  }
  .header-text {
    flex: 1;
    min-width: 0;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .subtitle {
    font-size: 11px;
    color: var(--text-muted, #9399b2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size,
  .task {
    margin-left: 6px;
    color: var(--text-muted, #9399b2);
  }
  .close {
    background: none;
    border: none;
    color: inherit;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover {
    color: var(--text-emphasis, #f5c2e7);
  }
  .error {
    background: var(--badge-error, #f38ba8);
    color: var(--badge-error-text, #1e1e2e);
    padding: 8px 16px;
    font-size: 12px;
  }
  .log {
    flex: 1;
    margin: 0;
    padding: 12px 16px;
    overflow: auto;
    font-size: 12px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-all;
    background: var(--surface-deep, #181825);
  }
  .footer {
    padding: 8px 16px;
    border-top: 1px solid var(--border, #45475a);
    display: flex;
    justify-content: flex-end;
    align-items: center;
    font-size: 11px;
    color: var(--text-muted, #9399b2);
  }
  .jump {
    background: var(--accent, #89b4fa);
    color: var(--accent-text, #1e1e2e);
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .tailing {
    font-style: italic;
  }
  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
