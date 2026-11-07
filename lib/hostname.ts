/** The pages Hare runs on: the content script's matches and the extension's host permissions. */
export const HARE_MATCHES = ['http://*/*', 'https://*/*', 'file:///*'];

/** Whether `url` is a page that HARE_MATCHES covers. */
export function isHarePage(url: string): boolean {
  return /^(https?|file):/.test(url);
}

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function matchesDomain(hostname: string, domain: string): boolean {
  const host = normalizeHost(hostname);
  return host === domain || host.endsWith('.' + domain);
}
