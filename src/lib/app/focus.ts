// =============================================================================
// focus.ts — Cross-component signal to ask the canvas to focus on one node
//
// Launcher.svelte writes here after a successful spawn; App/TerminalNode also
// write here for canvas fill/restore. A small helper component inside
// <SvelteFlow> (ViewportFocus.svelte) subscribes and applies the viewport move
// once the requested node appears in the graph.
// =============================================================================

import { writable } from 'svelte/store';

export type FocusRequestMode = 'center' | 'fill-toggle' | 'fit-all';

export interface FocusRequest {
  nodeId?: string;
  mode: FocusRequestMode;
  /** Monotonically incrementing token so duplicate requests for the same node still re-fire. */
  token: number;
}

let nextToken = 1;

export const focusRequest = writable<FocusRequest | null>(null);

export function requestNodeFocus(nodeId: string): void {
  focusRequest.set({ nodeId, mode: 'center', token: nextToken++ });
}

export function requestNodeCanvasFillToggle(nodeId: string): void {
  focusRequest.set({ nodeId, mode: 'fill-toggle', token: nextToken++ });
}

export function requestCanvasFitAll(): void {
  focusRequest.set({ mode: 'fit-all', token: nextToken++ });
}
