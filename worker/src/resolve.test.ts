import { afterEach, expect, it, vi } from 'vitest';
import { handleResolve } from './resolve';
const request = (url: string) => new Request(`https://overlay.test/api/cricclubs/resolve?${new URLSearchParams({ url })}`);
afterEach(() => vi.unstubAllGlobals());
it('does not mistake inherited object properties for verified league aliases', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('blocked', {status:403})));
    expect((await handleResolve(request('https://cricclubs.com/constructor/results/m'))).status).toBe(422);
});
it('resolves the verified public league alias without upstream requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await handleResolve(request('https://cricclubs.com/chevva/results/m'));
    expect(await response.json()).toMatchObject({ matchId: 'm', leagueId: 'kieC6vVijImUZXUfaN8QOg' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetcher).not.toHaveBeenCalled();
});
it('does not fetch arbitrary hosts', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await handleResolve(request('https://localhost/results/m'))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
});
it('resolves a single public league ID and rejects ambiguous page data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"leagueId":"league"}'))
        .mockResolvedValueOnce(new Response('{"leagueId":"one","encryptedClubId":"two"}')));
    expect(await (await handleResolve(request('https://cricclubs.com/example/results/m'))).json()).toMatchObject({ leagueId: 'league' });
    expect((await handleResolve(request('https://cricclubs.com/example/results/m'))).status).toBe(422);
});
it('returns actionable fallback for restricted or unavailable pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('challenge', { status: 403 })).mockRejectedValueOnce(new Error('offline')));
    for (let i = 0; i < 2; i++) expect((await handleResolve(request('https://cricclubs.com/unknown/results/m'))).status).toBe(422);
});
