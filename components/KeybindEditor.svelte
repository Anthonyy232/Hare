<script lang="ts">
  import { onDestroy } from "svelte";
  import type { KeyBinding, KeyAction } from "../lib/types";
  import { clampBindingValue } from "../lib/settings";

  interface Props {
    bindings: KeyBinding[];
    onBindingsChange: (bindings: KeyBinding[]) => void;
    onDraftChange?: (dirty: boolean) => void;
  }

  let { bindings, onBindingsChange, onDraftChange }: Props = $props();

  let editingIndex: number | null = $state(null);
  let errorMessage: string | null = $state(null);
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

  const actionLabels: Record<KeyAction, string> = {
    slower: "Decrease Speed",
    faster: "Increase Speed",
    rewind: "Rewind",
    advance: "Advance",
    reset: "Reset Speed",
    display: "Show/Hide Controller",
  };

  const actionValueLabels: Record<KeyAction, string> = {
    slower: "Speed step",
    faster: "Speed step",
    rewind: "Seconds",
    advance: "Seconds",
    reset: "Target speed",
    display: "",
  };

  function formatKey(key: string): string {
    if (key.startsWith("Key")) return key.slice(3);
    return key;
  }

  function startListening(index: number) {
    errorMessage = null;
    if (errorTimeout) clearTimeout(errorTimeout);
    editingIndex = index;
  }

  function patch(index: number, change: Partial<KeyBinding>) {
    onBindingsChange(bindings.map((binding, i) => i === index ? { ...binding, ...change } : binding));
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (editingIndex === null) return;

    if (event.code === 'Tab') {
      editingIndex = null;
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
      || /^(Control|Alt|Meta|Shift)/.test(event.code)) {
      errorMessage = 'Choose a single key without Ctrl, Alt, Shift, or Command.';
      return;
    }
    errorMessage = null;

    if (event.code === "Escape") {
      editingIndex = null;
      return;
    }

    if (event.code === "Backspace" || event.code === "Delete") {
      patch(editingIndex, { key: "" });
      editingIndex = null;
      return;
    }

    // Empty keys mean unbound — they don't conflict with each other.
    const isDuplicate = bindings.some(
      (b, i) => i !== editingIndex && b.key === event.code && b.key !== "",
    );

    if (isDuplicate) {
      errorMessage = 'This key is already assigned to another action.';
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        errorMessage = null;
        errorTimeout = null;
      }, 3000);
      editingIndex = null;
      return;
    }

    patch(editingIndex, { key: event.code });
    editingIndex = null;
  }

  function handleBlur(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    const { action, value } = bindings[index];
    const next = Number.isFinite(target.valueAsNumber) ? clampBindingValue(action, target.valueAsNumber) : value;
    if (next !== value) patch(index, { value: next });
    target.value = String(next);
    onDraftChange?.(false);
  }

  function toggleForce(index: number) {
    patch(index, { force: !bindings[index].force });
  }

  onDestroy(() => { if (errorTimeout) clearTimeout(errorTimeout); });
</script>

<svelte:window onkeydowncapture={handleKeyDown} />

