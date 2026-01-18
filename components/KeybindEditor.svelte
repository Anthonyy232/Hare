<script lang="ts">
  import type { KeyBinding, KeyAction } from "../lib/types";
  import { MESSAGES } from "../lib/messages";

  interface Props {
    bindings: KeyBinding[];
    onBindingsChange: (bindings: KeyBinding[]) => void;
  }

  let { bindings, onBindingsChange }: Props = $props();

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
    editingIndex = index;
    listeningForKey = true;
  }

  /**
   * Captures the next key press to update a binding.
   * Stops propagation to prevent side effects on other UI elements.
   */
  function handleKeyDown(event: KeyboardEvent) {
    if (!listeningForKey || editingIndex === null) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.code === "Escape") {
      listeningForKey = false;
      editingIndex = null;
      return;
    }

    const isDuplicate = bindings.some(
      (b, i) => i !== editingIndex && b.key === event.code,
    );

    if (isDuplicate) {
      errorMessage = MESSAGES.DUPLICATE_KEYBIND;
      if (errorTimeout) clearTimeout(errorTimeout);
      errorTimeout = setTimeout(() => {
        errorMessage = null;
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
    const validValue = Math.max(0, isNaN(value) ? 0 : value);
    const newBindings = [...bindings];
    newBindings[index] = { ...newBindings[index], value: validValue };
    onBindingsChange(newBindings);
  }

  function handleBlur(index: number, event: Event) {
    const target = event.target as HTMLInputElement;
    const value = parseFloat(target.value);
    // Bounds check to prevent accessing deleted/invalid bindings
    if (isNaN(value) && index >= 0 && index < bindings.length) {
      target.value = bindings[index].value.toString();
    }
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
</script>

<div class="keybind-editor">
  <table>
    <thead>
      <tr>
        <th>Action</th>
        <th>Key</th>
        <th>Value</th>
        <th>Force</th>
      </tr>
    </thead>
    <tbody>
      {#each bindings as binding, index}
        <tr>
          <td class="action">{actionLabels[binding.action]}</td>
          <td>
            <button
              class="key-btn"
              class:listening={editingIndex === index && listeningForKey}
              onclick={() => startListening(index)}
            >
              {editingIndex === index && listeningForKey
                ? "Press a key..."
                : formatKey(binding.key)}
            </button>
          </td>
          <td>
            {#if actionValueLabels[binding.action]}
              <input
                type="number"
                class="value-input"
                value={binding.value}
                step={binding.action === "slower" || binding.action === "faster"
                  ? 0.1
                  : 1}
                min={0}
                oninput={(e) =>
                  updateValue(
                    index,
                    parseFloat((e.target as HTMLInputElement).value),
                  )}
                onblur={(e) => handleBlur(index, e)}
              />
              <span class="value-label"
                >{actionValueLabels[binding.action]}</span
              >
            {:else}
              <span class="no-value">-</span>
            {/if}
          </td>
          <td>
            <input
              type="checkbox"
              checked={binding.force}
              onchange={() => toggleForce(index)}
              title="Override site keyboard shortcuts"
            />
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  <p class="help-text">
    <strong>Force:</strong> Prevents the website from intercepting the key.
    Press <strong>Escape</strong> to cancel while listening.
  </p>

  {#if errorMessage}
    <div class="error-toast">{errorMessage}</div>
  {/if}
</div>

<style>
  .keybind-editor {
    width: 100%;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: 12px 16px;
    text-align: left;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  th {
    font-weight: 700;
    color: #999;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: rgba(40, 40, 40, 0.3);
  }

  tbody tr {
    transition: background 0.15s ease;
  }

  tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .action {
    font-weight: 600;
    color: #f0f0f0;
    font-size: 14px;
  }

  .key-btn {
    min-width: 90px;
    padding: 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(40, 40, 40, 0.6);
    color: #f0f0f0;
    font-size: 13px;
    font-family: ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .key-btn:hover {
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(40, 40, 40, 0.8);
  }

  .key-btn.listening {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    color: #fff;
    border-color: #60a5fa;
  }

  .key-btn:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.8);
    outline-offset: 2px;
  }

  .value-input {
    width: 70px;
    padding: 6px 10px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    background: rgba(40, 40, 40, 0.6);
    color: #f0f0f0;
    font-size: 14px;
    font-family: ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    transition: all 0.15s ease;
  }

  .value-input:focus {
    outline: none;
    border-color: rgba(59, 130, 246, 0.6);
    background: rgba(40, 40, 40, 0.8);
  }

  .value-label {
    margin-left: 8px;
    font-size: 12px;
    color: #999;
    font-weight: 500;
  }

  .no-value {
    color: #666;
    font-style: italic;
  }

  input[type="checkbox"] {
    width: 20px;
    height: 20px;
    cursor: pointer;
    accent-color: #60a5fa;
  }

  .help-text {
    margin-top: 16px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-left: 3px solid rgba(59, 130, 246, 0.5);
    border-radius: 4px;
    font-size: 13px;
    color: #999;
    line-height: 1.6;
  }

  .help-text strong {
    color: #f0f0f0;
    font-weight: 600;
  }

  .error-toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    background: rgba(239, 68, 68, 0.95);
    color: #fff;
    border-radius: 4px;
    font-size: 13px;
    z-index: 1000;
    animation: slideInUp 0.2s ease;
  }
</style>
