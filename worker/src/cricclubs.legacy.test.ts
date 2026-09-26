import { afterEach, expect, it, vi } from 'vitest';
import eagles from '../../shared/fixtures/carolina-24778.json';
import titans from '../../shared/fixtures/carolina-24780.json';
import { handleCricClubs } from './cricclubs';
import { parseMatchUrl } from '../../shared/matchUrl';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
    'https://cricclubs.com/CarolinaCricket/fullScorecard.do?clubId=38131&matchId=24778',
    'https://www.carolinacricket.org/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131',
])('routes legacy IDs to the official numeric endpoints: %s', async url => {
    const { matchId, leagueId } = parseMatchUrl(url);
    const fixture = matchId === '24778' ? eagles : titans;
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(fixture.matchInfo))
        .mockResolvedValueOnce(Response.json(fixture.commentary));
    vi.stubGlobal('fetch', fetcher);
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await handleCricClubs(new Request(`https://overlay.test/api/cricclubs/match?matchId=${matchId}&clubId=${leagueId}`), true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fixture);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
        `https://core-prod-origin.cricclubs.com/core/match/getMatchInfo?clubId=38131&matchId=${matchId}&X-Auth-Token=null`,
        `https://core-prod-origin.cricclubs.com/core/scoreCard/getBallByBall?clubId=38131&matchId=${matchId}&X-Auth-Token=null`,
    ]);
    for (const call of fetcher.mock.calls) {
        expect(call[1].redirect).toBe('manual');
        const token = new Headers(call[1].headers).get('x-content-token');
        expect(token).toMatch(/^[A-Za-z0-9+/]{171}=$/);
        expect(JSON.stringify(log.mock.calls)).not.toContain(token);
    }
    expect(log).toHaveBeenCalledWith('cricclubs', expect.objectContaining({ matchValidated: true }));
});

it.each([401, 403, 404, 406, 500, 503])('records the exact upstream HTTP %s without leaking its body', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>private upstream details</html>', { status, headers: { 'Content-Type': 'text/html' } })));
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await handleCricClubs(new Request('https://overlay.test/api/cricclubs/match?matchId=123&leagueId=456'), true);
    expect(response.status).toBe(status === 406 ? 502 : status);
    expect(await response.json()).toMatchObject({ upstreamStatus: status });
    expect(log).toHaveBeenCalledWith('cricclubs', expect.objectContaining({ httpStatus: status, responseKind: 'html' }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('private upstream details');
});

it.each([
    ['', 'upstream_empty'], ['<html>challenge</html>', 'upstream_html'],
    ['not json', 'invalid_json_or_body_read'],
    ['{"responseState":false}', 'upstream_error_envelope'],
])('classifies unusable HTTP 200 bodies: %s', async (body, reason) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await handleCricClubs(new Request('https://overlay.test/api/cricclubs/match?matchId=123&leagueId=456'), true);
    expect(response.status).toBe(502);
    expect(log).toHaveBeenCalledWith('cricclubs', expect.objectContaining({ reason }));
});

it('does not follow an upstream redirect', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
        status: 302, headers: { Location: 'https://untrusted.example/' },
    })));
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const response = await handleCricClubs(new Request('https://overlay.test/api/cricclubs/match?matchId=123&leagueId=456'), true);
    expect(response.status).toBe(502);
    expect(log).toHaveBeenCalledWith('cricclubs', expect.objectContaining({ reason: 'upstream_redirect' }));
});
