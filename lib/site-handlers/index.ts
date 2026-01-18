import type { SiteHandler } from '../types';
import { BaseSiteHandler } from './base';
import { YouTubeHandler } from './youtube';
import { NetflixHandler } from './netflix';
import { AmazonHandler } from './amazon';
import { DisneyHandler } from './disney';
import { TwitchHandler } from './twitch';
import { HBOMaxHandler } from './hbomax';
import { CrunchyrollHandler } from './crunchyroll';
import { VimeoHandler } from './vimeo';
import { RedditHandler } from './reddit';
import { FacebookHandler } from './facebook';
import { TwitterHandler } from './twitter';
import { TikTokHandler } from './tiktok';
import { DailymotionHandler } from './dailymotion';

/**
 * Site handlers are evaluated in order. The first handler whose `matches()` method
 * returns true will be used. BaseSiteHandler MUST be last as it matches all sites
 * (returns true for all domains) and serves as a catch-all fallback.
 *
 * CRITICAL: Do not reorder without understanding this constraint.
 */
const handlers: SiteHandler[] = [
  new YouTubeHandler(),
  new NetflixHandler(),
  new AmazonHandler(),
  new DisneyHandler(),
  new TwitchHandler(),
  new HBOMaxHandler(),
  new CrunchyrollHandler(),
  new VimeoHandler(),
  new DailymotionHandler(),
  new RedditHandler(),
  new FacebookHandler(),
  new TwitterHandler(),
  new TikTokHandler(),
  new BaseSiteHandler(), // MUST be last - catch-all for all domains
];

/**
 * Returns the first matching site handler for the current domain.
 * BaseSiteHandler at the end of the array ensures a handler is always found.
 */
export function getSiteHandler(): SiteHandler {
  for (const handler of handlers) {
    if (handler.matches()) return handler;
  }
  // Unreachable: BaseSiteHandler always matches
  throw new Error('No site handler matched (this should never happen).');
}
