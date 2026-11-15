<script lang="ts">
  import controllerCSS from '../assets/controller.css?raw';
  import { applyAppearance, createControllerView } from '../lib/media/controller-view';

  let { opacity, size, startHidden }: { opacity: number; size: number; startHidden: boolean } = $props();
  let expanded = $state(false);

  function preview(node: HTMLDivElement, values: { opacity: number; size: number; expanded: boolean }) {
    const shadow = node.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = controllerCSS + `
      :host { position: static; z-index: auto; pointer-events: none !important; max-width: 100%; --hare-max-width: 100%; }
      .hare-controller:hover, .hare-controller:focus-within { opacity: var(--hare-opacity); }
      .hare-controls { display: var(--preview-controls) !important; }
    `;
    const { controllerEl: controller } = createControllerView();
    shadow.append(style, controller);
    function update(value: typeof values) {
      applyAppearance(controller, value.expanded ? 1 : value.opacity, value.size);
      controller.style.setProperty('--preview-controls', value.expanded ? 'flex' : 'none');
    }
    update(values);
    return { update };
  }
</script>

<div class="preview">
  <div class="preview-heading">
    <span>Preview</span>
    <div class="preview-modes field" role="group" aria-label="Controller preview state">
      <button aria-pressed={!expanded} onclick={() => { expanded = false; }}>At rest</button>
      <button aria-pressed={expanded} onclick={() => { expanded = true; }}>Expanded</button>
    </div>
  </div>
  <div class="preview-frame" role="img" aria-label={`Controller preview: ${expanded ? 'expanded at full opacity' : `at rest at ${Math.round(opacity * 100)}% opacity`}, ${size} pixel button size`}>
    <div class="preview-overlay" aria-hidden="true" inert use:preview={{ opacity, size, expanded }}></div>
  </div>
  <p>{startHidden ? 'Starts hidden. Use the Show/Hide Controller shortcut to reveal it.' : 'Hover or focus the controller to reveal its buttons at full opacity.'}</p>
</div>

<style>
  .preview { min-width: 0; }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; font-size: 0.8125rem; color: var(--color-text-muted); }
  .preview-modes { display: flex; }
  button { padding: 0.25rem 0.625rem; border: 0; border-radius: var(--inner-radius); background: transparent; color: var(--color-text-secondary); font-size: 0.75rem; }
  button[aria-pressed="true"] { background: var(--color-accent-fill); color: #fff; }
  /* Stands in for a video frame, so it stays dark in both themes. */
  .preview-frame { min-height: 100px; display: flex; align-items: center; padding: 1rem; overflow-x: auto; border-radius: var(--radius); background: radial-gradient(ellipse at 85% 90%, #34505f, transparent 75%), linear-gradient(135deg, #222e3c, #1a2732); }
  .preview-overlay { min-width: 0; max-width: 100%; }
  p { margin: 0.5rem 0 0; font-size: 0.75rem; color: var(--color-text-muted); }
</style>
