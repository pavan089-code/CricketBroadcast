export interface MatchLink { matchId: string; leagueId?: string; slug?: string; }
export const validId = (value: string): boolean => /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function parseMatchUrl(input: string): MatchLink {
    let url: URL;
    try { url = new URL(input.trim()); } catch { throw new Error('Paste a complete CricClubs match URL.'); }
    if (!['cricclubs.com', 'www.cricclubs.com', 'app.cricclubs.com'].includes(url.hostname)
        || url.protocol !== 'https:' || url.username || url.password || url.port) {
        throw new Error('Use an HTTPS match link from cricclubs.com.');
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const results = parts.indexOf('results');
    const matchId = results >= 0 ? parts[results + 1] : url.searchParams.get('matchId');
    const leagueId = url.searchParams.get('leagueId') || url.searchParams.get('clubId') || undefined;
    if (!matchId || !validId(matchId) || (leagueId && !validId(leagueId))) throw new Error('This link does not contain a valid match ID.');
    const slug = results === 1 && validId(parts[0]) ? parts[0] : undefined;
    return { matchId, leagueId, slug };
}
