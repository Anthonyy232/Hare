<script lang="ts">
  import { onMount } from "svelte";
  import type { SyncCandidate, SyncStatusResponse } from "../lib/sync-types";
  import { SYNC } from "../lib/sync-types";
  import { logger } from "../lib/logger";

  let syncStatus: SyncStatusResponse | null = $state(null);
  let candidates: SyncCandidate[] = $state([]);
  let selectedTabs: number[] = $state([]);
  let loading = $state(false);
  let showSetup = $state(false);
  let error: string | null = $state(null);
  let nudgeStep = $state(SYNC.DEFAULT_NUDGE_STEP);

  const NUDGE_STEPS = [0.1, 0.5, 1.0];

  async function loadSyncStatus() {
    try {
      syncStatus = await browser.runtime.sendMessage({ type: "GET_SYNC_STATUS" }) as SyncStatusResponse;
    } catch {
      syncStatus = null;
    }
  }

  async function loadCandidates() {
    loading = true;
    error = null;
    try {
      candidates = await browser.runtime.sendMessage({ type: "GET_SYNC_CANDIDATES" }) as SyncCandidate[];
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
    } else {
      // Replace the first selection
      selectedTabs = [selectedTabs[1], tabId];
    }
  }

  async function startSync() {
    if (selectedTabs.length !== 2) return;
    loading = true;
    try {
      await browser.runtime.sendMessage({
        type: "START_SYNC",
        payload: { tabIdA: selectedTabs[0], tabIdB: selectedTabs[1] },
      });
      showSetup = false;
      selectedTabs = [];
      await loadSyncStatus();
    } catch {
      error = "Failed to start sync";
    } finally {
      loading = false;
    }
  }

  async function stopSync() {
    try {
      await browser.runtime.sendMessage({ type: "STOP_SYNC" });
      syncStatus = null;
    } catch (e) {
      logger.error("Failed to stop sync", e);
    }
  }

  async function nudge(direction: number) {
    try {
      await browser.runtime.sendMessage({
        type: "NUDGE_OFFSET",
        payload: direction * nudgeStep,
      });
      await loadSyncStatus();
    } catch (e) {
      logger.error("Failed to nudge offset", e);
    }
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

  function formatOffset(offset: number): string {
    const abs = Math.abs(offset);
    const sign = offset >= 0 ? "+" : "-";
    return `${sign}${abs.toFixed(1)}s`;
  }

  onMount(() => {
    loadSyncStatus();
  });
</script>

<div class="sync-section">
  {#if syncStatus?.active}
    <!-- Active sync view -->
    <div class="sync-active">
      <div class="sync-header">
        <div class="sync-badge">SYNC</div>
        <button class="stop-btn" onclick={stopSync}>Stop</button>
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
        <span class="offset-label">Offset</span>
        <div class="offset-buttons">
          <button class="nudge-btn" onclick={() => nudge(-1)}>-</button>
          <span class="offset-value">{formatOffset(syncStatus.offset)}</span>
          <button class="nudge-btn" onclick={() => nudge(1)}>+</button>
        </div>
        <select class="step-select" bind:value={nudgeStep}>
          {#each NUDGE_STEPS as step}
            <option value={step}>{step}s</option>
          {/each}
        </select>
      </div>
    </div>
  {:else if showSetup}
    <!-- Setup view -->
    <div class="sync-setup">
      <div class="setup-header">
        <span>Select 2 tabs to sync</span>
        <button class="cancel-btn" onclick={cancelSetup}>Cancel</button>
      </div>

      {#if loading}
        <div class="sync-loading">Scanning tabs...</div>
      {:else if error}
        <div class="sync-error">{error}</div>
      {:else}
        <div class="candidate-list">
          {#each candidates as candidate}
            <button
              class="candidate"
              class:selected={selectedTabs.includes(candidate.tabId)}
              onclick={() => toggleTab(candidate.tabId)}
            >
              <div class="candidate-info">
                <span class="candidate-title" title={candidate.title}>
                  {candidate.title}
                </span>
                <span class="candidate-domain">{candidate.domain}</span>
              </div>
              <span class="candidate-videos">
                {candidate.videoCount} video{candidate.videoCount !== 1 ? "s" : ""}
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
    </div>
  {:else}
    <!-- Inactive — show button to open setup -->
    <button class="sync-mode-btn" onclick={openSetup}>
      <svg viewBox="0 0 24 24" class="sync-icon">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
      Sync Mode
    </button>
  {/if}
</div>

<style>
  .sync-section {
    padding: 0;
  }

  .sync-mode-btn {
    width: 100%;
    padding: 10px 16px;
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 4px;
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
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .offset-label {
    color: #999;
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .offset-buttons {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
  }

  .nudge-btn {
    width: 24px;
    height: 24px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: #f0f0f0;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s ease;
  }

  .nudge-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .offset-value {
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
    color: #f0f0f0;
    min-width: 50px;
    text-align: center;
  }

  .step-select {
    font-size: 11px;
    padding: 3px 6px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
    color: #ccc;
    cursor: pointer;
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
    color: #666;
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
