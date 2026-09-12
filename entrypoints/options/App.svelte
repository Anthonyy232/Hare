<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import KeybindEditor from "../../components/KeybindEditor.svelte";
  import BlacklistEditor from "../../components/BlacklistEditor.svelte";
  import ControllerPreview from "../../components/ControllerPreview.svelte";
  import {
    loadSettings,
    saveSettings,
    resetSettings,
    watchSettings,
    normalizeSettings,
    validateBlacklist,
  } from "../../lib/settings";
  import { CONTROLLER, UI } from "../../lib/constants";
  import type { Settings, KeyBinding } from "../../lib/types";
  import { MESSAGES } from "../../lib/messages";

  let settings: Settings | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let savedSnapshot = $state('');
  let hasDraftInput = $state(false);
  const hasUnsavedChanges = $derived(hasDraftInput || (settings !== null && JSON.stringify(settings) !== savedSnapshot));
  const validationErrors = $derived.by(() => settings ? validateBlacklist(settings.blacklist) : []);
  let error: string | null = $state(null);
  let disposed = false;
  let conflictWarning = $state(false);
  let unwatchSettings: (() => void) | null = null;
  let saveFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  function showSavedFeedback() {
    if (saveFeedbackTimeout) clearTimeout(saveFeedbackTimeout);
    saved = true;
    saveFeedbackTimeout = setTimeout(() => {
      saved = false;
      saveFeedbackTimeout = null;
    }, UI.SAVE_FEEDBACK_MS);
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const value = await loadSettings({ strict: true });
      settings = value;
      savedSnapshot = JSON.stringify(value);
      conflictWarning = false;
    } catch { error = 'Could not load your settings. Try again before making changes.'; }
    finally { loading = false; }
  }

  async function save() {
    if (!settings || saving || validationErrors.length) return;

    saving = true;
    error = null;
    const snapshot = normalizeSettings(settings);
    try {
      await saveSettings(snapshot);
      savedSnapshot = JSON.stringify(snapshot);
      settings = snapshot;
      conflictWarning = false;
      showSavedFeedback();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save. Your changes are still here; try again.'; }
    finally { saving = false; }
  }

  async function reset() {
    if (saving) return;
    if (confirm(MESSAGES.RESET_SETTINGS_CONFIRM)) {
      saving = true;
      error = null;
      try {
        settings = await resetSettings();
        savedSnapshot = JSON.stringify(settings);
        conflictWarning = false;
        showSavedFeedback();
      } catch { error = 'Could not reset settings. Your previous settings are preserved.'; }
      finally { saving = false; }
    }
  }

  async function discardChanges() {
    await load();
  }

  function handleBindingsChange(bindings: KeyBinding[]) {
    if (settings) {
      settings = { ...settings, keyBindings: bindings };
      saved = false;
    }
  }

  function handleBlacklistChange(blacklist: string) {
    if (settings) {
      settings = { ...settings, blacklist };
      saved = false;
    }
  }

  function handleEnabledChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        enabled: (event.target as HTMLInputElement).checked,
      };
      saved = false;
    }
  }

  function handleAudioChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        enableAudio: (event.target as HTMLInputElement).checked,
      };
      saved = false;
    }
  }

  function handleStartHiddenChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        startHidden: (event.target as HTMLInputElement).checked,
      };
      saved = false;
    }
  }

  function handleOpacityChange(event: Event) {
    if (settings) {
      settings = {
        ...settings,
        controllerOpacity: parseFloat((event.target as HTMLInputElement).value),
      };
      saved = false;
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
      saved = false;
    }
  }

  onMount(() => {
    // Arm the watch only after the initial load resolves. Otherwise an
    // external storage change that races with load() can clobber `settings`
    // (or trigger a spurious conflict warning) before we've shown the form.
    (async () => {
      await load();
      if (disposed) return;
      unwatchSettings = watchSettings((newSettings) => {
        if (saving) return;
        if (hasUnsavedChanges) {
          conflictWarning = true;
        } else {
          settings = newSettings;
          savedSnapshot = JSON.stringify(newSettings);
        }
      });
    })();
  });

  onDestroy(() => {
    disposed = true;
    unwatchSettings?.();
    if (saveFeedbackTimeout) {
      clearTimeout(saveFeedbackTimeout);
      saveFeedbackTimeout = null;
    }
  });
