<script lang="ts">
  import { SPEED, sameSpeed } from '../lib/speed';

  interface Props {
    speed: number;
    mixedSpeeds: boolean;
    compact: boolean;
    disabled: boolean;
    onSpeedChange: (speed: number) => void;
  }

  const PRESETS = [0.75, 1, 1.25, 1.5, 2];
  let { speed, mixedSpeeds, compact, disabled, onSpeedChange }: Props = $props();
  let root: HTMLDivElement;
  let draft = $state('');
  let editing = $state(false);
  $effect(() => { if (!editing) draft = speed.toFixed(2); });

  function handleInput(event: Event) {
    draft = (event.target as HTMLInputElement).value;
  }

  function commit() {
    if (!editing) return;
    editing = false;
    const value = draft.trim() ? Number(draft) : NaN;
    draft = speed.toFixed(2);
    if (Number.isFinite(value) && !sameSpeed(value, speed)) onSpeedChange(value);
  }
</script>

<div class="speed-control-root" bind:this={root}>
{#if !compact}
  <div class="field segmented" role="group" aria-label="Speed presets">
    {#each PRESETS as preset}
      <button
        class="preset"
        aria-label={`Set speed to ${preset}×`}
        aria-pressed={!mixedSpeeds && sameSpeed(speed, preset)}
        {disabled}
        onclick={() => onSpeedChange(preset)}
      >{preset}<span aria-hidden="true">×</span></button>
    {/each}
  </div>
{/if}

<div class="speed-control">
  <div class="field segmented">
  <button
    class="step"
    onclick={() => onSpeedChange(speed - SPEED.STEP)}
    title="Decrease speed"
    aria-label="Decrease speed"
    disabled={disabled || speed <= SPEED.MIN}
  >
    <svg viewBox="0 0 24 24" class="icon"
      ><line x1="5" y1="12" x2="19" y2="12"></line></svg
    >
  </button>

  <input
    type="number"
    class="speed-input"
    value={draft}
    min={SPEED.MIN}
    max={SPEED.MAX}
    step="0.01"
    {disabled}
    oninput={(event) => { editing = true; handleInput(event); }}
    onfocus={() => { editing = true; }}
    onblur={(event) => {
      // Clicking one of these buttons replaces the draft, so it must not also commit it.
      if (event.relatedTarget instanceof HTMLButtonElement && root.contains(event.relatedTarget)) {
        editing = false;
        draft = speed.toFixed(2);
      } else commit();
    }}
    onkeydown={(event) => {
      if (event.key === 'Enter') { event.preventDefault(); commit(); }
      if (event.key === 'Escape') { editing = false; draft = speed.toFixed(2); (event.target as HTMLInputElement).blur(); }
    }}
    aria-label="Playback speed"
  />

  <button
    class="step"
    onclick={() => onSpeedChange(speed + SPEED.STEP)}
    title="Increase speed"
    aria-label="Increase speed"
    disabled={disabled || speed >= SPEED.MAX}
  >
    <svg viewBox="0 0 24 24" class="icon">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  </button>
  </div>

  <button
    class="btn ghost"
    {disabled}
    onclick={() => onSpeedChange(SPEED.DEFAULT)}
    title="Reset to 1×"
    aria-label="Reset speed to 1×">Reset</button
  >
</div>
</div>

<style>
  .speed-control-root { display: contents; }

  .preset {
    flex: 1;
    min-height: 2.25rem;
    padding: 0;
    border: 0;
    border-inline-start: 1px solid var(--color-divider);
    background: transparent;
    font: 500 0.8125rem var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .preset:first-child { border-inline-start: 0; }
  .preset span { color: var(--color-text-muted); }
  .preset:hover:not(:disabled) { background: var(--color-hover); }
  .preset[aria-pressed="true"] { background: var(--color-accent-fill); color: #fff; }
  .preset[aria-pressed="true"] span { color: inherit; }

  .speed-control { display: flex; align-items: center; gap: 0.75rem; }

  .step {
    display: grid;
    place-items: center;
    width: 2.5rem;
    min-height: 2.25rem;
    border: 0;
    background: transparent;
  }
  .step:hover:not(:disabled) { background: var(--color-hover); }

  .speed-input {
    width: 5rem;
    padding: 0 0.5rem;
    border: 0;
    border-inline: 1px solid var(--color-divider);
    background: transparent;
    font: 600 0.9375rem var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
</style>
