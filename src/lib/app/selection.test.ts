import { describe, expect, it } from 'bun:test';

import { orderedFocusableNodeIds } from './selection';
import type { PtySession, XYFlowNode } from '../types';

function makeNode(
  id: string,
  position: { x: number; y: number },
  hasPty = false,
): XYFlowNode {
  return {
    id,
    type: 'terminal',
    position,
    data: {
      ptySession: hasPty
        ? ({ id: `pty-${id}` } as PtySession)
        : null,
    },
  } as XYFlowNode;
}

describe('selection helpers', () => {
  it('orders only terminal-backed nodes for focus cycling', () => {
    const nodes = [
      makeNode('instance:metadata', { x: 0, y: 0 }),
      makeNode('bound:second', { x: 200, y: 100 }, true),
      makeNode('pty:first', { x: 100, y: 0 }, true),
    ];

    expect(orderedFocusableNodeIds(nodes)).toEqual([
      'pty:first',
      'bound:second',
    ]);
  });
});
