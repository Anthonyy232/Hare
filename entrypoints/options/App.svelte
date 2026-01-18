<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import KeybindEditor from "../../components/KeybindEditor.svelte";
  import BlacklistEditor from "../../components/BlacklistEditor.svelte";
  import {
    loadSettings,
    saveSettings,
    resetSettings,
    watchSettings,
  } from "../../lib/settings";
  import { CONTROLLER, UI } from "../../lib/constants";
  import type { Settings, KeyBinding } from "../../lib/types";
  import { MESSAGES } from "../../lib/messages";

  let settings: Settings | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let hasUnsavedChanges = $state(false);
  let conflictWarning = $state(false);
  let unwatchSettings: (() => void) | null = null;

  async function load() {
    loading = true;
    settings = await loadSettings();
    loading = false;
  }

  async function save() {
    if (!settings) return;

    saving = true;
    hasUnsavedChanges = false;
    conflictWarning = false;
    await saveSettings(settings);
    saving = false;
    saved = true;
    setTimeout(() => (saved = false), UI.SAVE_FEEDBACK_MS);
  }

  async function reset() {
    if (confirm(MESSAGES.RESET_SETTINGS_CONFIRM)) {
      settings = await resetSettings();
      saved = true;
      setTimeout(() => (saved = false), UI.SAVE_FEEDBACK_MS);
    }
  }

  function handleBindingsChange(bindings: KeyBinding[]) {
    if (settings) {
      settings = { ...settings, keyBindings: bindings };
      hasUnsavedChanges = true;
    }
  }

  function handleBlacklistChange(blacklist: string) {
    if (settings) {
      settings = { ...settings, blacklist };
      hasUnsavedChanges = true;
    }
  }

  function handleEnabledChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        enabled: (event.target as HTMLInputElement).checked,
      };
      hasUnsavedChanges = true;
    }
  }

  function handleAudioChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        enableAudio: (event.target as HTMLInputElement).checked,
      };
      hasUnsavedChanges = true;
    }
  }

  function handleStartHiddenChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        startHidden: (event.target as HTMLInputElement).checked,
      };
      hasUnsavedChanges = true;
    }
  }

  function handleOpacityChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        controllerOpacity: parseFloat((event.target as HTMLInputElement).value),
      };
      hasUnsavedChanges = true;
    }
  }

  function handleSizeChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        controllerButtonSize: parseInt(
          (event.target as HTMLInputElement).value,
        ),
      };
      hasUnsavedChanges = true;
    }
  }

  onMount(() => {
    load();
    unwatchSettings = watchSettings((newSettings) => {
      /**
       * If we are currently saving, ignore external changes.
       * If there are unsaved local changes, show a warning instead of overwriting.
       * Otherwise, accept the external changes.
       */
      if (saving) return;

      if (hasUnsavedChanges) {
        conflictWarning = true;
      } else {
        settings = newSettings;
      }
    });
  });

  onDestroy(() => {
    unwatchSettings?.();
  });
</script>

