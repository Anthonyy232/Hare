import type { SiteHandler } from './types';

interface SiteRule {
  domains: readonly string[];
  /** Player containers in priority order; the first match wins. */
  containers: readonly string[];
  /** Previews, ads, and decorative videos that should not get a controller. */
  ignore?: string;
  minWidth: number;
  minHeight: number;
  ignoreIf?: (video: HTMLVideoElement) => boolean;
  /** Mount point when no container matches. Defaults to the parent element. */
  fallback?: (video: HTMLVideoElement) => Element | null;
}

const STREAMING = { minWidth: 300, minHeight: 170 };
const SOCIAL = { minWidth: 200, minHeight: 150 };

const RULES: readonly SiteRule[] = [
  {
    domains: ['youtube.com', 'youtu.be'],
    containers: ['.html5-video-player', '.html5-video-container'],
    ignore: '.ytp-ad-player-overlay, .ytp-ad-module, ytd-shorts, ytd-reel-video-renderer, ytmusic-player-bar, .ytmusic-player-bar, #channel-header-container, #video-preview, ytd-video-preview',
    minWidth: 100, minHeight: 100,
    fallback: video => video.parentElement?.parentElement ?? null,
  },
  {
    domains: ['netflix.com'],
    containers: ['.watch-video--player-view', '.NFPlayer'],
    ignore: '.billboard-row, .jawBone, [data-uia="billboard"], [data-uia="hero-billboard"], video.preview-video, .moreLikeThis, [data-uia="more-like-this"], .title-card, .slider-item',
    ...STREAMING,
  },
  {
    domains: [
      'primevideo.com', 'amazon.com', 'amazon.co.uk', 'amazon.de',
      'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.co.jp',
      'amazon.in', 'amazon.com.br', 'amazon.com.mx', 'amazon.com.au',
      'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.sg',
      'amazon.ae', 'amazon.sa', 'amazon.eg', 'amazon.ca',
    ],
    containers: [],
    ignore: '.a-image-wrapper, .imageBlock',
    minWidth: 200, minHeight: 100,
    // `.vjs-tech` marks the video itself, so its parent is the player.
    fallback: video => video.closest('.vjs-tech')?.parentElement
      ?? video.closest('.webPlayerContainer') ?? video.parentElement,
  },
  {
    domains: ['disneyplus.com', 'hulu.com', 'hotstar.com'],
    containers: [
      '[data-testid="btm-media-client-wrapper"]', // Disney+
      '.Player__container', // Hulu
      '.player-base', // Hotstar
      '[class*="player"]', '[class*="Player"]',
    ],
    ignore: '[data-testid="preview-player"], .background-video, [class*="background"]',
    ...SOCIAL,
  },
  {
    domains: ['twitch.tv'],
    containers: ['[data-a-target="video-player"]', '.clips-player', '.video-player__container'],
    ignore: '[data-a-target="preview-card-image-link"], .preview-card-thumbnail, .channel-status-indicator--offline',
    ...SOCIAL,
  },
  {
    domains: ['max.com', 'hbomax.com'],
    containers: ['[data-testid="player"]', '.VideoPlayer', '[class*="PlayerContainer"]'],
    ignore: '[data-testid="trailer-player"], .HeroPlayer, [class*="Preview"]',
    ...STREAMING,
  },
  {
    domains: ['crunchyroll.com'],
    containers: ['#vilos', '[data-testid="vilos-player"]', '.video-player', '.erc-video-player'],
    ignore: '[data-testid="trailer-player"], .hero-carousel, [class*="Hero"], .browse-card',
    ...STREAMING,
  },
  {
    domains: ['vimeo.com'],
    containers: ['.vp-video', '.player-container', '.player'],
    ignore: '.vp-preview, .iris_thumbnail',
    ...SOCIAL,
  },
  {
    domains: ['dailymotion.com'],
    containers: ['#player-wrapper', '.dmp_Player', '.video-container'],
    ignore: '.sidebar, .video__suggestion, .ad-container, [class*="ad-"]',
    ...SOCIAL,
  },
  {
    domains: ['reddit.com', 'redd.it'],
    containers: ['[data-testid="video-player"]', 'shreddit-player', '.reddit-video-player-root'],
    ignore: '[data-collapsed="true"], [data-testid="award-animations"]',
    minWidth: 300, minHeight: 200,
    ignoreIf: video => video.muted && video.offsetWidth < 400,
  },
  {
    domains: ['facebook.com', 'fb.com', 'fb.watch'],
    containers: ['[data-pagelet="WatchPermalinkVideo"]', '[data-video-id]', '[data-pagelet*="Reels"]', '[role="presentation"]'],
    ignore: '[data-pagelet="Stories"], [aria-label*="Stories"], [data-pagelet="ProfilePhoto"], [data-ad-preview], [data-pagelet*="AdPreferences"]',
    minWidth: 100, minHeight: 100,
    // Small, often muted feed previews.
    ignoreIf: video => video.muted && video.offsetWidth < 300,
  },
  {
    domains: ['twitter.com', 'x.com'],
    containers: ['[data-testid="videoPlayer"]', '[data-testid="tweetPhoto"]', '[data-testid="videoComponent"]'],
    ignore: '[data-testid="UserProfileHeader_Items"]',
    minWidth: 150, minHeight: 100,
    ignoreIf: video => (video.muted && video.offsetWidth < 300)
      || (!!video.closest('[data-testid="placementTracking"]') && video.offsetWidth < 400),
  },
  {
    domains: ['tiktok.com'],
    containers: ['[data-e2e="video-player"]', '[data-e2e="browse-video"]', '.tiktok-player'],
    ignore: '[data-e2e="recommend-list-item"], [data-e2e="user-card"]',
    minWidth: 200, minHeight: 300,
    ignoreIf: video => video.muted && video.loop && video.offsetHeight < 400,
  },
];

function fromRule(rule: SiteRule): SiteHandler {
  return {
    findContainer(video) {
      for (const selector of rule.containers) {
        const container = video.closest(selector);
        if (container) return container;
      }
      return rule.fallback ? rule.fallback(video) : video.parentElement;
    },
    shouldIgnoreVideo(video) {
      return (!!rule.ignore && !!video.closest(rule.ignore))
        || video.offsetWidth < rule.minWidth || video.offsetHeight < rule.minHeight
        || !!rule.ignoreIf?.(video);
    },
  };
}

/** Catch-all for sites without custom rules: common player class names, then a positioned parent. */
export const genericHandler: SiteHandler = {
  findContainer(video) {
    const container = video.closest(
      '.video-js, .vjs-tech, .plyr, .mejs-container,' +
      '.flowplayer, .jw-wrapper, .jwplayer, .theoplayer-container,' +
      '.bitmovinplayer-container, .video-container, .player-container,' +
      '.player-wrapper, .video-player, .html5-video-player,' +
      '[data-player], [data-testid*="player"], [data-testid*="video"]'
    );
    if (container) return container;
    const parent = video.parentElement;
    return parent && getComputedStyle(parent).position !== 'static' ? parent : null;
  },
  shouldIgnoreVideo: () => false,
};

export function matchesDomains(hostname: string, domains: readonly string[]): boolean {
  return domains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
}

export function getSiteHandler(hostname = location.hostname): SiteHandler {
  const rule = RULES.find(rule => matchesDomains(hostname, rule.domains));
  return rule ? fromRule(rule) : genericHandler;
}
