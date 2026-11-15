<script lang="ts">
  import { onMount } from "svelte";
  import KeybindEditor from "../../components/KeybindEditor.svelte";
  import BlacklistEditor from "../../components/BlacklistEditor.svelte";
  import ControllerPreview from "../../components/ControllerPreview.svelte";
  import logo from "../../assets/logo.svg";
  import {
    loadSettings,
    saveSettings,
    resetSettings,
    watchSettings,
    validateBlacklist,
  } from "../../lib/settings/settings";
  import { OPACITY_RANGE, BUTTON_SIZE_RANGE, type Settings } from "../../lib/settings/schema";

  const SAVE_FEEDBACK_MS = 2000;
  let settings: Settings | null = $state(null);
  let loading = $state(true);
  let saving = $state(false);
  let saved = $state(false);
  let savedSnapshot = $state('');
  let hasDraftInput = $state(false);
  const hasUnsavedChanges = $derived(hasDraftInput || (settings !== null && JSON.stringify(settings) !== savedSnapshot));
  const validationErrors = $derived.by(() => settings ? validateBlacklist(settings.blacklist) : []);
  let error: string | null = $state(null);
  let conflictWarning = $state(false);
  let saveFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  function showSavedFeedback() {
    if (saveFeedbackTimeout) clearTimeout(saveFeedbackTimeout);
    saved = true;
    saveFeedbackTimeout = setTimeout(() => {
      saved = false;
      saveFeedbackTimeout = null;
    }, SAVE_FEEDBACK_MS);
  }

  async function load() {
    loading = true;
    error = null;
    try {
      const value = await loadSettings();
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
    try {
      const snapshot = await saveSettings(settings);
      savedSnapshot = JSON.stringify(snapshot);
      settings = snapshot;
      conflictWarning = false;
      showSavedFeedback();
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save. Your changes are still here; try again.'; }
    finally { saving = false; }
  }

  async function reset() {
    if (saving) return;
    if (confirm('Reset all settings to defaults?')) {
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

  function updateSettings(patch: Partial<Settings>) {
    if (!settings) return;
    settings = { ...settings, ...patch };
    saved = false;
  }

  onMount(() => {
    (async () => {
      await load();
      watchSettings((newSettings) => {
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
</script>

<svelte:window onbeforeunload={(event) => {
  if (hasUnsavedChanges) { event.preventDefault(); event.returnValue = ''; }
}} />

<div class="options">
  <header>
    <img class="header-logo" src={logo} alt="" width="44" height="44" />
    <div class="header-text">
      <h1>Hare</h1>
      <p class="subtitle">Video Speed Control</p>
    </div>
  </header>

  {#if error && !settings}
    <div class="conflict-warning" role="alert">{error}
      <button class="btn secondary" onclick={load}>Try again</button>
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading settings...</div>
  {:else if settings}
    <main>
      <fieldset disabled={saving}>
      <div class="settings-grid">
        <section class="card">
          <h2>Core Settings</h2>

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
                onchange={(event) => updateSettings({ enabled: event.currentTarget.checked })}
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
                onchange={(event) => updateSettings({ enableAudio: event.currentTarget.checked })}
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
                onchange={(event) => updateSettings({ startHidden: event.currentTarget.checked })}
              />
              <span class="toggle-slider"></span>
            </div>
          </label>
        </section>

        <section class="card">
          <h2>Controller Display</h2>

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
                min={OPACITY_RANGE.MIN}
                max={OPACITY_RANGE.MAX}
                step="0.01"
                value={settings.controllerOpacity}
                oninput={(event) => updateSettings({ controllerOpacity: event.currentTarget.valueAsNumber })}
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
                min={BUTTON_SIZE_RANGE.MIN}
                max={BUTTON_SIZE_RANGE.MAX}
                step="1"
                value={settings.controllerButtonSize}
                oninput={(event) => updateSettings({ controllerButtonSize: event.currentTarget.valueAsNumber })}
              />
              <span class="slider-value">{settings.controllerButtonSize}px</span
              >
            </div>
          </div>
          <ControllerPreview opacity={settings.controllerOpacity} size={settings.controllerButtonSize} startHidden={settings.startHidden} />
        </section>
      </div>

      <section class="card">
        <h2>Keybindings</h2>
        <KeybindEditor
          bindings={settings.keyBindings}
          onBindingsChange={(keyBindings) => updateSettings({ keyBindings })}
          onDraftChange={(dirty) => { hasDraftInput = dirty; if (dirty) saved = false; }}
        />
      </section>

      <section class="card">
        <h2>Excluded sites</h2>
        <BlacklistEditor
          blacklist={settings.blacklist}
          errors={validationErrors}
          onBlacklistChange={(blacklist) => updateSettings({ blacklist })}
        />
      </section>
      </fieldset>

      {#if conflictWarning}
        <div class="conflict-warning" role="alert">
          <div class="conflict-text">
            <strong>Warning:</strong>
            Settings were changed in another tab. Save to overwrite, or reload to discard your changes.
          </div>
          <button class="conflict-discard" onclick={load}>
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
    background: var(--color-surface);
    min-height: 100%;
  }

  .options {
    max-width: 1000px;
    margin: 0 auto;
    padding: 32px 24px 100px;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    color: var(--color-text);
  }

  header {
    margin-bottom: 32px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .header-text {
    flex: 1;
  }

  h1 {
    margin: 0 0 2px;
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 0;
    color: var(--color-text-muted);
    font-size: 14px;
    font-weight: 500;
  }

  .loading {
    text-align: center;
    padding: 60px 40px;
    color: var(--color-text-muted);
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
    background: var(--color-raised);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-lg);
  }

  .settings-grid .card {
    margin-bottom: 0;
    display: flex;
    flex-direction: column;
  }

  h2 {
    margin: 0 0 16px;
    font-size: 18px;
    font-weight: 700;
    color: var(--color-text);
    letter-spacing: -0.01em;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--color-divider);
    cursor: pointer;
  }

  .toggle-row:last-of-type {
    border-bottom: none;
  }

  .toggle-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text);
  }

  .toggle-description {
    font-size: 12px;
    color: var(--color-text-muted);
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
    background-color: var(--color-border);
    transition: background-color 0.2s ease;
    border-radius: 24px;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 4px;
    bottom: 4px;
    background-color: var(--color-text);
    transition: transform 0.2s ease;
    border-radius: 50%;
  }

  input[type="checkbox"]:checked + .toggle-slider {
    background: var(--color-accent-strong);
  }

  input[type="checkbox"]:focus-visible + .toggle-slider {
    outline: 2px solid var(--color-focus);
    outline-offset: 3px;
  }

  input[type="checkbox"]:checked + .toggle-slider:before {
    transform: translateX(20px);
  }

  .slider-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 0;
    border-bottom: 1px solid var(--color-divider);
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
    color: var(--color-text);
  }

  .slider-description {
    font-size: 12px;
    color: var(--color-text-muted);
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
    background: var(--color-border);
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
    background: var(--color-accent-strong);
    cursor: pointer;
  }

  .slider-value {
    min-width: 45px;
    text-align: right;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-accent);
  }

  .conflict-warning {
    padding: 12px 16px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.2);
    border-radius: var(--radius);
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
    border-radius: var(--radius);
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
    background: var(--color-surface);
    border-top: 1px solid var(--color-divider);
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
    border-radius: var(--radius);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    border: 1px solid transparent;
  }

  .btn.primary {
    background: var(--color-accent-fill);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--color-accent-fill-hover);
  }

  .btn.secondary {
    background: var(--color-field);
    color: var(--color-text);
    border-color: var(--color-border);
  }

  .btn.secondary:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    color: var(--color-danger-text);
    border-color: rgba(239, 68, 68, 0.3);
  }

  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .save-status { margin-right: auto; align-self: center; font-size: 13px; color: var(--color-text-muted); }
  .save-error { margin: 0 0 10px; color: var(--color-danger-text); font-size: 13px; }
  @media (max-width: 600px) {
    .options { padding: 24px 16px 140px; }
    .card { padding: 16px; }
    .actions-wrapper { padding: 12px 16px; }
    .actions { flex-wrap: wrap; gap: 8px; }
    .save-status { width: 100%; }
    .btn { padding: 10px 14px; }
  }
</style>
