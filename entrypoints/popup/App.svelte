<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import SpeedControl from "../../components/SpeedControl.svelte";
  import type { StatusResponse, HareMessage } from "../../lib/types";
  import { SPEED, UI } from "../../lib/constants";
  import { logger } from "../../lib/logger";
  import { MESSAGES } from "../../lib/messages";

  let status: StatusResponse | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let toast: string | null = $state(null);
  let toastTimeout: ReturnType<typeof setTimeout> | null = null;

  onDestroy(() => {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
  });

  function showToast(message: string, duration = UI.TOAST_DURATION_MS) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast = message;
    toastTimeout = setTimeout(() => {
      toast = null;
      toastTimeout = null;
    }, duration);
  }

  /**
   * Dispatches commands to the content script of the currently active tab.
   * Sends to all frames and aggregates results for GET_STATUS.
   */
  async function sendMessage(message: HareMessage): Promise<unknown> {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) throw new Error(MESSAGES.NO_ACTIVE_TAB);
    return browser.tabs.sendMessage(tab.id, message);
  }

  /**
   * Sends a message to a specific frame within a tab.
   */
  async function sendToFrame(
    tabId: number,
    frameId: number,
    message: HareMessage,
  ): Promise<StatusResponse | null> {
    try {
      return (await browser.tabs.sendMessage(tabId, message, {
        frameId,
      })) as StatusResponse;
    } catch (error) {
      // Expected: Frame without content script (cross-origin, sandboxed, about:blank)
      if (
        error instanceof Error &&
        (error.message.includes("Could not establish connection") ||
          error.message.includes("Receiving end does not exist"))
      ) {
        return null; // Expected error
      }
      // Unexpected error - log for debugging
      logger.warn("Unexpected error querying frame:", frameId, error);
      return null;
    }
  }

  /**
   * Aggregates status from all frames in the active tab.
   * Videos can be in iframes (common on YouTube), so querying only the top frame
   * would miss them and show 0 detected.
   */
  async function loadStatus() {
    try {
      loading = true;
      error = null;

      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error(MESSAGES.NO_ACTIVE_TAB);
      }

      // Get all frames in the tab
      const frames = await browser.webNavigation.getAllFrames({
        tabId: tab.id,
      });
      if (!frames || frames.length === 0) {
        throw new Error(MESSAGES.NO_VIDEOS_FOUND);
      }

      // Query all frames in parallel
      const responses = await Promise.all(
        frames.map((frame) =>
          sendToFrame(tab.id!, frame.frameId, { type: "GET_STATUS" }),
        ),
      );

      // Aggregate results from all frames
      let totalVideoCount = 0;
      let latestSpeed: number = SPEED.DEFAULT;
      let hasAnyVideos = false;

      for (const response of responses) {
        if (response && response.videoCount > 0) {
          totalVideoCount += response.videoCount;
          latestSpeed = response.currentSpeed;
          hasAnyVideos = true;
        }
      }

      if (!hasAnyVideos) {
        throw new Error(MESSAGES.NO_VIDEOS_FOUND);
      }

      status = {
        hasVideos: true,
        currentSpeed: latestSpeed,
        videoCount: totalVideoCount,
      };
    } catch (e) {
      error = MESSAGES.NO_VIDEOS_FOUND;
      status = null;
    } finally {
      loading = false;
    }
  }

  async function setSpeed(speed: number) {
    if (!status) return;

    const clampedSpeed = Math.max(SPEED.MIN, Math.min(SPEED.MAX, speed));

    try {
      await sendMessage({ type: "SET_SPEED", payload: clampedSpeed });
      status = { ...status, currentSpeed: clampedSpeed };
    } catch (e) {
      logger.error(MESSAGES.FAILED_TO_SET_SPEED, e);
      showToast(MESSAGES.FAILED_TO_SET_SPEED);
    }
  }

  async function resetSpeed() {
    if (!status) return;

    try {
      await sendMessage({ type: "RESET_SPEED" });
      status = { ...status, currentSpeed: SPEED.DEFAULT };
    } catch (e) {
      logger.error(MESSAGES.FAILED_TO_RESET_SPEED, e);
      showToast(MESSAGES.FAILED_TO_RESET_SPEED);
    }
  }

  function openOptions() {
    browser.runtime.openOptionsPage();
  }

  onMount(() => {
    loadStatus();
  });
</script>

<div class="popup">
  <div class="accent-line"></div>

  <header>
    <div class="header-content">
      <h1>Hare</h1>
      {#if status}
        <div class="status-indicator">
          <div class="status-dot"></div>
          <span class="status-text"
            >{MESSAGES.VIDEO_COUNT(status.videoCount)}</span
          >
        </div>
      {/if}
    </div>
  </header>

  <main>
    {#if loading}
      <div class="loading">Loading...</div>
    {:else if error}
      <div class="no-videos">
        <p>{error}</p>
        <p class="hint">{MESSAGES.NAVIGATE_TO_VIDEO_HINT}</p>
      </div>
    {:else if status}
      <div class="speed-section">
        <div class="speed-label">Playback Rate</div>

        <div class="speed-display">
          {status.currentSpeed.toFixed(2)}<span class="speed-unit">x</span>
        </div>

        <SpeedControl
          speed={status.currentSpeed}
          onSpeedChange={setSpeed}
          onReset={resetSpeed}
        />
      </div>
    {/if}
  </main>

  <footer>
    <button class="settings-btn" onclick={openOptions}>
      <svg viewBox="0 0 24 24" class="settings-icon">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M12 1v6m0 6v6M1 12h6m6 0h6"></path>
      </svg>
      Settings
    </button>
  </footer>

  {#if toast}
    <div class="toast">{toast}</div>
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
    width: 320px;
    font-family:
      "DM Sans",
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    background: linear-gradient(165deg, #1e1e1e 0%, #1a1a1a 100%);
    color: #f0f0f0;
    position: relative;
    overflow: hidden;
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
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
    animation: statusPulse 2s ease-in-out infinite;
  }

  @keyframes statusPulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(0.95);
    }
  }

  main {
    padding: 20px;
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
    color: #666;
  }

  .speed-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  footer {
    padding: 12px 16px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    position: relative;
    z-index: 1;
  }

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
