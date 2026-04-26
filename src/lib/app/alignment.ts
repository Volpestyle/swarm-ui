import type { XYFlowNode } from '../types';

export type AlignmentAxis = 'x' | 'y';
export type AlignmentLine = 'vertical' | 'horizontal';
export type AlignmentSide = 'left' | 'top' | 'right' | 'bottom';

export interface AlignmentGuide {
  axis: AlignmentAxis;
  value: number;
  sourceNodeId: string;
  targetNodeId: string;
  line?: AlignmentLine;
  side?: AlignmentSide;
}

interface NodeRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AlignmentMatch extends AlignmentGuide {
  offset: number;
  distance: number;
}

export const ALIGNMENT_LINES: AlignmentLine[] = ['vertical', 'horizontal'];
export const ALIGNMENT_SIDES: AlignmentSide[] = ['left', 'top', 'right', 'bottom'];

export const ALIGNMENT_SNAP_THRESHOLD = 18;
export const ALIGNMENT_SIDE_GAP = 32;
export const ALIGNMENT_GAP_STEP = 24;

export function nextAlignmentLine(
  current: AlignmentLine,
  delta: number,
): AlignmentLine {
  const currentIndex = ALIGNMENT_LINES.indexOf(current);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + delta + ALIGNMENT_LINES.length) % ALIGNMENT_LINES.length;
  return ALIGNMENT_LINES[nextIndex];
}

export function nextAlignmentSide(
  current: AlignmentSide,
  delta: number,
): AlignmentSide {
  const currentIndex = ALIGNMENT_SIDES.indexOf(current);
  const baseIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (baseIndex + delta + ALIGNMENT_SIDES.length) % ALIGNMENT_SIDES.length;
  return ALIGNMENT_SIDES[nextIndex];
}

export function alignNodeCenterToTarget(
  nodes: XYFlowNode[],
  sourceNodeId: string,
  targetNodeId: string,
  line: AlignmentLine,
): { nodes: XYFlowNode[]; guide: AlignmentGuide } | null {
  const sourceRect = nodeRect(nodes.find((node) => node.id === sourceNodeId));
  const targetRect = nodeRect(nodes.find((node) => node.id === targetNodeId));
  if (!sourceRect || !targetRect) return null;

  const axis = lineAxis(line);
  const value = centerValue(targetRect, axis);
  const sourceValue = centerValue(sourceRect, axis);
  const offset = value - sourceValue;

  return {
    nodes: translateNodes(nodes, new Set([sourceNodeId]), axis, offset),
    guide: {
      axis,
      value,
      sourceNodeId,
      targetNodeId,
      line,
    },
  };
}

export function alignNodeSideToTarget(
  nodes: XYFlowNode[],
  sourceNodeId: string,
  targetNodeId: string,
  side: AlignmentSide,
): { nodes: XYFlowNode[]; guide: AlignmentGuide } | null {
  const sourceRect = nodeRect(nodes.find((node) => node.id === sourceNodeId));
  const targetRect = nodeRect(nodes.find((node) => node.id === targetNodeId));
  if (!sourceRect || !targetRect) return null;

  const placementAxis = sideAxis(side);
  const guideAxis = placementAxis === 'x' ? 'y' : 'x';
  const gap = currentGapBetweenRects(sourceRect, targetRect);
  const nextPosition = adjacentPositionForSide(sourceRect, targetRect, side, gap);
  const value = centerValue(targetRect, guideAxis);

  return {
    nodes: setNodePosition(nodes, sourceNodeId, nextPosition),
    guide: {
      axis: guideAxis,
      value,
      sourceNodeId,
      targetNodeId,
      side,
    },
  };
}