</script>

<svelte:window onbeforeunload={(event) => {
  if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = ''; }
}} />

<div class="options">
  <header>
    <div class="header-badge">🐇</div>
    <div class="header-text">
      <h1>Hare</h1>
      <p class="subtitle">Video Speed Control</p>
    </div>
  </header>

  {#if error && !settings}
    <div class="conflict-warning" role="alert">{error}
      {#if !settings}<button class="btn secondary" onclick={load}>Try again</button>{/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading settings...</div>
  {:else if settings}
    <main>
      <fieldset disabled={saving}>
      <div class="settings-grid">
        <section class="card">
          <div class="section-header">
            <div class="section-accent"></div>
            <h2>Core Settings</h2>
          </div>

          <label class="toggle-row">
            <div class="toggle-content">
              <span class="toggle-label">Enable Hare</span>
              <span class="toggle-description"
                >Control playback on sites outside your exclusions</span
              >
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
              <span class="toggle-description"
                >Control audio elements in addition to video</span
              >
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
              <span class="toggle-description"
                >Hide controller by default on page load</span
              >
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
              <span class="slider-description"
                >Transparency when not hovering</span
              >
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
              <span class="slider-value"
                >{Math.round(settings.controllerOpacity * 100)}%</span
              >
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
              <span class="slider-value">{settings.controllerButtonSize}px</span
              >
            </div>
          </div>
          <ControllerPreview opacity={settings.controllerOpacity} size={settings.controllerButtonSize} startHidden={settings.startHidden} />
        </section>
      </div>

      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Keybindings</h2>
        </div>
        <KeybindEditor
          bindings={settings.keyBindings}
          onBindingsChange={handleBindingsChange}
          onDraftChange={(dirty) => { hasDraftInput = dirty; if (dirty) saved = false; }}
        />
      </section>

      <section class="card">
        <div class="section-header">
          <div class="section-accent"></div>
          <h2>Excluded sites</h2>
        </div>
        <BlacklistEditor
          blacklist={settings.blacklist}
          onBlacklistChange={handleBlacklistChange}
        />
      </section>
      </fieldset>

      {#if conflictWarning}
        <div class="conflict-warning" role="alert">
          <div class="conflict-text">
            <strong>Warning:</strong>
            {MESSAGES.SETTINGS_CONFLICT}
          </div>
          <button class="conflict-discard" onclick={discardChanges}>
            Discard local changes
          </button>
        </div>
      {/if}

      <div class="actions-wrapper">
        <div class="actions-container">
          {#if error}<p class="save-error" role="alert">{error}</p>{/if}
          <div class="actions">
            <span class="save-status" role="status">{saving ? 'Saving…' : hasUnsavedChanges ? 'Unsaved changes' : saved ? 'Settings saved' : 'All changes saved'}</span>
            <button class="btn secondary" onclick={reset} disabled={saving}>
              Reset to Defaults
            </button>
            <button class="btn primary" onclick={save} disabled={saving || !hasUnsavedChanges || validationErrors.length > 0}>
              {#if saving}
                Saving...
              {:else if saved}
                ✓ Saved
              {:else}
                Save Settings
              {/if}
            </button>
          </div>
        </div>
      </div>
    </main>
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
    min-height: 100%;
  }

  /* Fixed background to cover full viewport without causing growth loop */
  :global(body)::before {
    content: "";
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(165deg, #1e1e1e 0%, #1a1a1a 100%);
    z-index: -1;
  }

  .options {
    max-width: 1000px;
    margin: 0 auto;
    padding: 32px 24px 100px;
    font-family:
      "DM Sans",
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    color: #f0f0f0;
  }

  header {
    margin-bottom: 32px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .header-badge {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    border-radius: 10px;
    font-size: 28px;
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
  }

  .header-text {
    flex: 1;
  }

  h1 {
    margin: 0 0 2px;
    font-size: 28px;
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
    font-size: 14px;
    font-weight: 500;
    opacity: 0.9;
  }

  .loading {
    text-align: center;
    padding: 60px 40px;
    color: #999;
    font-size: 16px;
  }

  .settings-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: 20px;
    margin-bottom: 20px;
  }

  .card {
    margin-bottom: 20px;
    padding: 20px;
    background: rgba(40, 40, 40, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    backdrop-filter: blur(10px);
  }

  /* Make grid cards the same height */
  .settings-grid .card {
    margin-bottom: 0;
    display: flex;
    flex-direction: column;
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .section-accent {
    width: 3px;
    height: 20px;
    background: linear-gradient(180deg, #60a5fa, #93c5fd);
    border-radius: 2px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #f0f0f0;
    letter-spacing: -0.01em;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .toggle-row:last-of-type {
    border-bottom: none;
  }

  .toggle-row:hover {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 6px;
  }

  .toggle-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-size: 14px;
    font-weight: 600;
    color: #f0f0f0;
  }

  .toggle-description {
    font-size: 12px;
    color: #888;
  }

  .toggle-switch {
    flex-shrink: 0;
    margin-left: 12px;
    position: relative;
    width: 44px;
    height: 24px;
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
    transition: all 0.2s ease;
    border-radius: 24px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 3px;
    bottom: 3px;
    background-color: #f0f0f0;
    transition: all 0.2s ease;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  input[type="checkbox"]:checked + .toggle-slider {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    border-color: #60a5fa;
  }

  input[type="checkbox"]:focus-visible + .toggle-slider {
    outline: 2px solid rgba(96, 165, 250, 0.8);
    outline-offset: 2px;
  }

  input[type="checkbox"]:checked + .toggle-slider:before {
    transform: translateX(20px);
  }

  .slider-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .slider-row:last-of-type {
    border-bottom: none;
  }

  .slider-label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .slider-label-group label {
    font-size: 14px;
    font-weight: 600;
    color: #f0f0f0;
  }

  .slider-description {
    font-size: 12px;
    color: #888;
  }

  .slider-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .slider-control input[type="range"] {
    flex: 1;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
  }

  .slider-control input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: linear-gradient(135deg, #60a5fa, #93c5fd);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .slider-value {
    min-width: 45px;
    text-align: right;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    font-weight: 600;
    color: #93c5fd;
  }

  .conflict-warning {
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: 8px;
    color: #fbbf24;
    font-size: 13px;
    line-height: 1.5;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .conflict-text {
    flex: 1;
    min-width: 0;
  }

  .conflict-discard {
    padding: 6px 12px;
    border-radius: 6px;
    background: rgba(251, 191, 36, 0.15);
    border: 1px solid rgba(251, 191, 36, 0.4);
    color: #fbbf24;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease;
    flex-shrink: 0;
  }

  .conflict-discard:hover {
    background: rgba(251, 191, 36, 0.25);
  }

  .actions-wrapper {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 20px 24px;
    background: rgba(26, 26, 26, 0.85);
    backdrop-filter: blur(12px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    z-index: 100;
  }

  .actions-container {
    max-width: 1000px;
    margin: 0 auto;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  .btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
  }

  .btn.primary {
    background: linear-gradient(135deg, #3b82f6, #60a5fa);
    color: #0d172b;
    box-shadow: 0 2px 8px rgba(59, 130, 246, 0.3);
  }

  .btn.primary:hover:not(:disabled) {
    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    transform: translateY(-1px);
  }

  .btn.primary:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn.secondary {
    background: rgba(40, 40, 40, 0.6);
    color: #f0f0f0;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn.secondary:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    border-color: rgba(239, 68, 68, 0.3);
  }

  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .save-status { margin-right: auto; align-self: center; font-size: 13px; color: #b5b5b5; }
  .save-error { margin: 0 0 10px; color: #fca5a5; font-size: 13px; }
  @media (max-width: 600px) {
    .options { padding: 24px 16px 140px; }
    .card { padding: 16px; }
    .actions-wrapper { padding: 12px 16px; }
    .actions { flex-wrap: wrap; gap: 8px; }
    .save-status { width: 100%; }
    .btn { padding: 10px 14px; }
  }
</style>
