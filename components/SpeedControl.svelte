<script lang="ts">
  import { SPEED, sameSpeed } from "../lib/speed";

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
  <div class="speed-presets" role="group" aria-label="Speed presets">
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
  <button
    class="btn"
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
    class="btn"
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

  <button
    class="btn reset"
    {disabled}
    onclick={() => onSpeedChange(SPEED.DEFAULT)}
    title="Reset to 1.0x"
    aria-label="Reset speed to 1.0x">Reset</button
  >
</div>
{#if !compact}<p class="input-hint">Custom speed: type a value and press Enter</p>{/if}
</div>

<style>
  .speed-control-root { display: contents; }
  .speed-presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 100%; margin-top: 6px; }
  .preset { min-height: 36px; padding: 6px 0; border: 1px solid #ffffff24; border-radius: 6px; background: #ffffff06; color: #c8d0dc; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .preset span { margin-left: 1px; font-size: 11px; }
  .preset:hover:not(:disabled) { background: #60a5fa1a; border-color: #60a5fa80; }
  .preset[aria-pressed="true"] { background: var(--color-focus); border-color: var(--color-focus); color: #152236; }
  .input-hint { color: #a2abba; font-size: 11px; margin: -4px 0 2px; }

  .speed-control {
    display: flex;
    align-items: center;
    gap: 8px;
    --btn-size: 40px;
  }

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--btn-size);
    height: var(--btn-size);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.1);
    color: var(--color-text);
    font-size: 18px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .btn:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.5);
  }

  .btn:active {
    background: rgba(59, 130, 246, 0.3);
    border-color: rgba(59, 130, 246, 0.6);
  }

  .btn.reset {
    width: auto;
    padding: 0 16px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .speed-input {
    width: 90px;
    height: var(--btn-size);
    padding: 0 12px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(40, 40, 40, 0.6);
    color: var(--color-text);
    font-size: 16px;
    font-family: ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    text-align: center;
    transition: all 0.15s ease;
  }

  .speed-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(40, 40, 40, 0.8);
  }

  .btn:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.8);
    outline-offset: 2px;
  }

  .icon {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
    pointer-events: none;
    position: relative;
    z-index: 1;
  }
</style>
