<script lang="ts">
  import { onMount } from "svelte";
  import type { SyncCandidate, SyncStatusResponse } from "../lib/sync-types";
  import { SYNC, NUDGE_STEPS } from "../lib/sync-types";

  let { onExpandedChange }: { onExpandedChange?: (expanded: boolean) => void } = $props();

  let syncStatus: SyncStatusResponse | null = $state(null);
  let candidates: SyncCandidate[] = $state([]);
  let selectedTabs: number[] = $state([]);
  let loading = $state(false);
  let starting = $state(false);
  let showSetup = $state(false);
  let error: string | null = $state(null);
  const nudgeStep = $derived.by(() => syncStatus?.nudgeStep ?? SYNC.DEFAULT_NUDGE_STEP);
  const offsetDisplay = $derived.by(() => offsetLabel(syncStatus?.offset ?? 0));
  const expanded = $derived.by(() => showSetup || syncStatus?.active === true);
  $effect(() => { onExpandedChange?.(expanded); });

  let statusRequest: Promise<void> | null = null;

  function loadSyncStatus(): Promise<void> {
    statusRequest ??= refreshSyncStatus().finally(() => { statusRequest = null; });
    return statusRequest;
  }

  async function refreshSyncStatus() {
    try {
      syncStatus = await browser.runtime.sendMessage({ type: "GET_SYNC_STATUS" }) as SyncStatusResponse;
    } catch {
      // A failed poll does not mean the session ended; keep Stop available.
    }
  }

  async function loadCandidates() {
    loading = true;
    error = null;
    try {
      candidates = await browser.runtime.sendMessage({ type: "GET_SYNC_CANDIDATES" }) as SyncCandidate[];
      if (!Array.isArray(candidates)) throw new Error('Invalid tab list');
      selectedTabs = selectedTabs.filter(id => candidates.some(candidate => candidate.tabId === id));
      if (candidates.length < 2) {
        error = "Need at least 2 tabs with videos";
      }
    } catch {
      error = "Failed to find video tabs";
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
    if (selectedTabs.length !== 2 || loading) return;
    loading = true;
    starting = true;
    error = null;
    try {
      await statusRequest;
      const result = await browser.runtime.sendMessage({
        type: "START_SYNC",
        payload: { tabIdA: selectedTabs[0], tabIdB: selectedTabs[1] },
      });
      if (!result?.success) throw new Error(result?.error || 'Failed to start sync');
      showSetup = false;
      selectedTabs = [];
      await loadSyncStatus();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to start sync';
    } finally {
      loading = false;
      starting = false;
    }
  }

  async function changeSync(type: 'STOP_SYNC' | 'NUDGE_OFFSET' | 'SET_NUDGE_STEP', payload?: number) {
    if (loading) return;
    loading = true;
    error = null;
    try {
      await statusRequest;
      const result = await browser.runtime.sendMessage({ type, payload });
      if (!result?.success) throw new Error(result?.error || 'Could not update sync. Try again.');
      if (type === 'STOP_SYNC') syncStatus = null;
      await loadSyncStatus();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update sync. Try again.';
    } finally { loading = false; }
  }

  async function changeNudgeStep(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    await changeSync('SET_NUDGE_STEP', Number(select.value));
    select.value = String(nudgeStep);
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
  {#if error}<div class="sync-error" role="alert">{error}</div>{/if}
  {#if syncStatus?.active}
    <div class="sync-active">
      <div class="sync-header">
        <div class="sync-badge">SYNC</div>
        <button class="stop-btn" onclick={() => changeSync('STOP_SYNC')} disabled={loading}>Stop</button>
      </div>

      <div class="sync-tabs">
        <div class="sync-tab">
          <span class="tab-label">A</span>
          <span class="tab-title" title={syncStatus.videoA?.title}>
            {syncStatus.videoA?.title ?? "Tab A"}
          </span>
        </div>
        <div class="sync-tab">
          <span class="tab-label">B</span>
          <span class="tab-title" title={syncStatus.videoB?.title}>
            {syncStatus.videoB?.title ?? "Tab B"}
          </span>
        </div>
      </div>

      <div class="offset-control">
        <div class="offset-readout">
          <span class="offset-prefix">B is</span>
          <span class="offset-magnitude">{offsetDisplay.magnitude}</span>
          {#if offsetDisplay.direction}
            <span class="offset-direction">{offsetDisplay.direction} of A</span>
          {/if}
        </div>
        <div class="offset-controls">
          <button
            class="nudge-btn"
            disabled={loading}
            onclick={() => changeSync('NUDGE_OFFSET', -nudgeStep)}
            title="Shift B earlier by {formatStep(nudgeStep)}"
            aria-label="Shift B earlier"
          >◀</button>
          <select
            class="step-select"
            value={nudgeStep}
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
            onclick={() => changeSync('NUDGE_OFFSET', nudgeStep)}
            title="Shift B later by {formatStep(nudgeStep)}"
            aria-label="Shift B later"
          >▶</button>
        </div>
      </div>
    </div>
  {:else if showSetup}
    <div class="sync-setup">
      <div class="setup-header">
        <span>Select 2 tabs to sync</span>
        <button class="cancel-btn" onclick={cancelSetup} disabled={loading}>Cancel</button>
      </div>
      <p class="setup-hint">Cue each video to the moment you want to pair. A sets the playback speed; B keeps its starting offset.</p>

      {#if loading}
        <div class="sync-loading" role="status">{starting ? 'Starting sync…' : 'Scanning tabs…'}</div>
      {:else}
        <div class="selection-status">
          <span role="status">{selectedTabs.length} of 2 selected</span>
          {#if selectedTabs.length === 2}
            <button class="swap-btn" onclick={() => { selectedTabs = [selectedTabs[1], selectedTabs[0]]; }}>Swap A / B</button>
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
          class="start-btn"
          disabled={selectedTabs.length !== 2 || loading}
          onclick={startSync}
        >
          Start Sync
        </button>
      {/if}
      <button class="sync-mode-btn" onclick={loadCandidates} disabled={loading}>Refresh tab list</button>
    </div>
  {:else}
    <button class="sync-mode-btn" onclick={openSetup}>
      <svg viewBox="0 0 24 24" class="sync-icon">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
      Sync Mode
    </button>
    <p class="sync-description">Keep two video tabs playing together</p>
  {/if}
</section>

<style>
  .selection-status { display: flex; justify-content: space-between; align-items: center; min-height: 32px; font-size: 11px; color: #c4b5fd; }
  .swap-btn { background: #a78bfa14; border: 1px solid #a78bfa4d; color: #ddd6fe; padding: 6px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }
  .selection-marker { display: grid; place-items: center; width: 24px; height: 24px; margin-right: 8px; border: 1px solid #ffffff30; border-radius: 5px; flex-shrink: 0; color: #bbb; font-weight: 700; }
  .selected .selection-marker { color: #1f1735; background: #c4b5fd; border-color: #c4b5fd; }
  .sync-description { font-size: 11px; color: #aaa; text-align: center; margin: 7px 0 0; }
  .setup-hint { font-size: 12px; color: #aaa; line-height: 1.5; margin: 0; }
  .sync-section {
    padding: 0 20px 18px;
    position: relative;
    z-index: 1;
  }

  .sync-mode-btn {
    width: 100%;
    padding: 10px 16px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 6px;
    background: rgba(139, 92, 246, 0.1);
    color: #f0f0f0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .sync-mode-btn:hover {
    background: rgba(139, 92, 246, 0.2);
    border-color: rgba(139, 92, 246, 0.5);
  }

  .sync-icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sync-active {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sync-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sync-badge {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #10b981;
    background: rgba(16, 185, 129, 0.15);
    padding: 3px 8px;
    border-radius: 3px;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .stop-btn {
    font-size: 11px;
    font-weight: 600;
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 3px;
    padding: 3px 10px;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .stop-btn:hover {
    background: rgba(239, 68, 68, 0.2);
  }

  .sync-tabs {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .sync-tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    font-size: 12px;
  }

  .tab-label {
    font-size: 10px;
    font-weight: 700;
    color: #60a5fa;
    background: rgba(96, 165, 250, 0.15);
    padding: 1px 5px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .tab-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #ccc;
  }

  .offset-control {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
  }

  .offset-readout {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: #ccc;
  }

  .offset-prefix,
  .offset-direction {
    color: #999;
    font-size: 11px;
  }

  .offset-magnitude {
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
    color: #f0f0f0;
    font-weight: 600;
    font-size: 13px;
  }

  .offset-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nudge-btn {
    width: 28px;
    height: 26px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: #f0f0f0;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .nudge-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .nudge-btn:active {
    background: rgba(139, 92, 246, 0.2);
  }

  .step-select {
    flex: 1;
    font-size: 11px;
    padding: 4px 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: #ccc;
    cursor: pointer;
    text-align: center;
    text-align-last: center;
  }

  .sync-setup {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .setup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    font-weight: 600;
    color: #ccc;
  }

  .cancel-btn {
    font-size: 11px;
    color: #999;
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
  }

  .cancel-btn:hover {
    color: #f0f0f0;
  }

  .sync-loading,
  .sync-error {
    text-align: center;
    font-size: 12px;
    color: #999;
    padding: 12px 0;
  }

  .sync-error {
    color: #ef4444;
  }

  .candidate-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
  }

  .candidate {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.03);
    color: #ccc;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
    text-align: left;
    width: 100%;
    font-size: 12px;
  }

  .candidate:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .candidate.selected {
    border-color: rgba(139, 92, 246, 0.5);
    background: rgba(139, 92, 246, 0.1);
  }

  .candidate-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  }

  .candidate-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .candidate-domain {
    font-size: 10px;
    color: #aaa;
  }

  .candidate-videos {
    font-size: 10px;
    color: #999;
    flex-shrink: 0;
    margin-left: 8px;
  }

  .start-btn {
    width: 100%;
    padding: 8px 16px;
    border: 1px solid rgba(139, 92, 246, 0.4);
    border-radius: 4px;
    background: rgba(139, 92, 246, 0.2);
    color: #f0f0f0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, opacity 0.15s ease;
  }

  .start-btn:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.3);
  }

  .start-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