export function adjustNodeGapFromTarget(
  nodes: XYFlowNode[],
  sourceNodeId: string,
  targetNodeId: string,
  delta: number,
  preferredSide?: AlignmentSide,
): { nodes: XYFlowNode[]; guide: AlignmentGuide } | null {
  const sourceRect = nodeRect(nodes.find((node) => node.id === sourceNodeId));
  const targetRect = nodeRect(nodes.find((node) => node.id === targetNodeId));
  if (!sourceRect || !targetRect) return null;

  const side = resolveCurrentSide(sourceRect, targetRect, preferredSide);
  const currentGap = gapForSide(sourceRect, targetRect, side);
  const baseGap = currentGap >= 0
    ? currentGap
    : currentGapBetweenRects(sourceRect, targetRect);
  const nextGap = Math.max(0, baseGap + delta);
  const placementAxis = sideAxis(side);
  const guideAxis = placementAxis === 'x' ? 'y' : 'x';
  const value = centerValue(targetRect, guideAxis);

  return {
    nodes: setNodePosition(
      nodes,
      sourceNodeId,
      adjacentPositionForSide(sourceRect, targetRect, side, nextGap),
    ),
    guide: {
      axis: guideAxis,
      value,
      sourceNodeId,
      targetNodeId,
      side,
    },
  };
}

function adjacentPositionForSide(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  side: AlignmentSide,
  gap: number,
): { x: number; y: number } {
  const centeredX = targetRect.x + targetRect.width / 2 - sourceRect.width / 2;
  const centeredY = targetRect.y + targetRect.height / 2 - sourceRect.height / 2;

  switch (side) {
    case 'left':
      return {
        x: targetRect.x - sourceRect.width - gap,
        y: centeredY,
      };
    case 'top':
      return {
        x: centeredX,
        y: targetRect.y - sourceRect.height - gap,
      };
    case 'right':
      return {
        x: targetRect.x + targetRect.width + gap,
        y: centeredY,
      };
    case 'bottom':
      return {
        x: centeredX,
        y: targetRect.y + targetRect.height + gap,
      };
  }
}

