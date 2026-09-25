import { parseMatchUrl } from '../../shared/matchUrl';
import { LEAGUE_ALIASES } from '../../shared/leagueAliases';

/** Fetch only the canonical public match page; never proxy a caller-controlled host. */
export async function handleResolve(request: Request): Promise<Response> {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
        status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    let link;
    try { link = parseMatchUrl(new URL(request.url).searchParams.get('url') || ''); }
    catch (error) { return json({ error: (error as Error).message }, 400); }
    if (link.leagueId) return json(link);
    const slug = link.slug?.toLowerCase();
    const knownLeague = slug && Object.hasOwn(LEAGUE_ALIASES, slug) ? LEAGUE_ALIASES[slug] : undefined;
    if (knownLeague) return json({ ...link, leagueId: knownLeague });
    if (link.slug) {
        try {
            const response = await fetch(`https://cricclubs.com/${encodeURIComponent(link.slug)}/results/${encodeURIComponent(link.matchId)}`, {
                redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html' },
            });
            if (response.ok) {
                const html = (await response.text()).slice(0, 2_000_000).replace(/\\"/g, '"');
                const ids = [...html.matchAll(/"(?:leagueId|encryptedClubId)"\s*:\s*"([A-Za-z0-9_-]{1,128})"/g)].map(match => match[1]);
                const unique = [...new Set(ids)];
                if (unique.length === 1) return json({ ...link, leagueId: unique[0] });
            }
        } catch { /* Manual fallback remains available if the public page is restricted. */ }
    }
    return json({ ...link, error: 'The match link omits its league ID and CricClubs could not resolve it. Paste a link containing leagueId or clubId, or enter the league ID below.' }, 422);
}
