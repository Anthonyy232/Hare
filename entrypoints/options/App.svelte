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
    if (!settings) return;
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
    <img src={logo} alt="" width="28" height="28" />
    <h1>Hare <span>Settings</span></h1>
  </header>

  {#if error && !settings}
    <div class="conflict-warning" role="alert">{error}
      <button class="btn secondary" onclick={load}>Try again</button>
    </div>
  {/if}

  {#if loading}
    <p class="loading">Loading settings…</p>
  {:else if settings}
    <main>
      <fieldset disabled={saving}>
        <section>
          <h2>Core settings</h2>
          <div class="rows">
            <label class="check-row">
              <input
                type="checkbox"
                checked={settings.enabled}
                onchange={(event) => updateSettings({ enabled: event.currentTarget.checked })}
              />
              <span class="row-text">
                <span class="row-title">Enable Hare</span>
                <span class="row-description">Control playback on sites outside your exclusions</span>
              </span>
            </label>

            <label class="check-row">
              <input
                type="checkbox"
                checked={settings.enableAudio}
                onchange={(event) => updateSettings({ enableAudio: event.currentTarget.checked })}
              />
              <span class="row-text">
                <span class="row-title">Include audio-only media</span>
                <span class="row-description">Control audio elements in addition to video</span>
              </span>
            </label>

            <label class="check-row">
              <input
                type="checkbox"
                checked={settings.startHidden}
                onchange={(event) => updateSettings({ startHidden: event.currentTarget.checked })}
              />
              <span class="row-text">
                <span class="row-title">Start with controller hidden</span>
                <span class="row-description">Hide controller by default on page load</span>
              </span>
            </label>
          </div>
        </section>

        <section>
          <h2>Controller display</h2>
          <div class="rows">
            <div class="slider-row">
              <span class="row-text">
                <label class="row-title" for="opacity">Controller opacity</label>
                <span class="row-description">Transparency when not hovering</span>
              </span>
              <input
                type="range"
                id="opacity"
                min={OPACITY_RANGE.MIN}
                max={OPACITY_RANGE.MAX}
                step="0.01"
                value={settings.controllerOpacity}
                aria-valuetext={`${Math.round(settings.controllerOpacity * 100)}%`}
                oninput={(event) => updateSettings({ controllerOpacity: event.currentTarget.valueAsNumber })}
              />
              <span class="slider-value">{Math.round(settings.controllerOpacity * 100)}%</span>
            </div>

            <div class="slider-row">
              <span class="row-text">
                <label class="row-title" for="size">Button size</label>
                <span class="row-description">Size of controller buttons</span>
              </span>
              <input
                type="range"
                id="size"
                min={BUTTON_SIZE_RANGE.MIN}
                max={BUTTON_SIZE_RANGE.MAX}
                step="1"
                value={settings.controllerButtonSize}
                aria-valuetext={`${settings.controllerButtonSize} pixels`}
                oninput={(event) => updateSettings({ controllerButtonSize: event.currentTarget.valueAsNumber })}
              />
              <span class="slider-value">{settings.controllerButtonSize}px</span>
            </div>
            <ControllerPreview opacity={settings.controllerOpacity} size={settings.controllerButtonSize} startHidden={settings.startHidden} />
          </div>
        </section>

        <section>
          <h2>Keybindings</h2>
          <KeybindEditor
            bindings={settings.keyBindings}
            onBindingsChange={(keyBindings) => updateSettings({ keyBindings })}
            onDraftChange={(dirty) => { hasDraftInput = dirty; if (dirty) saved = false; }}
          />
        </section>

        <section>
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
          <button class="btn secondary" onclick={load}>
            Discard local changes
          </button>
        </div>
      {/if}

      <div class="actions">
        {#if error}<p class="save-error" role="alert">{error}</p>{/if}
        <span class="save-status" role="status">{saving ? 'Saving…' : hasUnsavedChanges ? 'Unsaved changes' : saved ? 'Settings saved' : 'All changes saved'}</span>
        <button class="btn secondary" onclick={reset} disabled={saving}>
          Reset to defaults
        </button>
        <button class="btn primary" onclick={save} disabled={saving || !hasUnsavedChanges || validationErrors.length > 0}>
          Save settings
        </button>
      </div>
    </main>
  {/if}
</div>

<style>
  /* Keeps focused fields clear of the sticky save bar. */
  :global(html) { scroll-padding-bottom: 5rem; }

  .options {
    max-width: 60rem;
    margin: 0 auto;
    padding: 2rem 1.5rem 0;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-bottom: 1.5rem;
  }

  h1 { margin: 0; font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; }
  h1 span { font-weight: 400; color: var(--color-text-muted); }

  .loading { color: var(--color-text-muted); }

  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }

  section {
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    gap: 1rem 2rem;
    padding: 1.75rem 0;
    border-top: 1px solid var(--color-divider);
  }

  h2 { margin: 0; font-size: 0.9375rem; font-weight: 600; text-wrap: balance; }

  .rows { display: flex; flex-direction: column; gap: 1.125rem; min-width: 0; }

  .check-row { display: flex; align-items: flex-start; gap: 0.75rem; cursor: pointer; }
  .check-row input { width: 1.125rem; height: 1.125rem; margin: 0.125rem 0 0; flex-shrink: 0; cursor: pointer; }

  .row-text { display: flex; flex-direction: column; min-width: 0; }
  .row-title { font-size: 0.875rem; font-weight: 500; }
  .row-description { font-size: 0.8125rem; color: var(--color-text-muted); }

  .slider-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(8rem, 14rem) 3.5rem; align-items: center; gap: 1rem; }
  .slider-row input { width: 100%; margin: 0; cursor: pointer; }
  .slider-value { text-align: end; font: 500 0.8125rem var(--font-mono); font-variant-numeric: tabular-nums; }

  .conflict-warning {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    background: var(--color-warning-soft);
    color: var(--color-warning-text);
    font-size: 0.8125rem;
  }
  .conflict-text { flex: 1; min-width: 0; }

  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 0.875rem 0;
    border-top: 1px solid var(--color-divider);
    background: var(--color-surface);
  }
  .save-status { margin-right: auto; font-size: 0.8125rem; color: var(--color-text-muted); }
  .save-error { flex-basis: 100%; margin: 0; color: var(--color-danger-text); font-size: 0.8125rem; }

  @media (max-width: 60rem) {
    section { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 32rem) {
    .options { padding-inline: 1rem; }
    .slider-row { grid-template-columns: minmax(0, 1fr) 3.5rem; }
    .slider-row .row-text { grid-column: 1 / -1; }
  }
</style>
