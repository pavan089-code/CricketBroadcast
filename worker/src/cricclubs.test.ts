import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContentToken, handleCricClubs } from './cricclubs';

describe('CricClubs first-party proxy', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('creates a fresh base64 RSA ciphertext without returning or storing any credential', () => {
        const first = createContentToken(1_700_000_000_000);
        const second = createContentToken(1_700_000_000_000);
        expect(first).toMatch(/^[A-Za-z0-9+/]{171}=$/);
        // PKCS#1 padding is random, even for the same timestamp.
        expect(second).not.toBe(first);
    });

    it('proxies both current endpoints with a fresh content token per upstream request', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { team1Name: 'Hyderabad Warriors', team2Name: 'Rajasthan Royals' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ data: { innings1Balls: { teamName: 'Hyderabad Warriors', oversMap: {} } } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await handleCricClubs(new Request('https://overlay.example/api/cricclubs/match?matchId=mJTQjabTbjHqUpybIGVqqA&leagueId=kieC6vVijImUZXUfaN8QOg'));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            matchInfo: { data: { team1Name: 'Hyderabad Warriors', team2Name: 'Rajasthan Royals' } },
            commentary: { data: { innings1Balls: { teamName: 'Hyderabad Warriors', oversMap: {} } } },
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('https://core-prod-origin.cricclubs.com/core/public/match/getMatchInfo?clubId=kieC6vVijImUZXUfaN8QOg&matchId=mJTQjabTbjHqUpybIGVqqA');
        expect(fetchMock.mock.calls[1][0]).toBe('https://core-prod-origin.cricclubs.com/core/public/series/match/mJTQjabTbjHqUpybIGVqqA/scorecard/commentary?leagueId=kieC6vVijImUZXUfaN8QOg');
        const firstHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
        const secondHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
        expect(firstHeaders.get('x-content-token')).toMatch(/^[A-Za-z0-9+/]{171}=$/);
        expect(secondHeaders.get('x-content-token')).toMatch(/^[A-Za-z0-9+/]{171}=$/);
        expect(secondHeaders.get('x-content-token')).not.toBe(firstHeaders.get('x-content-token'));
        expect(firstHeaders.get('referer')).toBe('https://app.cricclubs.com/');
    });

    it('does not leak an upstream 406 payload or token to the caller', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('SEC001 internal details', { status: 406 })));
        const response = await handleCricClubs(new Request('https://overlay.example/api/cricclubs/match?matchId=match&leagueId=league'));
        expect(response.status).toBe(502);
        expect(await response.json()).toEqual({ error: 'CricClubs request failed with HTTP 406.', upstreamStatus: 406 });
    });

    it('validates IDs before creating an upstream request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await handleCricClubs(new Request('https://overlay.example/api/cricclubs/match?matchId=bad%20id&leagueId=league'));
        expect(response.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