function resolveCurrentSide(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  preferredSide: AlignmentSide | undefined,
): AlignmentSide {
  if (preferredSide && gapForSide(sourceRect, targetRect, preferredSide) >= 0) {
    return preferredSide;
  }

  const candidates = ALIGNMENT_SIDES
    .map((side) => ({ side, gap: gapForSide(sourceRect, targetRect, side) }))
    .filter((item) => item.gap >= 0)
    .sort((a, b) => b.gap - a.gap);

  if (candidates[0]) return candidates[0].side;

  const dx = centerValue(sourceRect, 'x') - centerValue(targetRect, 'x');
  const dy = centerValue(sourceRect, 'y') - centerValue(targetRect, 'y');
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

function gapForSide(
  sourceRect: NodeRect,
  targetRect: NodeRect,
  side: AlignmentSide,
): number {
  switch (side) {
    case 'left':
      return targetRect.x - (sourceRect.x + sourceRect.width);
    case 'top':
      return targetRect.y - (sourceRect.y + sourceRect.height);
    case 'right':
      return sourceRect.x - (targetRect.x + targetRect.width);
    case 'bottom':
      return sourceRect.y - (targetRect.y + targetRect.height);
  }
}

function currentGapBetweenRects(sourceRect: NodeRect, targetRect: NodeRect): number {
  const horizontalGap = separatedGap(
    sourceRect.x,
    sourceRect.x + sourceRect.width,
    targetRect.x,
    targetRect.x + targetRect.width,
  );
  const verticalGap = separatedGap(
    sourceRect.y,
    sourceRect.y + sourceRect.height,
    targetRect.y,
    targetRect.y + targetRect.height,
  );
  const dx = centerValue(sourceRect, 'x') - centerValue(targetRect, 'x');
  const dy = centerValue(sourceRect, 'y') - centerValue(targetRect, 'y');
  const preferHorizontal = Math.abs(dx) >= Math.abs(dy);
  const preferredGap = preferHorizontal ? horizontalGap : verticalGap;
  const fallbackGap = preferHorizontal ? verticalGap : horizontalGap;
  const gap = preferredGap ?? fallbackGap ?? ALIGNMENT_SIDE_GAP;

  return Number.isFinite(gap) ? Math.max(0, gap) : ALIGNMENT_SIDE_GAP;
}

function separatedGap(
  sourceStart: number,
  sourceEnd: number,
  targetStart: number,
  targetEnd: number,
): number | null {
  if (sourceEnd <= targetStart) return targetStart - sourceEnd;
  if (targetEnd <= sourceStart) return sourceStart - targetEnd;
  return null;
}

export function snapDraggedNodesToAlignment(
  nodes: XYFlowNode[],
  sourceNodeId: string,
  draggedNodeIds: Set<string>,
  threshold = ALIGNMENT_SNAP_THRESHOLD,
): { nodes: XYFlowNode[]; guide: AlignmentGuide } | null {
  const match = findClosestAlignment(nodes, sourceNodeId, draggedNodeIds, threshold);
  if (!match) return null;

  return {
    nodes: translateNodes(nodes, draggedNodeIds, match.axis, match.offset),
    guide: {
      axis: match.axis,
      value: match.value,
      sourceNodeId: match.sourceNodeId,
      targetNodeId: match.targetNodeId,
      line: match.line,
    },
  };
}

function findClosestAlignment(
  nodes: XYFlowNode[],
  sourceNodeId: string,
  draggedNodeIds: Set<string>,
  threshold: number,
): AlignmentMatch | null {
  const sourceRect = nodeRect(nodes.find((node) => node.id === sourceNodeId));
  if (!sourceRect) return null;

  let best: AlignmentMatch | null = null;

  for (const line of ALIGNMENT_LINES) {
    const axis = lineAxis(line);
    const sourceValue = centerValue(sourceRect, axis);

    for (const node of nodes) {
      if (draggedNodeIds.has(node.id) || node.hidden) continue;

      const targetRect = nodeRect(node);
      if (!targetRect) continue;

      const value = centerValue(targetRect, axis);
      const offset = value - sourceValue;
      const distance = Math.abs(offset);
      if (distance > threshold) continue;
      if (best && distance >= best.distance) continue;

      best = {
        axis,
        value,
        offset,
        distance,
        sourceNodeId,
        targetNodeId: node.id,
        line,
      };
    }
  }

  return best;
}

function translateNodes(
  nodes: XYFlowNode[],
  nodeIds: Set<string>,
  axis: AlignmentAxis,
  offset: number,
): XYFlowNode[] {
  if (offset === 0) return nodes;

  return nodes.map((node) => {
    if (!nodeIds.has(node.id)) return node;

    return {
      ...node,
      position: axis === 'x'
        ? { ...node.position, x: node.position.x + offset }
        : { ...node.position, y: node.position.y + offset },
    };
  });
}

function setNodePosition(
  nodes: XYFlowNode[],
  nodeId: string,
  position: { x: number; y: number },
): XYFlowNode[] {
  return nodes.map((node) => (
    node.id === nodeId
      ? { ...node, position }
      : node
  ));
}

function nodeRect(node: XYFlowNode | null | undefined): NodeRect | null {
  if (!node) return null;

  const width = node.width ?? node.measured?.width ?? node.initialWidth ?? 0;
  const height = node.height ?? node.measured?.height ?? node.initialHeight ?? 0;
  if (width <= 0 || height <= 0) return null;

  return {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    width,
    height,
  };
}

function lineAxis(line: AlignmentLine): AlignmentAxis {
  return line === 'vertical' ? 'x' : 'y';
}

function sideAxis(side: AlignmentSide): AlignmentAxis {
  return side === 'left' || side === 'right' ? 'x' : 'y';
}

function centerValue(rect: NodeRect, axis: AlignmentAxis): number {
  return axis === 'x'
    ? rect.x + rect.width / 2
    : rect.y + rect.height / 2;
}
