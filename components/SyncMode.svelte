<script lang="ts">
  import { onMount } from "svelte";
  import { MPV_TAB_ID, NUDGE_STEPS, type SyncCandidate, type SyncStatusResponse } from "../lib/sync/types";
  import type { HareMessage } from "../lib/messages";
  import { sendToBackground } from "../lib/messaging";
  import { browser } from "wxt/browser";

  let { onExpandedChange }: { onExpandedChange: (expanded: boolean) => void } = $props();

  let syncStatus: SyncStatusResponse | null = $state(null);
  let candidates: SyncCandidate[] = $state([]);
  let selectedTabs: number[] = $state([]);
  let loading = $state(false);
  let starting = $state(false);
  let showSetup = $state(false);
  let error: string | null = $state(null);
  let brokenIcons: number[] = $state([]);
  const active = $derived.by(() => syncStatus?.active ? syncStatus : null);
  const offsetDisplay = $derived(offsetLabel(active?.offset ?? 0));
  const expanded = $derived(showSetup || active !== null);
  const message = $derived(error ?? (showSetup && !loading && candidates.length < 2 ? "Play media in at least two tabs to sync them." : null));
  $effect(() => { onExpandedChange(expanded); });

  const scriptsFolder = navigator.userAgent.includes("Windows") ? "%APPDATA%\\mpv\\scripts" : "~/.config/mpv/scripts";
  let copied = $state(false);
  const mpvFound = $derived(candidates.some(candidate => candidate.tabId === MPV_TAB_ID));

  // Add mpv as soon as it opens a video, so setup needs no refresh.
  $effect(() => {
    if (!showSetup || mpvFound) return;
    const timer = setInterval(async () => {
      const found = await sendToBackground({ type: "GET_MPV_CANDIDATE" }).catch(() => null);
      if (!found || loading || mpvFound) return;
      candidates = [...candidates, found];
    }, 2000);
    return () => clearInterval(timer);
  });

  async function copyScriptsFolder() {
    await navigator.clipboard.writeText(scriptsFolder);
    copied = true;
  }

  let statusRequest: Promise<void> | null = null;

  function loadSyncStatus(): Promise<void> {
    statusRequest ??= refreshSyncStatus().finally(() => { statusRequest = null; });
    return statusRequest;
  }

  async function refreshSyncStatus() {
    try {
      syncStatus = await sendToBackground({ type: "GET_SYNC_STATUS" });
    } catch {
      // A failed poll does not mean the session ended; keep Stop available.
    }
  }

  async function loadCandidates() {
    loading = true;
    error = null;
    try {
      candidates = await sendToBackground({ type: "GET_SYNC_CANDIDATES" });
      selectedTabs = selectedTabs.filter(id => candidates.some(candidate => candidate.tabId === id));
    } catch {
      error = "Could not find tabs with media. Try again.";
      candidates = [];
    } finally {
      loading = false;
    }
  }

  function toggleTab(tabId: number) {
    if (selectedTabs.includes(tabId)) {
      selectedTabs = selectedTabs.filter((id) => id !== tabId);
    } else if (selectedTabs.length < 2) {
      selectedTabs = [...selectedTabs, tabId];
    }
  }

  async function startSync() {
    starting = true;
    const started = await changeSync(
      { type: "START_SYNC", payload: { tabIdA: selectedTabs[0], tabIdB: selectedTabs[1] } },
      'Could not start sync. Try again.',
    );
    if (started) {
      showSetup = false;
      selectedTabs = [];
    }
    starting = false;
  }

  /** Resolves whether sync accepted the change; a refusal is shown as the error. */
  async function changeSync(
    message: Extract<HareMessage, { type: 'START_SYNC' | 'STOP_SYNC' | 'NUDGE_OFFSET' | 'SET_NUDGE_STEP' }>,
    failure = 'Could not update sync. Try again.',
  ): Promise<boolean> {
    loading = true;
    error = null;
    try {
      await statusRequest;
      const result = await sendToBackground(message);
      if (!result.success) throw new Error(result.error || failure);
      if (message.type === 'STOP_SYNC') syncStatus = null;
      await loadSyncStatus();
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : failure;
      return false;
    } finally { loading = false; }
  }

  async function changeNudgeStep(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    await changeSync({ type: 'SET_NUDGE_STEP', payload: Number(select.value) });
    if (active) select.value = String(active.nudgeStep);
  }

  function openSetup() {
    showSetup = true;
    loadCandidates();
  }

  function cancelSetup() {
    showSetup = false;
    selectedTabs = [];
    error = null;
  }

  function formatStep(step: number): string {
    return `${Math.round(step * 1000)} ms`;
  }

  function offsetLabel(offset: number): { magnitude: string; direction: string } {
    const absMs = Math.round(Math.abs(offset) * 1000);
    if (absMs === 0) return { magnitude: "in sync", direction: "" };
    const magnitude =
      absMs < 1000 ? `${absMs} ms` : `${(absMs / 1000).toFixed(3)} s`;
    return { magnitude, direction: offset > 0 ? "ahead" : "behind" };
  }

  onMount(() => {
    loadSyncStatus();
    const timer = setInterval(() => { if (!loading) void loadSyncStatus(); }, 1500);
    return () => clearInterval(timer);
  });
