<script lang="ts">
  import { onMount } from "svelte";
  import SpeedControl from "../../components/SpeedControl.svelte";
  import SyncMode from "../../components/SyncMode.svelte";
  import logo from "../../assets/logo.svg";
  import { clampSpeed, sameSpeed } from "../../lib/speed";
  import { isHarePage } from "../../lib/hostname";
  import { loadSettings, saveSettings, isBlacklisted, includeSite } from "../../lib/settings/settings";
  import { getTabMedia, setTabSpeed } from "../../lib/messaging";
  import { exportToPlayer } from "../../lib/export/player-export";

  interface MediaSummary {
    videoCount: number;
    currentSpeed: number;
    mixedSpeeds: boolean;
  }

  function summarize(speeds: number[]): MediaSummary {
    const currentSpeed = speeds[0] ?? 1;
    return { videoCount: speeds.length, currentSpeed, mixedSpeeds: speeds.some(speed => !sameSpeed(speed, currentSpeed)) };
  }

  const TOAST_MS = 4000;
  let status: MediaSummary | null = $state(null);
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
  let siteAction: 'enable' | 'include' | 'settings' | null = $state(null);
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  function showToast(message: string) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast = message;
    toastTimeout = setTimeout(() => { toast = null; }, TOAST_MS);
  }

  function loadStatus(): Promise<void> {
    statusRequest ??= refreshStatus().finally(() => { statusRequest = null; });
    return statusRequest;
  }

  async function refreshStatus() {
    let nextHint = '';
    let nextSiteAction: typeof siteAction = null;
    try {
      if (tabId == null) throw new Error('No active tab');
      const tab = await browser.tabs.get(tabId);
      tabUrl = tab.url ?? '';
      // Without the tabs permission, protected pages can omit their URL entirely.
      const url = tabUrl ? new URL(tabUrl) : null;
      siteLabel = url ? (url.protocol === 'file:' ? 'Local file' : url.hostname || 'Current tab') : 'Browser page';
      const settings = await loadSettings();
      if (!settings.enabled) {
        nextSiteAction = 'enable';
        nextHint = 'Enable Hare to control playback.';
        throw new Error('Hare is turned off');
      }
      if (!url || !isHarePage(tabUrl)) {
        nextHint = 'Open a regular webpage with video or audio.';
        throw new Error('Hare cannot run on this browser page');
      }
      if (isBlacklisted(settings.blacklist, url.hostname)) {
        nextSiteAction = includeSite(settings.blacklist, url.hostname) === null ? 'settings' : 'include';
        nextHint = nextSiteAction === 'include'
          ? 'Use Hare on this site to restore playback controls, including embedded players.'
          : 'A broader domain or regular expression excludes this site. Edit Excluded sites in Settings to use Hare here.';
        throw new Error('This site is excluded');
      }
      const frames = await getTabMedia(tabId);
      const result = summarize(frames.flatMap(frame => frame.speeds));
      if (!result.videoCount) {
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

  async function setSpeed(requested: number) {
    if (busy || tabId == null || !status) return;
    const speed = clampSpeed(requested);
    busy = true;
    try {
      await statusRequest;
      if (!await setTabSpeed(tabId, speed)) {
        showToast('Some media could not be updated. Reload the tab and try again.');
      }
      await loadStatus();
      if (status && (status.mixedSpeeds || !sameSpeed(status.currentSpeed, speed))) {
        showToast('This player limited or blocked the requested speed.');
      }
    } catch {
      showToast('Could not update playback. Reload the tab and try again.');
    } finally { busy = false; }
  }

  async function openInPlayer() {
    if (busy || tabId == null) return;
    // Requested on first use, while the click still counts as a user gesture.
    if (!await browser.permissions.request({ permissions: ['downloads', 'downloads.open'] })) return;
    busy = true;
    try {
      if (await exportToPlayer(tabId) === 'saved') showToast('Saved hare.m3u to Downloads. Open it to play.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not open the video.');
    } finally { busy = false; }
  }
  function openOptions() { void browser.runtime.openOptionsPage(); }

  async function changeSiteAccess() {
    const action = siteAction;
    const actionUrl = tabUrl;
    if (action === 'settings') { openOptions(); return; }
    busy = true;
    try {
      await statusRequest;
      // Read immediately before writing so unrelated settings changed elsewhere survive.
      const settings = await loadSettings();
      if (action === 'enable') settings.enabled = true;
      else {
        const tab = await browser.tabs.get(tabId!);
        if (tab.url !== actionUrl) throw new Error('The tab navigated. Try again on the new page.');
        const remaining = includeSite(settings.blacklist, new URL(actionUrl).hostname);
        if (remaining === null) throw new Error('A broader rule excludes this site. Edit Excluded sites in Settings.');
        settings.blacklist = remaining;
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
  <header>
    <h1><img src={logo} alt="Hare" width="20" height="20" /></h1>
    <span class="site-label" title={siteLabel}>{siteLabel}</span>
    {#if status}
      <span class="player-count">{status.videoCount} {status.videoCount === 1 ? 'player' : 'players'}</span>
    {/if}
    <button class="settings-link" onclick={openOptions} aria-label="Settings" title="Settings">
      <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
        <path d="M4 7h16M4 17h16M8 4v6M16 14v6"></path>
      </svg>
    </button>
  </header>

  <main class:compact={syncExpanded}>
    {#if loading}
      <p class="hint" role="status">Connecting to this tab…</p>
    {:else if error}
      <p class="notice">{error}</p>
      <p class="hint">{hint}</p>
      {#if !siteAction}
        <button class="btn primary" disabled={busy} onclick={loadStatus}>Try again</button>
      {/if}
    {:else if status}
      {#if !syncExpanded}
        <div class="speed-display" aria-live="polite">
          {status.currentSpeed.toFixed(2)}<span class="speed-unit">×</span>
        </div>
      {/if}

      <SpeedControl
        speed={status.currentSpeed}
        mixedSpeeds={status.mixedSpeeds}
        compact={syncExpanded}
        disabled={busy}
        onSpeedChange={setSpeed}
      />
      {#if status.mixedSpeeds}
        <p class="hint">Media have different speeds. Changes apply to all media in this tab.</p>
      {:else if status.videoCount > 1}
        <p class="hint">Changes apply to all {status.videoCount} players in this tab.</p>
      {/if}
    {/if}
    {#if siteAction}
      <button class="btn primary" disabled={busy} onclick={changeSiteAccess}>
        {siteAction === 'enable' ? 'Enable Hare' : siteAction === 'include' ? 'Use Hare on this site' : 'Edit site exclusions'}
      </button>
    {/if}
  </main>

  <SyncMode onExpandedChange={(expanded) => { syncExpanded = expanded; }} />

  {#if status && !syncExpanded}
    <button class="row-btn" disabled={busy} onclick={openInPlayer}>
      Open in video player
      <svg viewBox="0 0 24 24" class="icon" aria-hidden="true">
        <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"></path>
      </svg>
    </button>
  {/if}

  {#if toast}
    <div class="toast" role="alert">{toast}</div>
  {/if}
</div>

<style>
  :global(body) { overflow: hidden; }

  .popup {
    width: 360px;
    max-height: 600px;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.75rem 0.75rem 0.75rem 1.25rem;
    border-bottom: 1px solid var(--color-divider);
  }

  h1 { display: flex; margin: 0; }
  .site-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8125rem; font-weight: 500; }
  .player-count { flex-shrink: 0; font-size: 0.75rem; color: var(--color-text-muted); }

  .settings-link {
    display: grid;
    place-items: center;
    width: 2rem;
    height: 2rem;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--color-text-secondary);
  }
  .settings-link:hover { color: var(--color-text); background: var(--color-hover); }

  main {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
    padding: 1.25rem;
  }
  main.compact { padding-block: 0.75rem; }

  .speed-display {
    font: 600 3.5rem/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.04em;
  }
  .speed-unit { margin-left: 0.125em; font-size: 0.5em; font-weight: 400; letter-spacing: 0; color: var(--color-text-muted); }

  .notice { margin: 0; font-weight: 600; text-wrap: balance; }
  .hint { margin: 0; font-size: 0.75rem; color: var(--color-text-muted); }

  main > .btn { align-self: start; }
  .row-btn { border-top: 1px solid var(--color-divider); }

  .toast {
    position: fixed;
    bottom: 0.75rem;
    left: 0.75rem;
    right: 0.75rem;
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius);
    background: var(--color-danger);
    color: #fff;
    font-size: 0.8125rem;
    font-weight: 500;
    z-index: 100;
  }
</style>
