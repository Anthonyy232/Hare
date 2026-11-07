import { browser, type Browser } from 'wxt/browser';
import type { HareMessage, Replies } from '../messages';
import { SyncCoordinator } from './coordinator';
import { MpvClient } from './mpv';
import { createTransport, syncCandidates } from './transport';
import { KEEPALIVE_PORT, MPV_TAB_ID } from './types';

/**
 * Sync Mode's background side. Registers its browser listeners when created, so call it
 * synchronously while the background worker starts.
 */
export function startSyncService() {
  const mpv = new MpvClient({
    onEvent: event => { void coordinator.handleSyncEvent(MPV_TAB_ID, event); },
    onFileChanged: () => { void coordinator.stop('mpv opened another file'); },
  });
  const coordinator = new SyncCoordinator(createTransport(mpv));

  browser.runtime.onConnect.addListener(port => {
    if (port.name !== KEEPALIVE_PORT) return;
    // The open port is what keeps the worker alive; its pings need no reply. Reading lastError
    // marks a disconnect as handled so Chrome doesn't log it.
    port.onMessage.addListener(() => {});
    port.onDisconnect.addListener(() => { void browser.runtime.lastError; });
  });

  browser.tabs.onRemoved.addListener(tabId => {
    void coordinator.ready.then(() => coordinator.handleTabRemoved(tabId));
  });

  /** Replies to sync's messages; null for messages that aren't sync's. */
  async function handle(message: HareMessage, sender: Browser.runtime.MessageSender): Promise<Replies[keyof Replies] | null> {
    await coordinator.ready;
    switch (message.type) {
      case 'SYNC_EVENT':
        if (sender.tab?.id != null) await coordinator.handleSyncEvent(sender.tab.id, message.payload, sender.frameId);
        return { success: true };
      case 'GET_SYNC_CANDIDATES': return syncCandidates(mpv);
      case 'GET_MPV_CANDIDATE': return mpv.candidate();
      case 'START_SYNC':
        await coordinator.start(message.payload.tabIdA, message.payload.tabIdB);
        return { success: true };
      case 'STOP_SYNC': {
        // A late stop from a removed or nonparticipating content frame must not end a new pair.
        const fromExtensionPage = sender.url?.startsWith(browser.runtime.getURL('/')) === true;
        if (!fromExtensionPage && sender.tab?.id != null && !coordinator.hasEndpoint(sender.tab.id, sender.frameId)) return { success: true };
        await coordinator.stop('stop requested');
        return { success: true };
      }
      case 'SET_NUDGE_STEP':
        await coordinator.setNudgeStep(message.payload);
        return { success: true };
      case 'NUDGE_OFFSET':
        coordinator.nudgeOffset(message.payload);
        return { success: true };
      case 'GET_SYNC_STATUS': return coordinator.getStatus();
      default: return null;
    }
  }

  return { handle };
}
