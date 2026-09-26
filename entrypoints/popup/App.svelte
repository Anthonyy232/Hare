<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import SpeedControl from "../../components/SpeedControl.svelte";
  import SyncMode from "../../components/SyncMode.svelte";
  import type { StatusResponse, HareMessage } from "../../lib/types";
  import { SPEED, UI } from "../../lib/constants";
  import { MESSAGES } from "../../lib/messages";
  import { loadSettings, saveSettings, isBlacklisted, removeExactSiteExclusions } from "../../lib/settings";
  import { getTabMedia, aggregateStatus, sendToFrame } from "../../lib/tab-media";

  let status: StatusResponse | null = $state(null);
  let loading = $state(true);
  let busy = $state(false);
  let syncExpanded = $state(false);
  let statusRequest: Promise<void> | null = null;
  let error: string | null = $state(null);
  let hint = $state('');
  let toast: string | null = $state(null);
  let tabId: number | null = null;
  let tabUrl = '';
  let siteLabel = $state('Current tab');
  let siteAction: 'enable' | 'include' | 'exclude' | 'settings' | null = $state(null);
  const speedPresets = [0.75, 1, 1.25, 1.5, 2];
  let disposed = false;
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    disposed = true;
    if (toastTimeout) clearTimeout(toastTimeout);
  });

  function showToast(message: string) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast = message;
    toastTimeout = setTimeout(() => { toast = null; }, UI.TOAST_DURATION_MS * 2);
  }

  function loadStatus(): Promise<void> {
    if (disposed) return Promise.resolve();
    statusRequest ??= refreshStatus().finally(() => { statusRequest = null; });
    return statusRequest;
  }

  async function refreshStatus() {
    let nextHint = '';
    let nextSiteAction: typeof siteAction = null;
    try {
      if (tabId == null) throw new Error(MESSAGES.NO_ACTIVE_TAB);
      const tab = await browser.tabs.get(tabId);
      tabUrl = tab.url ?? '';
      // Without the tabs permission, protected pages can omit their URL entirely.
      const url = tabUrl ? new URL(tabUrl) : null;
      siteLabel = url ? (url.protocol === 'file:' ? 'Local file' : url.hostname || 'Current tab') : 'Browser page';
      const settings = await loadSettings({ strict: true });
      if (!settings.enabled) {
        nextSiteAction = 'enable';
        nextHint = 'Enable Hare to control playback.';
        throw new Error('Hare is turned off');
      }
      if (!url || !/^(https?|file):/.test(tabUrl)) {
        nextHint = 'Open a regular webpage with video or audio.';
        throw new Error('Hare cannot run on this browser page');
      }
      if (isBlacklisted(settings.blacklist, url.hostname)) {
        const remaining = removeExactSiteExclusions(settings.blacklist, url.hostname);
        nextSiteAction = isBlacklisted(remaining, url.hostname) ? 'settings' : 'include';
        nextHint = nextSiteAction === 'include'
          ? 'Use Hare on this site to restore playback controls, including embedded players.'
          : 'A broader domain or regular expression excludes this site. Edit Excluded sites in Settings to use Hare here.';
        throw new Error('This site is excluded');
      }
      if (url.hostname && /^https?:$/.test(url.protocol)) nextSiteAction = 'exclude';
      const frames = await getTabMedia(tabId);
      const result = aggregateStatus(frames.map(frame => frame.status));
      if (!result.hasVideos) {
        nextHint = frames.length ? 'Start a video, or enable audio control in Settings.' : 'Reload this tab to connect Hare. For local files, enable file access in extension details.';
        throw new Error('No media detected');
      }
      status = result;
      error = null;
    } catch (e) {
      status = null;
      error = e instanceof Error ? e.message : 'Could not connect to this tab';
    } finally {
      hint = nextHint;
      siteAction = nextSiteAction;
      loading = false;
    }
  }

  async function command(message: HareMessage, requestedSpeed?: number) {
    if (busy || tabId == null || !status) return;
    busy = true;
    try {
      await statusRequest;
      const frames = (await getTabMedia(tabId)).filter(frame => frame.status.videoCount > 0);
      const results = await Promise.allSettled(frames.map(frame => sendToFrame(tabId!, frame.frameId, message)));
      if (!results.length || results.some(result => result.status === 'rejected' || !(result.value as { success?: boolean })?.success)) {
        showToast('Some media could not be updated. Reload the tab and try again.');
      }
      await loadStatus();
      if (requestedSpeed != null && status && (status.mixedSpeeds || Math.abs(status.currentSpeed - requestedSpeed) > 0.001)) {
        showToast('This player limited or blocked the requested speed.');
      }
    } catch {
      showToast('Could not update playback. Reload the tab and try again.');
    } finally { busy = false; }
  }

  function setSpeed(speed: number) {
    if (!Number.isFinite(speed)) return;
    const value = Math.round(Math.max(SPEED.MIN, Math.min(SPEED.MAX, speed)) * 100) / 100;
    void command({ type: 'SET_SPEED', payload: value }, value);
  }

  function resetSpeed() { void command({ type: 'RESET_SPEED' }, SPEED.DEFAULT); }
  function openOptions() { void browser.runtime.openOptionsPage(); }

  async function changeSiteAccess() {
    if (busy || !siteAction) return;
    const action = siteAction;
    const actionUrl = tabUrl;
    if (action === 'settings') { openOptions(); return; }
    busy = true;
    try {
      await statusRequest;
      // Read immediately before writing so unrelated settings changed elsewhere survive.
      const settings = await loadSettings({ strict: true });
      if (action === 'enable') settings.enabled = true;
      else {
        const tab = await browser.tabs.get(tabId!);
        const url = new URL(tab.url ?? '');
        if (url.href !== actionUrl) throw new Error('The tab navigated. Try again on the new page.');
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        if (!host || !/^https?:$/.test(url.protocol)) throw new Error('This page cannot be excluded by domain.');
        if (action === 'include') {
          const remaining = removeExactSiteExclusions(settings.blacklist, host);
          if (isBlacklisted(remaining, host)) throw new Error('A broader rule excludes this site. Edit Excluded sites in Settings.');
          settings.blacklist = remaining;
        } else if (!isBlacklisted(settings.blacklist, host)) {
          settings.blacklist += `${settings.blacklist && !settings.blacklist.endsWith('\n') ? '\n' : ''}${host}`;
        }
      }
      await saveSettings(settings);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save site settings. Try again.');
    } finally {
      await loadStatus();
      busy = false;
    }
  }

  onMount(() => {
    void (async () => {
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id ?? null;
        await loadStatus();
      } catch { error = 'Could not find the active tab'; loading = false; }
    })();
    const interval = setInterval(() => { if (!busy) void loadStatus(); }, 1500);
    return () => clearInterval(interval);
  });