<div class="options">
  <header>
    <div class="header-badge">🐇</div>
    <div class="header-text">
      <h1>Hare</h1>
      <p class="subtitle">Video Speed Control</p>
    </div>
  </header>

  {#if loading}
    <div class="loading">Loading settings...</div>
  {:else if settings}
    <main>
      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Core Settings</h2>
        </div>

        <label class="toggle-row">
          <div class="toggle-content">
            <span class="toggle-label">Enable on all sites</span>
            <span class="toggle-description">Activate video speed control globally</span>
          </div>
          <div class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.enabled}
              onchange={handleEnabledChange}
            />
            <span class="toggle-slider"></span>
          </div>
        </label>

        <label class="toggle-row">
          <div class="toggle-content">
            <span class="toggle-label">Include audio-only media</span>
            <span class="toggle-description">Control audio elements in addition to video</span>
          </div>
          <div class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.enableAudio}
              onchange={handleAudioChange}
            />
            <span class="toggle-slider"></span>
          </div>
        </label>

        <label class="toggle-row">
          <div class="toggle-content">
            <span class="toggle-label">Start with controller hidden</span>
            <span class="toggle-description">Hide controller by default on page load</span>
          </div>
          <div class="toggle-switch">
            <input
              type="checkbox"
              checked={settings.startHidden}
              onchange={handleStartHiddenChange}
            />
            <span class="toggle-slider"></span>
          </div>
        </label>
      </section>

      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Controller Display</h2>
        </div>

        <div class="slider-row">
          <div class="slider-label-group">
            <label for="opacity">Controller opacity</label>
            <span class="slider-description">Transparency when not hovering</span>
          </div>
          <div class="slider-control">
            <input
              type="range"
              id="opacity"
              min={CONTROLLER.MIN_OPACITY}
              max={CONTROLLER.MAX_OPACITY}
              step="0.1"
              value={settings.controllerOpacity}
              oninput={handleOpacityChange}
            />
            <span class="slider-value">{settings.controllerOpacity.toFixed(1)}</span>
          </div>
        </div>

        <div class="slider-row">
          <div class="slider-label-group">
            <label for="size">Button size</label>
            <span class="slider-description">Size of controller buttons</span>
          </div>
          <div class="slider-control">
            <input
              type="range"
              id="size"
              min={CONTROLLER.MIN_BUTTON_SIZE}
              max={CONTROLLER.MAX_BUTTON_SIZE}
              step="1"
              value={settings.controllerButtonSize}
              oninput={handleSizeChange}
            />
            <span class="slider-value">{settings.controllerButtonSize}px</span>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Keybindings</h2>
        </div>
        <KeybindEditor
          bindings={settings.keyBindings}
          onBindingsChange={handleBindingsChange}
        />
      </section>

      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Blacklist</h2>
        </div>
        <BlacklistEditor
          blacklist={settings.blacklist}
          onBlacklistChange={handleBlacklistChange}
        />
      </section>

      {#if conflictWarning}
        <div class="conflict-warning">
          <strong>Warning:</strong> {MESSAGES.SETTINGS_CONFLICT}
        </div>
      {/if}

      <div class="actions">
        <button class="btn primary" onclick={save} disabled={saving}>
          {#if saving}
            Saving...
          {:else if saved}
            ✓ Saved
          {:else}
            Save Settings
          {/if}
        </button>

        <button class="btn secondary" onclick={reset}>
          Reset to Defaults
        </button>
      </div>
    </main>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
  }

  .options {
    max-width: 1000px;
    margin: 0 auto;
    padding: 40px 24px;
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: linear-gradient(165deg, #1e1e1e 0%, #1a1a1a 100%);
    min-height: 100vh;
    color: #f0f0f0;
  }

  header {
    margin-bottom: 40px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .header-badge {
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    border-radius: 8px;
    font-size: 32px;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .header-text {
    flex: 1;
  }

  h1 {
    margin: 0 0 4px;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #60a5fa, #93c5fd);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    margin: 0;
    color: #60a5fa;
    font-size: 16px;
    font-weight: 500;
  }

  .loading {
    text-align: center;
    padding: 60px 40px;
    color: #999;
    font-size: 16px;
  }

  .card {
    margin-bottom: 24px;
    padding: 24px;
    background: rgba(40, 40, 40, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 20px;
  }

  .section-accent {
    width: 4px;
    height: 24px;
    background: linear-gradient(180deg, #60a5fa, #93c5fd);
    border-radius: 2px;
  }

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #f0f0f0;
    letter-spacing: -0.01em;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .toggle-row:last-of-type {
    border-bottom: none;
  }

  .toggle-row:hover {
    background: rgba(255, 255, 255, 0.03);
    padding-left: 12px;
    padding-right: 12px;
    margin-left: -12px;
    margin-right: -12px;
    border-radius: 4px;
  }

  .toggle-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toggle-label {
    font-size: 15px;
    font-weight: 600;
    color: #f0f0f0;
  }

  .toggle-description {
    font-size: 13px;
    color: #999;
  }

  .toggle-switch {
    position: relative;
    width: 48px;
    height: 26px;
  }

  .toggle-switch input[type="checkbox"] {
    opacity: 0;
    width: 0;
    height: 0;
    position: absolute;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(255, 255, 255, 0.15);
    transition: background 0.2s ease, border-color 0.2s ease;
    border-radius: 26px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: #f0f0f0;
    transition: transform 0.2s ease;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  input[type="checkbox"]:checked + .toggle-slider {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    border-color: #60a5fa;
  }

  input[type="checkbox"]:checked + .toggle-slider:before {
    transform: translateX(22px);
  }

  .slider-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .slider-row:last-of-type {
    border-bottom: none;
  }

  .slider-label-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .slider-label-group label {
    font-size: 15px;
    font-weight: 600;
    color: #f0f0f0;
  }

  .slider-description {
    font-size: 13px;
    color: #999;
  }

  .slider-control {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .slider-control input[type="range"] {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.15);
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
  }

  .slider-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa, #93c5fd);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .slider-control input[type="range"]::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa, #93c5fd);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .slider-value {
    min-width: 50px;
    text-align: right;
    font-family: ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace;
    font-variant-numeric: tabular-nums;
    font-size: 15px;
    font-weight: 600;
    color: #93c5fd;
  }

  .conflict-warning {
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
    border-radius: 6px;
    color: #fbbf24;
    font-size: 13px;
    line-height: 1.5;
    margin-top: 24px;
  }

  .conflict-warning strong {
    color: #fcd34d;
    font-weight: 700;
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 32px;
  }

  .btn {
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease;
    border: none;
  }

  .btn.primary {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    color: #fff;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  }

  .btn.primary:hover:not(:disabled) {
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
  }

  .btn.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn.secondary {
    background: rgba(239, 68, 68, 0.1);
    color: #f0f0f0;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .btn.secondary:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.5);
  }
</style>