<div class="keybind-editor">
  <p class="intro">Select a shortcut, then press a single key. Escape cancels; Backspace clears it.</p>
  {#if errorMessage}
    <div class="binding-error" role="alert">{errorMessage}</div>
  {/if}
  <ul class="shortcut-list" aria-label="Keyboard shortcuts">
    {#each bindings as binding, index}
      <li class="shortcut-row">
        <h3>{actionLabels[binding.action]}</h3>
        <div class="shortcut-field">
          <span class="field-label" aria-hidden="true">Shortcut</span>
          <div class="key-cell">
            <button
              class="key-btn"
              class:listening={editingIndex === index}
              class:unbound={!binding.key && editingIndex !== index}
              onclick={() => startListening(index)}
              onblur={() => { editingIndex = null; }}
              aria-label={`Change shortcut for ${actionLabels[binding.action]}`}
              aria-pressed={editingIndex === index}
            >
              {#if editingIndex === index}Press a key…
              {:else if binding.key}{formatKey(binding.key)}
              {:else}Unbound{/if}
            </button>
            <button type="button" class="key-clear" title="Clear shortcut"
              aria-label={`Clear shortcut for ${actionLabels[binding.action]}`}
              disabled={!binding.key} onclick={() => { editingIndex = null; patch(index, { key: '' }); }}>×</button>
          </div>
        </div>
        <div class="shortcut-field value-field">
          {#if actionValueLabels[binding.action]}
            <label for={`binding-value-${index}`} class="field-label">{actionValueLabels[binding.action]}</label>
            <div class="value-control">
              <input id={`binding-value-${index}`} type="number" class="value-input"
                value={binding.value} step="0.01"
                min={clampBindingValue(binding.action, 0)}
                max={clampBindingValue(binding.action, Infinity)}
                aria-label={`${actionLabels[binding.action]} ${actionValueLabels[binding.action]}`}
                onkeydown={(event) => {
                  if (event.key !== 'Enter' && event.key !== 'Escape') return;
                  event.preventDefault();
                  if (event.key === 'Escape') event.currentTarget.value = binding.value.toString();
                  event.currentTarget.blur();
                }}
                oninput={() => onDraftChange?.(true)} onblur={(e) => handleBlur(index, e)} />
              <span class="unit" aria-hidden="true">{binding.action === 'rewind' || binding.action === 'advance' ? 'sec' : '×'}</span>
            </div>
          {/if}
        </div>
        <label class="override-label">
          <input type="checkbox" checked={binding.force} onchange={() => toggleForce(index)}
            aria-label={`Override site shortcut for ${actionLabels[binding.action]}`} />
          <span>Override site shortcut</span>
        </label>
      </li>
    {/each}
  </ul>
  <p class="help-text">Enable <strong>Override site shortcut</strong> when a website uses the same key. Hare shortcuts stay inactive while you type in a text field.</p>
</div>

<style>
  .keybind-editor { width: 100%; }
  .intro, .help-text { font-size: 12px; color: var(--color-text-muted); line-height: 1.6; }
  .intro { margin: 0 0 8px; }
  .help-text { margin: 16px 0 0; padding: 12px; border-radius: 6px; background: #ffffff05; }
  .help-text strong { color: #d8e0eb; font-weight: 600; }
  .shortcut-list { list-style: none; padding: 0; margin: 0; }
  .shortcut-row { display: grid; grid-template-columns: minmax(130px, 1fr) 150px 130px 174px; align-items: center; gap: 18px; padding: 16px 0; border-bottom: 1px solid #ffffff12; }
  .shortcut-row:last-child { border-bottom: 0; padding-bottom: 0; }
  h3 { margin: 0; font-size: 13px; font-weight: 600; color: #edf1f7; }
  .shortcut-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
  .field-label { font-size: 11px; color: var(--color-text-muted); }
  .key-cell, .value-control { display: flex; align-items: center; gap: 6px; }
  .key-cell { width: 100%; max-width: 150px; }
  .key-btn, .key-clear, .value-input { border: 1px solid #ffffff30; border-radius: 6px; background: #ffffff05; color: #edf1f7; }
  .key-btn { flex: 1; min-width: 0; min-height: 36px; padding: 7px 10px; font: 600 12px ui-monospace, 'SF Mono', Monaco, monospace; cursor: pointer; overflow-wrap: anywhere; }
  .key-btn:hover { background: #ffffff0d; border-color: #93c5fd80; }
  .key-btn.listening { color: #152236; border-color: var(--color-focus); background: var(--color-focus); }
  .key-btn.unbound { color: var(--color-text-muted); border-style: dashed; }
  .key-clear { width: 30px; height: 36px; flex-shrink: 0; cursor: pointer; font-size: 18px; color: var(--color-text-muted); }
  .key-clear:hover:not(:disabled) { color: var(--color-danger-text); border-color: var(--color-danger-text); background: #ef444410; }
  .value-input { width: 82px; height: 36px; padding: 6px 8px; font: 600 13px ui-monospace, 'SF Mono', Monaco, monospace; font-variant-numeric: tabular-nums; }
  .unit { font-size: 12px; color: var(--color-text-muted); }
  .override-label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #b8c1cf; cursor: pointer; line-height: 1.4; }
  input[type="checkbox"] { width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: var(--color-focus); cursor: pointer; }
  .binding-error { padding: 10px 12px; margin: 8px 0; background: #ef444410; border: 1px solid #fca5a54d; border-radius: 6px; color: var(--color-danger-text); font-size: 12px; line-height: 1.5; }
  @media (max-width: 800px) {
    .shortcut-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 20px; padding: 18px 0; }
    h3, .override-label { grid-column: 1 / -1; }
  }
</style>
