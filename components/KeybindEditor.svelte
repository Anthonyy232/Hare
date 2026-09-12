<script lang="ts">
  import { onDestroy } from "svelte";
  import type { KeyBinding, KeyAction } from "../lib/types";
  import { MESSAGES } from "../lib/messages";

  interface Props {
    bindings: KeyBinding[];
    onBindingsChange: (bindings: KeyBinding[]) => void;
    onDraftChange?: (dirty: boolean) => void;
  }

  let { bindings, onBindingsChange, onDraftChange }: Props = $props();

  let editingIndex: number | null = $state(null);
  let listeningForKey = $state(false);
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
    listeningForKey = true;
  }

  function clearBinding(index: number) {
    listeningForKey = false;
    editingIndex = null;
    const newBindings = [...bindings];
    newBindings[index] = { ...newBindings[index], key: "" };
    onBindingsChange(newBindings);
  }

  /**
   * Captures the next key press to update a binding.
   * Stops propagation to prevent side effects on other UI elements.
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (!listeningForKey || editingIndex === null) return;

    if (event.code === 'Tab') {
      listeningForKey = false;
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
      listeningForKey = false;
      editingIndex = null;
      return;
    }

    // Backspace / Delete clears the binding (leaving it unbound).
    if (event.code === "Backspace" || event.code === "Delete") {
      clearBinding(editingIndex);
      listeningForKey = false;
      editingIndex = null;
      return;
    }

    // Empty keys mean unbound — they don't conflict with each other.
    const isDuplicate = bindings.some(
      (b, i) => i !== editingIndex && b.key === event.code && b.key !== "",
    );

    if (isDuplicate) {
      errorMessage = MESSAGES.DUPLICATE_KEYBIND;
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        errorMessage = null;
        errorTimeout = null;
      }, 3000);
      listeningForKey = false;
      editingIndex = null;
      return;
    }

    const newBindings = [...bindings];
    newBindings[editingIndex] = {
      ...newBindings[editingIndex],
      key: event.code,
    };

    onBindingsChange(newBindings);
    listeningForKey = false;
    editingIndex = null;
  }

  function updateValue(index: number, value: number) {
    if (!Number.isFinite(value)) return;
    const action = bindings[index].action;
    const max = action === 'rewind' || action === 'advance' ? 86400 : 16;
    const validValue = Math.min(max, Math.max(action === 'reset' ? 0.07 : 0.01, value));
    const newBindings = [...bindings];
    newBindings[index] = { ...newBindings[index], value: validValue };
    onBindingsChange(newBindings);
  }

  function handleBlur(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    updateValue(index, value);
    target.value = bindings[index].value.toString();
    onDraftChange?.(false);
  }

  function toggleForce(index: number) {
    const newBindings = [...bindings];
    newBindings[index] = {
      ...newBindings[index],
      force: !newBindings[index].force,
    };
    onBindingsChange(newBindings);
  }

  /** Intercepts global key events while in "learning" mode to capture any key combination. */
  $effect(() => {
    if (listeningForKey) {
      window.addEventListener("keydown", handleKeyDown, true);
      return () => window.removeEventListener("keydown", handleKeyDown, true);
    }
  });

  onDestroy(() => {
    if (errorTimeout) {
      clearTimeout(errorTimeout);
      errorTimeout = null;
    }
  });
</script>

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
              class:listening={editingIndex === index && listeningForKey}
              class:unbound={!binding.key && !(editingIndex === index && listeningForKey)}
              onclick={() => startListening(index)}
              onblur={() => { listeningForKey = false; editingIndex = null; }}
              aria-label={`Change shortcut for ${actionLabels[binding.action]}`}
              aria-pressed={editingIndex === index && listeningForKey}
            >
              {#if editingIndex === index && listeningForKey}Press a key…
              {:else if binding.key}{formatKey(binding.key)}
              {:else}Unbound{/if}
            </button>
            <button type="button" class="key-clear" title="Clear shortcut"
              aria-label={`Clear shortcut for ${actionLabels[binding.action]}`}
              disabled={!binding.key} onclick={() => clearBinding(index)}>×</button>
          </div>
        </div>
        <div class="shortcut-field value-field">
          {#if actionValueLabels[binding.action]}
            <label for={`binding-value-${index}`} class="field-label">{actionValueLabels[binding.action]}</label>
            <div class="value-control">
              <input id={`binding-value-${index}`} type="number" class="value-input"
                value={binding.value} step="0.01"
                min={binding.action === 'reset' ? 0.07 : 0.01}
                max={binding.action === 'rewind' || binding.action === 'advance' ? 86400 : 16}
                aria-label={`${actionLabels[binding.action]} ${actionValueLabels[binding.action]}`}
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
  .intro, .help-text { font-size: 12px; color: #aaa; line-height: 1.6; }
  .intro { margin: 0 0 8px; }
  .help-text { margin: 16px 0 0; padding: 12px; border-radius: 6px; background: #ffffff05; }
  .help-text strong { color: #d8e0eb; font-weight: 600; }
  .shortcut-list { list-style: none; padding: 0; margin: 0; }
  .shortcut-row { display: grid; grid-template-columns: minmax(130px, 1fr) 150px 130px 174px; align-items: center; gap: 18px; padding: 16px 0; border-bottom: 1px solid #ffffff12; }
  .shortcut-row:last-child { border-bottom: 0; padding-bottom: 0; }
  h3 { margin: 0; font-size: 13px; font-weight: 600; color: #edf1f7; }
  .shortcut-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; }
  .field-label { font-size: 11px; color: #aaa; }
  .key-cell, .value-control { display: flex; align-items: center; gap: 6px; }
  .key-cell { width: 100%; max-width: 150px; }
  .key-btn, .key-clear, .value-input { border: 1px solid #ffffff30; border-radius: 6px; background: #ffffff05; color: #edf1f7; }
  .key-btn { flex: 1; min-width: 0; min-height: 36px; padding: 7px 10px; font: 600 12px ui-monospace, 'SF Mono', Monaco, monospace; cursor: pointer; overflow-wrap: anywhere; }
  .key-btn:hover { background: #ffffff0d; border-color: #93c5fd80; }
  .key-btn.listening { color: #152236; border-color: #93c5fd; background: #93c5fd; }
  .key-btn.unbound { color: #aaa; border-style: dashed; }
  .key-clear { width: 30px; height: 36px; flex-shrink: 0; cursor: pointer; font-size: 18px; color: #aaa; }
  .key-clear:hover:not(:disabled) { color: #fca5a5; border-color: #fca5a5; background: #ef444410; }
  .value-input { width: 82px; height: 36px; padding: 6px 8px; font: 600 13px ui-monospace, 'SF Mono', Monaco, monospace; font-variant-numeric: tabular-nums; }
  .unit { font-size: 12px; color: #aaa; }
  .override-label { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #b8c1cf; cursor: pointer; line-height: 1.4; }
  input[type="checkbox"] { width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: #93c5fd; cursor: pointer; }
  .binding-error { padding: 10px 12px; margin: 8px 0; background: #ef444410; border: 1px solid #fca5a54d; border-radius: 6px; color: #fca5a5; font-size: 12px; line-height: 1.5; }
  @media (max-width: 800px) {
    .shortcut-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 20px; padding: 18px 0; }
    h3, .override-label { grid-column: 1 / -1; }
  }
</style>
