import type { XYFlowEdge, XYFlowNode } from '../types';

const mobileRestoreSizes = new Map<string, { width?: number; height?: number }>();

/**
 * Preserve XYFlow-owned node fields across semantic graph rebuilds.
 * Persisted layout is already applied by `buildGraph` for fresh nodes; once a
 * node exists locally, the in-memory XYFlow position must win so background
 * state updates don't rubber-band an active drag back to stale saved layout.
 */
export function mergeNodes(
  existing: XYFlowNode[],
  next: XYFlowNode[],
): XYFlowNode[] {
  const byId = new Map(existing.map((node) => [node.id, node]));
  return next.map((fresh) => {
    const prev = byId.get(fresh.id);
    if (!prev) return fresh;

    const merged = { ...prev, data: fresh.data };
    const wasMobileControlled = Boolean(prev.data?.mobileControlled);
    const isMobileControlled = Boolean(fresh.data?.mobileControlled);

    if (!wasMobileControlled && isMobileControlled) {
      mobileRestoreSizes.set(fresh.id, {
        width: prev.width,
        height: prev.height,
      });
      merged.width = fresh.width;
      merged.height = fresh.height;
    } else if (wasMobileControlled && !isMobileControlled) {
      const restore = mobileRestoreSizes.get(fresh.id);
      if (restore) {
        merged.width = restore.width;
        merged.height = restore.height;
        mobileRestoreSizes.delete(fresh.id);
      }
    } else if (isMobileControlled) {
      merged.width = fresh.width;
      merged.height = fresh.height;
    }

    return merged;
  });
}

/** Preserve `selected` on edges; everything else is derived from state. */
export function mergeEdges(
  existing: XYFlowEdge[],
  next: XYFlowEdge[],
): XYFlowEdge[] {
  const byId = new Map(existing.map((edge) => [edge.id, edge]));
  return next.map((fresh) => {
    const prev = byId.get(fresh.id);
    if (!prev) return fresh;
    return prev.selected !== undefined
      ? { ...fresh, selected: prev.selected }
      : fresh;
  });
}
