export interface MatchLink { matchId: string; leagueId?: string; slug?: string; }
export const validId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Verified white-label host → league path. This is a trust registry, not an API host.
 * Add installations only after verifying their public CricClubs scorecard links.
 * Requests always go to the fixed CricClubs API, never to a supplied hostname.
 */
const WHITE_LABEL_PATHS: Readonly<Record<string, string>> = {
    'carolinacricket.org': 'CarolinaCricket',
    'www.carolinacricket.org': 'CarolinaCricket',
};

export function parseMatchUrl(input: string): MatchLink {
    let url: URL;
    try { url = new URL(input.trim()); } catch { throw new Error('Paste a complete CricClubs match URL.'); }
    const official = ['cricclubs.com', 'www.cricclubs.com', 'app.cricclubs.com'].includes(url.hostname);
    const trustedPath = Object.hasOwn(WHITE_LABEL_PATHS, url.hostname) ? WHITE_LABEL_PATHS[url.hostname] : undefined;
    const whiteLabel = trustedPath && new RegExp(`^/${trustedPath}/(?:fullScorecard|viewScorecard)\\.do$`).test(url.pathname);
    if ((!official && !whiteLabel)
        || url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new Error('Use an HTTPS match link from CricClubs or a verified CricClubs league website.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const results = parts.indexOf('results');
    const matchId = results >= 0 ? parts[results + 1] : url.searchParams.get('matchId');
    const leagueId = url.searchParams.get('leagueId') || url.searchParams.get('clubId') || undefined;
    if (!matchId || !validId(matchId) || (leagueId && !validId(leagueId))) throw new Error('This link does not contain a valid match ID.');
    const slug = results === 1 && validId(parts[0]) ? parts[0] : undefined;
    return { matchId, leagueId, slug };
}
