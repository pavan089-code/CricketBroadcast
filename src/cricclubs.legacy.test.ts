import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import eagles from '../shared/fixtures/carolina-24778.json';
import titans from '../shared/fixtures/carolina-24780.json';
import { parseMatchUrl } from '../shared/matchUrl';
import { getMatchState, normaliseMatchState } from './cricclubs';
import { setupUrlBuilder } from './urlBuilder';

afterEach(() => vi.unstubAllGlobals());

it.each([
    ['https://cricclubs.com/CarolinaCricket/fullScorecard.do?clubId=38131&matchId=24778', eagles, 'Eagles 172/2 (28.0 ov)'],
    ['https://www.carolinacricket.org/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131', titans, 'Gujarat Titans 177/8 (20.0 ov)'],
] as const)('connects the real setup form through the adapter: %s', async (url, fixture, score) => {
    document.body.innerHTML = readFileSync('index.html', 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture))));
    setupUrlBuilder();
    const input = document.getElementById('match-url') as HTMLInputElement;
    input.value = url;
    input.dispatchEvent(new Event('input'));
    (document.getElementById('connect-match') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.getElementById('connected-match')?.textContent).toContain(score));
    expect((document.getElementById('scorebug-copy') as HTMLButtonElement).disabled).toBe(false);
    expect(document.getElementById('scorebug-url')?.textContent).toContain('leagueId=38131');
});

it.each([
    ['https://cricclubs.com/CarolinaCricket/fullScorecard.do?clubId=38131&matchId=24778', eagles, 'Eagles', 172, 2, '28.0'],
    ['https://www.carolinacricket.org/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131', titans, 'Gujarat Titans', 177, 8, '20.0'],
] as const)('normalizes captured real numeric-ID scorecards: %s', async (url, fixture, team, runs, wickets, overs) => {
    const { matchId, leagueId } = parseMatchUrl(url);
    const fetcher = vi.fn(async () => new Response(JSON.stringify(fixture)));
    vi.stubGlobal('fetch', fetcher);
    const state = await getMatchState(matchId, leagueId!);
    expect(fetcher.mock.calls[0]).toBeDefined();
    expect(fetcher).toHaveBeenCalledWith(`/api/cricclubs/match?matchId=${matchId}&leagueId=38131`, expect.any(Object));
    expect(state.innings).toMatchObject({ number: 1, battingTeam: team, runs, wickets, overs });
    expect(state.lastBall?.id).toMatch(/^legacy:1:/);
    expect(state.currentOver).toHaveLength(6);
    expect(state.scorecard).toHaveLength(1);
    expect(state.striker?.name).toBeTruthy();
    expect(state.bowler?.name).toBeTruthy();
    expect(normaliseMatchState(matchId, fixture.matchInfo, fixture.commentary).lastBall?.id).toBe(state.lastBall?.id);
});

it('reads real legacy boundary and wicket markers without counting auto comments', () => {
    const state = normaliseMatchState('24780', titans.matchInfo, titans.commentary);
    expect(state.currentOver.map(ball => ball.display)).toEqual(['W', '2', '4', 'W', '1', '2']);
    expect(state.currentOver[0]).toMatchObject({ isWicket: true, wicketMethod: 'run out' });
    expect(state.currentOver[2].isFour).toBe(true);
    expect(state.currentOver[3]).toMatchObject({ isWicket: true, wicketMethod: 'caught' });
    const eaglesState = normaliseMatchState('24778', eagles.matchInfo, eagles.commentary);
    expect(eaglesState.currentOver[0].isSix).toBe(true);
});

it('requires usable innings and team metadata, not just an innings-shaped property', async () => {
    for (const fixture of [
        { matchInfo: {}, commentary: titans.commentary },
        { matchInfo: titans.matchInfo, commentary: { data: { innings1Balls: null } } },
    ]) {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(fixture))));
        await expect(getMatchState('24780', '38131')).rejects.toThrow('Match unavailable');
    }
});
