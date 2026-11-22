<script lang="ts">
  import { onDestroy } from "svelte";
  import { ACTIONS, clampBindingValue, isShortcutKey, type KeyBinding } from "../lib/settings/key-actions";

  interface Props {
    bindings: KeyBinding[];
    onBindingsChange: (bindings: KeyBinding[]) => void;
    onDraftChange: (dirty: boolean) => void;
  }

  let { bindings, onBindingsChange, onDraftChange }: Props = $props();

  let editingIndex: number | null = $state(null);
  let errorMessage: string | null = $state(null);
  let errorTimeout: ReturnType<typeof setTimeout> | null = null;

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

    if (!isShortcutKey(event) || /^(Control|Alt|Meta|Shift)/.test(event.code)) {
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
    onDraftChange(false);
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
      {@const action = ACTIONS[binding.action]}
      <li class="shortcut-row">
        <h3>{action.label}</h3>
        <div class="shortcut-field">
          <span class="field-label" aria-hidden="true">Shortcut</span>
          <div class="key-cell">
            <button
              class="key-btn field"
              class:listening={editingIndex === index}
              class:unbound={!binding.key && editingIndex !== index}
              onclick={() => startListening(index)}
              onblur={() => { editingIndex = null; }}
              aria-label={`Change shortcut for ${action.label}`}
              aria-pressed={editingIndex === index}
            >
              {#if editingIndex === index}Press a key…
              {:else if binding.key}{formatKey(binding.key)}
              {:else}Unbound{/if}
            </button>
            <button type="button" class="key-clear" title="Clear shortcut"
              aria-label={`Clear shortcut for ${action.label}`}
              disabled={!binding.key} onclick={() => { editingIndex = null; patch(index, { key: '' }); }}>×</button>
          </div>
        </div>
        <div class="shortcut-field">
          {#if action.value}
            <label for={`binding-value-${index}`} class="field-label">{action.value.label}</label>
            <div class="value-control">
              <input id={`binding-value-${index}`} type="number" class="value-input field"
                value={binding.value} step="0.01"
                min={action.value.min}
                max={action.value.max}
                aria-label={`${action.label} ${action.value.label}`}
                onkeydown={(event) => {
                  if (event.key !== 'Enter' && event.key !== 'Escape') return;
                  event.preventDefault();
                  if (event.key === 'Escape') event.currentTarget.value = binding.value.toString();
                  event.currentTarget.blur();
                }}
                oninput={() => onDraftChange(true)} onblur={(e) => handleBlur(index, e)} />
              <span class="unit" aria-hidden="true">{action.value.unit}</span>
            </div>
          {/if}
        </div>
        <label class="override-label">
          <input type="checkbox" checked={binding.force} onchange={() => toggleForce(index)}
            aria-label={`Override site shortcut for ${action.label}`} />
          <span>Override site shortcut</span>
        </label>
      </li>
    {/each}
  </ul>
  <p class="help-text">Enable <strong>Override site shortcut</strong> when a website uses the same key. Hare shortcuts stay inactive while you type in a text field.</p>
</div>

<style>
  .keybind-editor { min-width: 0; }
  .intro, .help-text { margin: 0; font-size: 0.8125rem; color: var(--color-text-muted); }
  .help-text { margin-top: 1rem; }
  .help-text strong { color: var(--color-text); font-weight: 600; }
  .shortcut-list { list-style: none; padding: 0; margin: 0; }
  .shortcut-row { display: grid; grid-template-columns: minmax(130px, 1fr) 150px 130px 174px; align-items: end; gap: 18px; padding: 0.875rem 0; border-bottom: 1px solid var(--color-divider); }
  h3 { margin: 0; padding-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500; }
  .shortcut-field { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; min-width: 0; }
  .field-label { font-size: 0.6875rem; color: var(--color-text-muted); }
  .key-cell, .value-control { display: flex; align-items: center; gap: 0.375rem; }
  .key-cell { width: 100%; max-width: 150px; }
  .key-btn, .value-input { min-height: 2.25rem; font: 600 0.8125rem var(--font-mono); }
  /* A thicker bottom edge reads as a keycap. */
  .key-btn { flex: 1; min-width: 0; padding: 0.375rem 0.625rem; border-bottom-width: 3px; overflow-wrap: anywhere; }
  .key-btn:hover { border-color: var(--color-accent-line); }
  .key-btn.listening { color: #fff; border-color: var(--color-accent-fill-hover); background: var(--color-accent-fill); }
  .key-btn.unbound { color: var(--color-text-muted); border-style: dashed; }
  .key-clear { width: 1.75rem; height: 2.25rem; flex-shrink: 0; border: 0; border-radius: var(--radius); background: transparent; font-size: 1.125rem; color: var(--color-text-muted); }
  .key-clear:hover:not(:disabled) { color: var(--color-danger-text); background: var(--color-danger-soft); }
  .value-input { width: 5.125rem; padding: 0.375rem 0.5rem; font-variant-numeric: tabular-nums; }
  .unit { font-size: 0.75rem; color: var(--color-text-muted); }
  .override-label { display: flex; align-items: center; gap: 0.5rem; padding-bottom: 0.5rem; font-size: 0.8125rem; color: var(--color-text-secondary); cursor: pointer; }
  input[type="checkbox"] { width: 1.125rem; height: 1.125rem; margin: 0; flex-shrink: 0; cursor: pointer; }
  .binding-error { padding: 0.625rem 0.75rem; margin: 0.5rem 0; border-radius: var(--radius); background: var(--color-danger-soft); color: var(--color-danger-text); font-size: 0.8125rem; }
  @media (max-width: 800px) {
    .shortcut-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 20px; }
    h3, .override-label { grid-column: 1 / -1; padding-bottom: 0; }
  }
</style>
