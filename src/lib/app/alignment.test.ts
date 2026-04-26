import { describe, expect, it } from 'bun:test';

import type { XYFlowNode } from '../types';
import {
  ALIGNMENT_GAP_STEP,
  adjustNodeGapFromTarget,
  alignNodeCenterToTarget,
  alignNodeSideToTarget,
  nextAlignmentLine,
  nextAlignmentSide,
  snapDraggedNodesToAlignment,
} from './alignment';

function node(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 80,
): XYFlowNode {
  return {
    id,
    type: 'terminal',
    position: { x, y },
    width,
    height,
    data: {} as XYFlowNode['data'],
  };
}

describe('alignment helpers', () => {
  it('snaps a dragged node center to the nearest target center line', () => {
    const nodes = [
      node('source', 20, 398),
      node('target', 260, 400),
    ];

    const result = snapDraggedNodesToAlignment(
      nodes,
      'source',
      new Set(['source']),
      18,
    );

    expect(result?.guide.line).toBe('horizontal');
    expect(result?.nodes.find((item) => item.id === 'source')?.position.y).toBe(400);
  });

  it('aligns a chosen center line to the target center line for hotkeys', () => {
    const result = alignNodeCenterToTarget(
      [
        node('source', 20, 30),
        node('target', 260, 70, 140, 80),
      ],
      'source',
      'target',
      'vertical',
    );

    expect(result?.guide.value).toBe(330);
    expect(result?.nodes.find((item) => item.id === 'source')?.position.x).toBe(280);
  });

  it('cycles alignment center lines', () => {
    expect(nextAlignmentLine('vertical', +1)).toBe('horizontal');
    expect(nextAlignmentLine('vertical', -1)).toBe('horizontal');
  });

  it('places a node beside the target edge while preserving the current gap', () => {
    const result = alignNodeSideToTarget(
      [
        node('source', 20, 30),
        node('target', 260, 70, 140, 80),
      ],
      'source',
      'target',
      'right',
    );

    expect(result?.guide.side).toBe('right');
    expect(result?.guide.axis).toBe('y');
    expect(result?.guide.value).toBe(110);
    expect(result?.nodes.find((item) => item.id === 'source')?.position.x).toBe(540);
    expect(result?.nodes.find((item) => item.id === 'source')?.position.y).toBe(70);
  });

  it('keeps the measured gap while cycling side placement repeatedly', () => {
    const nodes = [
      node('source', 468, 70),
      node('target', 260, 70, 140, 80),
    ];

    const bottom = alignNodeSideToTarget(nodes, 'source', 'target', 'bottom');
    expect(bottom?.nodes.find((item) => item.id === 'source')?.position.x).toBe(280);
    expect(bottom?.nodes.find((item) => item.id === 'source')?.position.y).toBe(218);

    const left = bottom
      ? alignNodeSideToTarget(bottom.nodes, 'source', 'target', 'left')
      : null;
    expect(left?.nodes.find((item) => item.id === 'source')?.position.x).toBe(92);
    expect(left?.nodes.find((item) => item.id === 'source')?.position.y).toBe(70);
  });

  it('adds spacing from the current alignment target side', () => {
    const result = adjustNodeGapFromTarget(
      [
        node('source', 468, 70),
        node('target', 260, 70, 140, 80),
      ],
      'source',
      'target',
      ALIGNMENT_GAP_STEP,
      'right',
    );

    expect(result?.guide.side).toBe('right');
    expect(result?.nodes.find((item) => item.id === 'source')?.position.x).toBe(492);
    expect(result?.nodes.find((item) => item.id === 'source')?.position.y).toBe(70);
  });

  it('removes spacing from the current alignment target side without going negative', () => {
    const result = adjustNodeGapFromTarget(
      [
        node('source', 410, 70),
        node('target', 260, 70, 140, 80),
      ],
      'source',
      'target',
      -ALIGNMENT_GAP_STEP,
      'right',
    );

    expect(result?.guide.side).toBe('right');
    expect(result?.nodes.find((item) => item.id === 'source')?.position.x).toBe(400);
    expect(result?.nodes.find((item) => item.id === 'source')?.position.y).toBe(70);
  });

  it('cycles alignment edge sides in the requested order', () => {
    expect(nextAlignmentSide('left', +1)).toBe('top');
    expect(nextAlignmentSide('top', +1)).toBe('right');
    expect(nextAlignmentSide('right', +1)).toBe('bottom');
    expect(nextAlignmentSide('bottom', +1)).toBe('left');
    expect(nextAlignmentSide('left', -1)).toBe('bottom');
    expect(nextAlignmentSide('top', -1)).toBe('left');
  });
});
