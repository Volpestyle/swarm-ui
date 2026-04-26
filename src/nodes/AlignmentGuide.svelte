<script lang="ts">
  import { useStore } from '@xyflow/svelte';
  import type { AlignmentGuide } from '../lib/app/alignment';

  export let guide: AlignmentGuide | null = null;
  export let rightInset = 0;

  const store = useStore();

  $: linePosition = guide
    ? guide.axis === 'x'
      ? guide.value * store.viewport.zoom + store.viewport.x
      : guide.value * store.viewport.zoom + store.viewport.y
    : 0;
  $: lineStyle = guide?.axis === 'x'
    ? `left: ${linePosition}px;`
    : `top: ${linePosition}px;`;
  $: showGuide =
    guide !== null &&
    Number.isFinite(linePosition) &&
    store.width > 0 &&
    store.height > 0;
</script>

{#if showGuide && guide}
  <div
    class="alignment-guide-layer"
    style="--right-inset: {rightInset}px;"
    aria-hidden="true"
  >
    <div
      class="alignment-line"
      class:vertical={guide.axis === 'x'}
      class:horizontal={guide.axis === 'y'}
      style={lineStyle}
    ></div>
  </div>
{/if}

<style>
  .alignment-guide-layer {
    position: absolute;
    inset: 0 var(--right-inset, 0px) 0 0;
    z-index: 7;
    pointer-events: none;
    overflow: hidden;
  }

  .alignment-line {
    position: absolute;
    background: rgba(137, 180, 250, 0.95);
    box-shadow:
      0 0 0 1px rgba(17, 17, 27, 0.6),
      0 0 14px rgba(137, 180, 250, 0.45);
  }

  .alignment-line.vertical {
    top: 0;
    bottom: 0;
    width: 1px;
    transform: translateX(-0.5px);
  }

  .alignment-line.horizontal {
    left: 0;
    right: 0;
    height: 1px;
    transform: translateY(-0.5px);
  }
</style>
