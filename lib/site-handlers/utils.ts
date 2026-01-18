/**
 * Check if the site's hostname matches any provided domains or their subdomains.
 */
export function matchesDomains(domains: readonly string[]): boolean {
    const hostname = location.hostname;
    return domains.some(
        (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
}