</script>

<section class="sync-section" aria-label="Video sync">
  {#if message}<div class="sync-error" role="alert">{message}</div>{/if}
  {#if active}
    <div class="sync-active">
      <div class="sync-header">
        <div class="sync-badge">Syncing</div>
        <button class="btn ghost danger" onclick={() => changeSync({ type: 'STOP_SYNC' })} disabled={loading}>Stop</button>
      </div>

      <div class="sync-tabs">
        <div class="sync-tab">
          <span class="tab-label">A</span>
          <span class="tab-title" title={active.videoA.title}>{active.videoA.title}</span>
        </div>
        <div class="sync-tab">
          <span class="tab-label">B</span>
          <span class="tab-title" title={active.videoB.title}>{active.videoB.title}</span>
        </div>
      </div>

      <div class="offset-control">
        <div class="offset-readout">
          <span>B is</span>
          <span class="offset-magnitude">{offsetDisplay.magnitude}</span>
          {#if offsetDisplay.direction}
            <span>{offsetDisplay.direction} of A</span>
          {/if}
        </div>
        <div class="field segmented">
          <button
            class="nudge-btn"
            disabled={loading}
            onclick={() => changeSync({ type: 'NUDGE_OFFSET', payload: -active.nudgeStep })}
            title="Shift B earlier by {formatStep(active.nudgeStep)}"
            aria-label="Shift B earlier"
          ><svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg></button>
          <select
            class="step-select"
            value={active.nudgeStep}
            onchange={changeNudgeStep}
            disabled={loading}
            aria-label="Nudge step"
          >
            {#each NUDGE_STEPS as step}
              <option value={step}>{formatStep(step)}</option>
            {/each}
          </select>
          <button
            class="nudge-btn"
            disabled={loading}
            onclick={() => changeSync({ type: 'NUDGE_OFFSET', payload: active.nudgeStep })}
            title="Shift B later by {formatStep(active.nudgeStep)}"
            aria-label="Shift B later"
          ><svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg></button>
        </div>
      </div>
    </div>
  {:else if showSetup}
    <div class="sync-setup">
      <div class="setup-header">
        <span>Select two tabs to sync</span>
        <span>
          <button class="btn ghost" onclick={loadCandidates} disabled={loading}>Refresh</button>
          <button class="btn ghost" onclick={cancelSetup} disabled={loading}>Cancel</button>
        </span>
      </div>
      <p class="setup-hint">Cue each video to the moment you want to pair. A sets the playback speed; B keeps its starting offset.</p>

      {#if loading}
        <div class="sync-loading" role="status">{starting ? 'Starting sync…' : 'Scanning tabs…'}</div>
      {:else}
        <div class="selection-status">
          <span role="status">{selectedTabs.length} of 2 selected</span>
          {#if selectedTabs.length === 2}
            <button class="btn ghost" onclick={() => { selectedTabs = [selectedTabs[1], selectedTabs[0]]; }}>Swap A / B</button>
          {/if}
        </div>
        {#if selectedTabs.length === 2 && candidates.length > 2}
          <p class="setup-hint">Deselect a tab to choose a different pair.</p>
        {/if}
        <div class="candidate-list">
          {#each candidates as candidate}
            <button
              class="candidate"
              class:selected={selectedTabs.includes(candidate.tabId)}
              aria-pressed={selectedTabs.includes(candidate.tabId)}
              disabled={selectedTabs.length === 2 && !selectedTabs.includes(candidate.tabId)}
              onclick={() => toggleTab(candidate.tabId)}
            >
              <span class="selection-marker" aria-hidden="true">{selectedTabs.includes(candidate.tabId) ? (selectedTabs.indexOf(candidate.tabId) === 0 ? 'A' : 'B') : '+'}</span>
              <span class="candidate-icon" aria-hidden="true">
                {#if candidate.favIconUrl && !brokenIcons.includes(candidate.tabId)}
                  <img src={candidate.favIconUrl} alt="" width="16" height="16" referrerpolicy="no-referrer" onerror={() => { brokenIcons = [...brokenIcons, candidate.tabId]; }} />
                {:else}
                  {candidate.domain.charAt(0).toUpperCase()}
                {/if}
              </span>
              <div class="candidate-info">
                <span class="candidate-title" title={candidate.title}>
                  {candidate.title}
                </span>
                <span class="candidate-domain">{candidate.domain}</span>
              </div>
              <span class="candidate-videos">
                {candidate.videoCount} {candidate.videoCount === 1 ? 'player' : 'players'}
              </span>
            </button>
          {/each}
        </div>

        <button
          class="btn primary"
          disabled={selectedTabs.length !== 2}
          onclick={startSync}
        >
          Start sync
        </button>
      {/if}
      {#if !mpvFound}
        <details class="mpv-setup">
          <summary>Sync with mpv</summary>
          <ol>
            <li><a href={browser.runtime.getURL("/hare.lua")} download="hare.lua">Download hare.lua</a></li>
            <li>
              Move it to <code>{scriptsFolder}</code>
              <button class="btn ghost" onclick={copyScriptsFolder}>{copied ? "Copied" : "Copy"}</button>
              <br />Create the folder if it doesn't exist.
            </li>
            <li>Open a video in mpv. It appears in the list above.</li>
          </ol>
        </details>
      {/if}
    </div>
  {:else}
    <button class="row-btn" onclick={openSetup}>
      <span class="sync-entry">
        Sync mode
        <span class="sync-description">Keep two video tabs playing together</span>
      </span>
      <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>
    </button>
  {/if}
</section>

<style>
  .sync-section { border-top: 1px solid var(--color-divider); }
  .sync-entry { display: flex; flex-direction: column; gap: 0.125rem; }
  .sync-description { font-size: 0.75rem; font-weight: 400; color: var(--color-text-muted); }

  .sync-active, .sync-setup { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem 1.25rem 1rem; }
  .sync-error { padding: 0.75rem 1.25rem 0; font-size: 0.75rem; color: var(--color-danger-text); }
  .sync-loading { padding: 0.75rem 0; font-size: 0.75rem; color: var(--color-text-muted); }

  .sync-header, .setup-header, .selection-status { display: flex; align-items: center; justify-content: space-between; }
  .sync-badge { font-size: 0.8125rem; font-weight: 600; color: var(--color-ok); }
  .setup-header { font-size: 0.8125rem; font-weight: 600; }
  .selection-status { min-height: 2rem; font-size: 0.75rem; color: var(--color-text-muted); }
  .setup-hint { margin: 0; font-size: 0.75rem; color: var(--color-text-muted); }

  .sync-tabs, .candidate-list { display: flex; flex-direction: column; }
  /* Full-width rows, like the popup's other rows. */
  .candidate-list { max-height: 12.5rem; margin-inline: -1.25rem; overflow-y: auto; }
  .sync-tab { display: flex; align-items: center; gap: 0.625rem; padding: 0.375rem 0; font-size: 0.8125rem; }
  .sync-tab + .sync-tab, .candidate + .candidate { border-top: 1px solid var(--color-divider); }
  .tab-label { flex-shrink: 0; font: 600 0.75rem var(--font-mono); color: var(--color-accent); }
  .tab-title, .candidate-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .offset-control { display: flex; flex-direction: column; gap: 0.375rem; font-size: 0.75rem; }
  .offset-readout { display: flex; align-items: baseline; gap: 0.375rem; color: var(--color-text-muted); }
  .offset-magnitude { font-size: 0.875rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--color-text); }
  .nudge-btn, .step-select { min-height: 2rem; border: 0; background: transparent; }
  .nudge-btn { display: grid; place-items: center; width: 2.5rem; flex-shrink: 0; padding: 0; }
  .nudge-btn:hover:not(:disabled) { background: var(--color-hover); }
  .step-select { flex: 1; padding: 0 0.375rem; border-inline: 1px solid var(--color-divider); font-size: 0.8125rem; text-align: center; text-align-last: center; cursor: pointer; }

  .candidate {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 1.25rem;
    border: 0;
    background: transparent;
    font-size: 0.8125rem;
    text-align: start;
  }
  .candidate:hover:not(:disabled) { background: var(--color-hover); }
  .candidate:focus-visible { outline-offset: -2px; }
  .selection-marker {
    display: grid;
    place-items: center;
    width: 1.5rem;
    height: 1.5rem;
    flex-shrink: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    font: 600 0.75rem var(--font-mono);
    color: var(--color-text-muted);
  }
  .selected .selection-marker { border-color: var(--color-accent-fill); background: var(--color-accent-fill); color: #fff; }
  .candidate-icon { display: grid; place-items: center; width: 1rem; height: 1rem; flex-shrink: 0; overflow: hidden; font-size: 0.625rem; font-weight: 700; color: var(--color-text-muted); }
  .candidate-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .candidate-title { font-weight: 500; }
  .candidate-domain, .candidate-videos { font-size: 0.6875rem; color: var(--color-text-muted); }
  .candidate-videos { flex-shrink: 0; }

  .mpv-setup { font-size: 0.75rem; color: var(--color-text-muted); }
  .mpv-setup summary { cursor: pointer; color: var(--color-text-secondary); }
  .mpv-setup ol { margin: 0.375rem 0 0; padding-left: 1.125rem; }
  .mpv-setup a { color: var(--color-accent); }
  .mpv-setup code { color: var(--color-text); overflow-wrap: anywhere; }
</style>
