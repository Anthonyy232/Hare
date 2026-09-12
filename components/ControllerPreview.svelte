<script lang="ts">
  import controllerCSS from '../assets/controller.css?raw';
  import { ICONS } from '../lib/controller-icons';

  let { opacity, size, startHidden }: { opacity: number; size: number; startHidden: boolean } = $props();
  let expanded = $state(false);

  // Render the real overlay styles in isolation, without media or playback listeners.
  function preview(node: HTMLDivElement, values: { opacity: number; size: number; expanded: boolean }) {
    const shadow = node.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = controllerCSS + `
      :host { position: static; z-index: auto; pointer-events: none !important; }
      .hare-controller, .hare-controller:hover { opacity: var(--preview-opacity); }
      .hare-controls { display: var(--preview-controls) !important; }
    `;
    const controller = document.createElement('div');
    controller.className = 'hare-controller';
    const speed = document.createElement('span');
    speed.className = 'hare-speed';
    speed.textContent = '1.00x';
    const controls = document.createElement('span');
    controls.className = 'hare-controls';
    // Parse only bundled SVG icons. Settings never enter HTML or SVG markup.
    const parser = new DOMParser();
    for (const icon of Object.values(ICONS)) {
      const button = document.createElement('span');
      button.className = 'hare-btn';
      const svg = parser.parseFromString(icon, 'text/html').querySelector('svg');
      if (svg) button.append(document.importNode(svg, true));
      controls.append(button);
    }
    controller.append(speed, controls);
    shadow.append(style, controller);
    function update(value: typeof values) {
      controller.style.setProperty('--hare-font-size', `${value.size}px`);
      controller.style.setProperty('--preview-opacity', String(value.expanded ? 1 : value.opacity));
      controller.style.setProperty('--preview-controls', value.expanded ? 'flex' : 'none');
    }
    update(values);
    return { update };
  }
</script>

<div class="preview">
  <div class="preview-heading">
    <span>Preview</span>
    <div class="preview-modes" role="group" aria-label="Controller preview state">
      <button aria-pressed={!expanded} onclick={() => { expanded = false; }}>At rest</button>
      <button aria-pressed={expanded} onclick={() => { expanded = true; }}>Expanded</button>
    </div>
  </div>
  <div class="preview-frame" role="img" aria-label={`Controller preview: ${expanded ? 'expanded at full opacity' : `at rest at ${Math.round(opacity * 100)}% opacity`}, ${size} pixel button size`}>
    <div class="preview-overlay" aria-hidden="true" inert use:preview={{ opacity, size, expanded }}></div>
  </div>
  <p>{startHidden ? 'Starts hidden. Use Show / hide controller in the popup to reveal it.' : 'Hover or focus the controller to reveal its buttons at full opacity.'}</p>
</div>

<style>
  .preview { margin-top: 16px; min-width: 0; }
  .preview-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; font-size: 12px; color: #bbc5d3; }
  .preview-modes { display: flex; gap: 2px; padding: 3px; background: #ffffff08; border: 1px solid #ffffff12; border-radius: 6px; }
  button { padding: 4px 8px; border: 0; border-radius: 4px; background: transparent; color: #aaa; font-size: 11px; cursor: pointer; }
  button[aria-pressed="true"] { background: #93c5fd26; color: #c9e0fc; }
  .preview-frame { min-height: 100px; display: flex; align-items: center; padding: 16px; overflow-x: auto; border-radius: 8px; border: 1px solid #ffffff12; background: radial-gradient(ellipse at 85% 90%, #34505f, transparent 75%), linear-gradient(135deg, #222e3c, #1a2732); }
  .preview-overlay { flex-shrink: 0; }
  p { margin: 8px 0 0; font-size: 11px; line-height: 1.5; color: #aaa; }
</style>
