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
];

const fallback = new BaseSiteHandler();

export function getSiteHandler(): SiteHandler {
  return handlers.find(handler => handler.matches()) ?? fallback;
}
