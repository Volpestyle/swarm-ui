<!--
  ViewportFocus.svelte — Translate focus requests into xyflow viewport moves.

  Lives inside <SvelteFlow> so `useSvelteFlow()` resolves to the canvas
  instance. Subscribes to `focusRequest`; when a request lands, it polls for
  the target node (newly-spawned nodes enter the graph asynchronously on the
  next reactive rebuild), then centers the node in one viewport animation.
  Spawn focus preserves the current zoom unless that would clip the node. The
  canvas-fill action zooms the node to the visible canvas and can restore the
  previous viewport on the next request. Polling gives up after a short window
  so a spawn that never renders (scope mismatch, harness validation error,
  etc.) doesn't wedge the canvas.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { useStore, useSvelteFlow, type Rect, type Viewport } from '@xyflow/svelte';
  import { focusRequest, type FocusRequestMode } from '../lib/app/focus';

  const CENTER_CONTAIN_PADDING_PX = 72;
  const CENTER_DURATION_MS = 180;
  const FILL_PADDING_PX = 28;
  const FILL_DURATION_MS = 160;
  const RESTORE_DURATION_MS = 160;
  const POLL_INTERVAL_MS = 60;
  const POLL_TIMEOUT_MS = 2500;

  const store = useStore();
  const { getNode, getNodesBounds, getViewport, setViewport } = useSvelteFlow();

  /** Pixels covered by the right sidebar. The canvas renders behind it. */
  export let rightInset = 0;

  let currentToken: number | null = null;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let pollDeadline = 0;
  let restoreViewport: Viewport | null = null;
  let filledNodeId: string | null = null;

  function stopPolling(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function visibleCanvasMetrics(padding: number): {
    availableWidth: number;
    availableHeight: number;
    centerX: number;
    centerY: number;
  } {
    const clampedRightInset = Math.min(
      Math.max(0, rightInset),
      Math.max(0, store.width - 1),
    );
    const visibleWidth = Math.max(1, store.width - clampedRightInset);

    return {
      availableWidth: Math.max(1, visibleWidth - padding * 2),
      availableHeight: Math.max(1, store.height - padding * 2),
      centerX: visibleWidth / 2,
      centerY: store.height / 2,
    };
  }

  function targetViewportForBounds(bounds: Rect, zoom: number, padding: number): Viewport {
    const visible = visibleCanvasMetrics(padding);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    return {
      x: visible.centerX - centerX * zoom,
      y: visible.centerY - centerY * zoom,
      zoom,
    };
  }

  function containZoomForBounds(bounds: Rect, padding: number): number {
    const visible = visibleCanvasMetrics(padding);
    return Math.min(
      visible.availableWidth / bounds.width,
      visible.availableHeight / bounds.height,
    );
  }

  function clearFillState(): void {
    restoreViewport = null;
    filledNodeId = null;
  }

  async function restoreFilledViewport(): Promise<boolean> {
    if (!restoreViewport) return false;
    const viewport = restoreViewport;
    clearFillState();
    await setViewport(viewport, { duration: RESTORE_DURATION_MS });
    return true;
  }

  async function tryFocus(nodeId: string, mode: FocusRequestMode): Promise<boolean> {
    if (mode === 'fill-toggle' && filledNodeId === nodeId && restoreViewport) {
      return restoreFilledViewport();
    }

    const node = getNode(nodeId);
    if (!node) return false;

    const bounds = getNodesBounds([nodeId]);
    if (bounds.width <= 0 || bounds.height <= 0 || store.width <= 0 || store.height <= 0) {
      return false;
    }

    const currentZoom = getViewport().zoom;
    const containZoom = containZoomForBounds(bounds, CENTER_CONTAIN_PADDING_PX);
    const targetZoom = mode === 'fill-toggle'
      ? Math.max(
          store.minZoom,
          Math.min(store.maxZoom, containZoomForBounds(bounds, FILL_PADDING_PX)),
        )
      : Math.max(store.minZoom, Math.min(currentZoom, containZoom));

    if (mode === 'fill-toggle') {
      if (!restoreViewport) {
        restoreViewport = getViewport();
      }
      filledNodeId = nodeId;
    } else {
      clearFillState();
    }

    await setViewport(
      targetViewportForBounds(
        bounds,
        targetZoom,
        mode === 'fill-toggle' ? FILL_PADDING_PX : CENTER_CONTAIN_PADDING_PX,
      ),
      { duration: mode === 'fill-toggle' ? FILL_DURATION_MS : CENTER_DURATION_MS },
    );
    return true;
  }

  const unsubscribe = focusRequest.subscribe((req) => {
    if (!req || req.token === currentToken) return;
    currentToken = req.token;

    stopPolling();
    const nodeId = req.nodeId;
    const mode = req.mode;

    void tryFocus(nodeId, mode).then((done) => {
      if (done) return;

      pollDeadline = Date.now() + POLL_TIMEOUT_MS;
      pollHandle = setInterval(() => {
        if (Date.now() > pollDeadline) {
          stopPolling();
          return;
        }
        void tryFocus(nodeId, mode).then((resolved) => {
          if (resolved) stopPolling();
        });
      }, POLL_INTERVAL_MS);
    });
  });

  onDestroy(() => {
    stopPolling();
    unsubscribe();
  });
</script>