</script>

<div class="popup">
  <div class="accent-line"></div>

  <header>
    <div class="header-content">
      <h1>Hare</h1>
      <button class="settings-link" onclick={openOptions} aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" class="settings-icon" aria-hidden="true">
          <path d="M4 7h16M4 17h16M8 4v6M16 14v6"></path>
        </svg>
        Settings
      </button>
    </div>
    <div class="tab-context">
      <span class="site-label" title={siteLabel}>{siteLabel}</span>
      {#if status}
        <div class="status-indicator">
          <div class="status-dot"></div>
          <span class="status-text"
            >{status.videoCount} {status.videoCount === 1 ? 'player' : 'players'}</span
          >
        </div>
      {/if}
    </div>
  </header>

  <main class:compact={syncExpanded}>
    {#if loading}
      <div class="loading" role="status">Connecting to this tab…</div>
    {:else if error}
      <div class="no-videos">
        <p>{error}</p>
        <p class="hint">{hint}</p>
        {#if !siteAction || siteAction === 'exclude'}
          <button class="settings-btn" disabled={busy} onclick={loadStatus}>Try again</button>
        {/if}
      </div>
    {:else if status}
      <div class="speed-section">
        <div class="speed-label">Playback speed</div>

        {#if !syncExpanded}
        <div class="speed-display" aria-live="polite">
          {status.currentSpeed.toFixed(2)}<span class="speed-unit">x</span>
        </div>

        <div class="speed-presets" role="group" aria-label="Speed presets">
          {#each speedPresets as preset}
            <button
              class="preset"
              data-speed-action
              aria-label={`Set speed to ${preset}x`}
              aria-pressed={!status.mixedSpeeds && Math.abs(status.currentSpeed - preset) < 0.001}
              disabled={busy}
              onclick={() => setSpeed(preset)}
            >{preset}<span aria-hidden="true">×</span></button>
          {/each}
        </div>

        {/if}

        <SpeedControl
          speed={status.currentSpeed}
          onSpeedChange={setSpeed}
          onReset={resetSpeed}
          disabled={busy}
        />
        {#if !syncExpanded}<p class="input-hint">Custom speed: type a value and press Enter</p>{/if}
        {#if status.mixedSpeeds}
          <p class="hint">Media have different speeds. Changes apply to all media in this tab.</p>
        {:else if status.videoCount > 1}
          <p class="hint">Changes apply to all {status.videoCount} players in this tab.</p>
        {/if}
        {#if !syncExpanded}
          <button class="settings-btn controller-toggle" disabled={busy} onclick={() => command({ type: 'TOGGLE_DISPLAY' })}>Show / hide controller</button>
        {/if}
      </div>
    {/if}
    {#if siteAction && (!syncExpanded || siteAction !== 'exclude')}
      <div class="site-controls">
        <button class="settings-btn" disabled={busy} onclick={changeSiteAccess}
          title={siteAction === 'exclude' ? `Exclude ${siteLabel} and its subdomains, including embedded players` : undefined}>
          {siteAction === 'enable' ? 'Enable Hare' : siteAction === 'include' ? 'Use Hare on this site' : siteAction === 'exclude' ? 'Exclude this site' : 'Edit site exclusions'}
        </button>
      </div>
    {/if}
  </main>

  <SyncMode onExpandedChange={(expanded) => { syncExpanded = expanded; }} />

  {#if toast}
    <div class="toast" role="alert">{toast}</div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
    overflow: hidden;
  }

  .popup {
    width: 360px;
    max-height: 600px;
    overflow-y: auto;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    background: linear-gradient(165deg, #1e1e1e 0%, #1a1a1a 100%);
    color: #f0f0f0;
    position: relative;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  .popup::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-image: linear-gradient(
        rgba(255, 255, 255, 0.02) 1px,
        transparent 1px
      ),
      linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 20px 20px;
    pointer-events: none;
    opacity: 0.5;
  }

  .accent-line {
    height: 2px;
    background: linear-gradient(90deg, #3b82f6, #60a5fa, #93c5fd);
    position: relative;
    z-index: 1;
  }

  header {
    padding: 16px 20px 12px;
    position: relative;
    z-index: 1;
  }

  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .settings-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 8px;
    margin-right: -8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #b9c5d6;
    font-size: 12px;
    cursor: pointer;
  }

  .settings-link:hover { color: #f0f0f0; background: #ffffff0d; }
  .tab-context { display: flex; align-items: center; gap: 12px; margin-top: 14px; }
  .site-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #b9c5d6; font-size: 12px; }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #60a5fa, #93c5fd);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #999;
    flex-shrink: 0;
    font-weight: 600;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
  }


  main {
    padding: 24px 20px 12px;
    border-top: 1px solid #ffffff0d;
    position: relative;
    z-index: 1;
  }

  .loading {
    text-align: center;
    color: #999;
    padding: 32px 20px;
    font-size: 14px;
  }

  .no-videos {
    text-align: center;
    padding: 32px 20px;
  }

  .no-videos p {
    margin: 0 0 8px;
    color: #999;
    font-size: 14px;
  }

  .hint {
    font-size: 12px;
    color: #aaa;
    line-height: 1.6;
    margin: 0;
  }

  .speed-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
  }

  .speed-label {
    font-size: 11px;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
  }

  .speed-display {
    font-size: 48px;
    font-weight: 700;
    font-family: ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace;
    font-variant-numeric: tabular-nums;
    color: #f0f0f0;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .speed-unit {
    font-size: 32px;
    color: #999;
    margin-left: 4px;
  }

  .speed-presets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 100%; margin-top: 6px; }
  .preset { min-height: 36px; padding: 6px 0; border: 1px solid #ffffff24; border-radius: 6px; background: #ffffff06; color: #c8d0dc; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; cursor: pointer; }
  .preset span { margin-left: 1px; font-size: 11px; }
  .preset:hover:not(:disabled) { background: #60a5fa1a; border-color: #60a5fa80; }
  .preset[aria-pressed="true"] { background: #93c5fd; border-color: #93c5fd; color: #152236; }
  .input-hint { color: #a2abba; font-size: 11px; margin: -4px 0 2px; }

  .settings-btn {
    width: 100%;
    padding: 10px 16px;
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.1);
    color: #f0f0f0;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .settings-btn:hover {
    background: rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 0.5);
  }

  .settings-btn:focus-visible {
    outline: 2px solid rgba(59, 130, 246, 0.8);
    outline-offset: 2px;
  }

  .settings-icon {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  main.compact { padding-top: 12px; padding-bottom: 20px; }
  .compact .speed-section { gap: 8px; }

  .controller-toggle { background: #ffffff06; border-color: #ffffff24; border-radius: 6px; color: #b9c5d6; font-size: 12px; }
  .site-controls { margin-top: 14px; }
  .site-controls .settings-btn { font-size: 12px; }

  .toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    background: rgba(239, 68, 68, 0.95);
    backdrop-filter: blur(8px);
    color: #fff;
    border-radius: 4px;
    border: 1px solid rgba(239, 68, 68, 0.3);
    font-size: 13px;
    font-weight: 500;
    z-index: 100;
    width: calc(100% - 32px);
    box-sizing: border-box;
    animation: toastSlideIn 0.2s ease;
  }

  @keyframes toastSlideIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

</style>
