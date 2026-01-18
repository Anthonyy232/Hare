<script lang="ts">
  import { SPEED } from "../lib/constants";

  interface Props {
    speed: number;
    onSpeedChange: (speed: number) => void;
    onReset: () => void;
  }

  let { speed, onSpeedChange, onReset }: Props = $props();

  function decrease() {
    onSpeedChange(Math.max(SPEED.MIN, speed - SPEED.STEP));
  }

  function increase() {
    onSpeedChange(Math.min(SPEED.MAX, speed + SPEED.STEP));
  }

  /**
   * Updates state during typing without clamping to allow free-form input.
   */
  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    // Allow any valid number during typing (boundary enforcement happens on blur)
    if (!isNaN(value)) {
      onSpeedChange(value);
    }
  }

  /**
   * Enforces min/max boundaries when the user finishes editing.
   */
  function handleBlur(event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    if (isNaN(value) || value < SPEED.MIN) {
      onSpeedChange(SPEED.MIN);
      target.value = SPEED.MIN.toFixed(2);
    } else if (value > SPEED.MAX) {
      onSpeedChange(SPEED.MAX);
      target.value = SPEED.MAX.toFixed(2);
    }
  }
</script>

<div class="speed-control">
  <button
    class="btn"
    onclick={decrease}
    title="Decrease speed"
    aria-label="Decrease speed"
  >
    <svg viewBox="0 0 24 24" class="icon"
      ><line x1="5" y1="12" x2="19" y2="12"></line></svg
    >
  </button>

  <input
    type="number"
    class="speed-input"
    value={speed.toFixed(2)}
    min={SPEED.MIN}
    max={SPEED.MAX}
    step={SPEED.STEP}
    oninput={handleInput}
    onblur={handleBlur}
    aria-label="Playback speed"
  />

  <button
    class="btn"
    onclick={increase}
    title="Increase speed"
    aria-label="Increase speed"
  >
    <svg viewBox="0 0 24 24" class="icon">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  </button>

  <button
    class="btn reset"
    onclick={onReset}
    title="Reset to 1.0x"
    aria-label="Reset speed to 1.0x">Reset</button
  >
</div>

<style>
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
    color: #f0f0f0;
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
    color: #f0f0f0;
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
