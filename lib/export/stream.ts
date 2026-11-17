/**
 * HLS and DASH manifests. Players built on MediaSource only expose blob URLs,
 * so the manifests they request are the links a desktop player can open.
 */
export const MANIFEST_URL_PATTERNS = ['*://*/*.m3u8*', '*://*/*.mpd*'];
const MANIFEST_URL = /\.(m3u8|mpd)(\?|$)/;

export interface StreamInfo {
  src: string | null;
  page: string;
  encrypted: boolean;
  time: number;
  manifests: string[];
}

/** What a desktop player needs to open `media`, read in the page that plays it. */
export function describeStream(media: HTMLMediaElement): StreamInfo | null {
  // Calls and screen shares have no link to hand over.
  if (media.srcObject instanceof MediaStream) return null;
  return {
    src: /^(https?|file):/.test(media.currentSrc) ? media.currentSrc : null,
    page: location.href,
    encrypted: media.mediaKeys !== null,
    time: Number.isFinite(media.duration) ? media.currentTime : 0,
    // Covers players that started before Hare's background could see their requests.
    manifests: performance.getEntriesByType('resource').map(entry => entry.name).filter(name => MANIFEST_URL.test(name)),
  };
}
