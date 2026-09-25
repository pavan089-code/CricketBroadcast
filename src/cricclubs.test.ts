import { afterEach, describe, expect, it, vi } from 'vitest';
import { CricClubsApiError, getCommentary, getMatchInfo, getMatchState, matchStateToOverlayData, normaliseMatchState, overlayEventFor } from './cricclubs';

const matchInfo = {
    data: {
        team1Name: 'Hyderabad Warriors',
        team2Name: 'Rajasthan Royals',
        totalOvers: 20,
    },
};

// This mirrors the current public endpoint: balls are newest-first and auto comments
// share the same arrays as deliveries.
const commentary = {
    data: {
        latestBatting: {
            batsman1: { playerID: 'pavan-id', playerName: ' Pavan Ch', runsScored: 12, ballsFaced: 3, fours: 1, sixers: 1 },
            batsman2: { playerID: 'manish-id', firstName: 'Manish Yadav', lastName: 'qwe', runsScored: 0, ballsFaced: 0, fours: 0, sixers: 0 },
        },
        latestBowling: {
            bowler1: { playerID: 'kedar-id', firstName: 'Kedar', lastName: 'Nelalu', balls: 3, runs: 12, wickets: 0, overs: '0.3' },
        },
        innings1Balls: {
            teamName: 'Hyderabad Warriors',
            oversMap: {
                Over0: {
                    rcb: '12/0',
                    balls: [
                        { ballId: 'third', over: 0, ball: 3, ballType: 'Good Ball', runs: 4, runsDisplay: '4', striker: 'pavan-id', nonStriker: 'manish-id', bowler: 'kedar-id', strikerName: 'Pavan C', nonStrikerName: 'Manish Yadav q', bowlerName: 'Kedar N', outMethod: 'Not Out', isFour: 1, isSix: 0, time: '2026-09-25T01:20:00+05:30' },
                        { ballId: 'second', over: 0, ball: 2, ballType: 'Good Ball', runs: 6, runsDisplay: '6', striker: 'pavan-id', nonStriker: 'manish-id', bowler: 'kedar-id', strikerName: 'Pavan C', nonStrikerName: 'Manish Yadav q', bowlerName: 'Kedar N', outMethod: 'Not Out', isFour: 0, isSix: 1 },
                        { ballId: 'first', over: 0, ball: 1, ballType: 'Good Ball', runs: 2, runsDisplay: '2', striker: 'pavan-id', nonStriker: 'manish-id', bowler: 'kedar-id', strikerName: 'Pavan C', nonStrikerName: 'Manish Yadav q', bowlerName: 'Kedar N', outMethod: 'Not Out', isFour: 0, isSix: 0 },
                        { ballId: 'noise', ballType: 'Auto Comment Ball', commentary: 'Players: Hyderabad Warriors comes to the crease' },
                    ],
                },
            },
        },
    },
};

describe('current CricClubs adapter', () => {
    it('keeps extras in delivery order even when they share a legal-ball number', () => {
        const changed = structuredClone(commentary);
        const over = changed.data.innings1Balls.oversMap.Over0;
        Object.assign(over, { balls: [
            { ...over.balls[0], ballId: 'dot', ball: 2, runs: 0, runsDisplay: '.', isFour: 0 },
            { ...over.balls[0], ballId: 'no-ball', ball: 1, runs: 1, runsDisplay: '1nb', ballType: 'No Ball', isFour: 0 },
            { ...over.balls[0], ballId: 'wide', ball: 1, runs: 1, runsDisplay: '1wd', ballType: 'Wide Ball', isFour: 0 },
            over.balls[2],
        ] });
        const state = normaliseMatchState('m', matchInfo, changed);
        expect(state.currentOver.map(ball => ball.display)).toEqual(['2', '1wd', '1nb', '.']);
        expect(state.innings.overs).toBe('0.2');
        expect(state.event?.type).toBe('DOT');
        expect(overlayEventFor(state)).toBeNull();
    });
    it('ignores auto comments at the head of an active or future innings', () => {
        const changed = structuredClone(commentary);
        const noise = { ...changed.data.innings1Balls.oversMap.Over0.balls[0], ballId: 'auto-new', ballType: 'Auto Comment Ball', isSix: 1 };
        Object.assign(changed.data.innings1Balls.oversMap.Over0, { balls: [noise, ...changed.data.innings1Balls.oversMap.Over0.balls] });
        Object.assign(changed.data, { innings2Balls: { teamName: 'Rajasthan Royals', rcb: '0/0', overs: '0', oversMap: { Over0: { rcb: '0/0', balls: [noise] } } } });
        const state = normaliseMatchState('m', matchInfo, changed);
        expect(state.innings.number).toBe(1);
        expect(state.currentOver.map(ball => ball.display)).toEqual(['2','6','4']);
        expect(state.event).toEqual({ type: 'FOUR', ballId: 'third' });
    });
    it('switches players, bowler and over at a real innings transition despite stale summaries', () => {
        const changed = structuredClone(commentary);
        Object.assign(changed.data.latestBatting.batsman1, { teamId: 'first-team' });
        Object.assign(changed.data.latestBatting.batsman2, { teamId: 'first-team' });
        Object.assign(changed.data, { innings2Balls: { teamName: 'Rajasthan Royals', teamId: 'second-team', oversMap: { Over0: { rcb: '0/0', balls: [{ ...changed.data.innings1Balls.oversMap.Over0.balls[0], ballId: 'chase-first', ball: 1, runs: 0, runsDisplay: '.', isFour: 0, striker: 'new-striker', strikerName: 'New Striker', nonStriker: 'new-runner', nonStrikerName: 'New Runner', bowler: 'new-bowler', bowlerName: 'New Bowler' }] } } } });
        const state = normaliseMatchState('m', matchInfo, changed);
        expect(state.innings).toMatchObject({ number:2, battingTeam:'Rajasthan Royals', runs:0, overs:'0.1' });
        expect(state.striker?.name).toBe('New Striker');
        expect(state.nonStriker?.name).toBe('New Runner');
        expect(state.bowler).toMatchObject({name:'New Bowler',overs:'0.1',runs:0});
        expect(state.currentOver.map(ball=>ball.display)).toEqual(['.']);
    });
    it('recognises non-zero innings summaries without choosing an empty future innings', () => {
        const changed = structuredClone(commentary);
        Object.assign(changed.data, { innings2Balls: { teamName:'Rajasthan Royals', rcb:'5/1', runs:5, overs:'1.2', oversMap:{} } });
        expect(normaliseMatchState('m', matchInfo, changed).innings).toMatchObject({number:2,runs:5,wickets:1,overs:'1.2'});
    });
    it('passes tournament context through to the scorebug', () => {
        const state = normaliseMatchState('m', {data:{...matchInfo.data,seriesName:'Summer Cup'}}, commentary);
        const context = matchStateToOverlayData(state).values.customTextValue;
        expect(context).toContain('Summer Cup');
        expect(context).toContain('Hyderabad Warriors');
        expect(context).toContain('Rajasthan Royals');
        expect(context).toContain('Innings 1');
    });
    it('uses a bounded request and rejects timeout failures', async () => {
        const timeout = vi.spyOn(AbortSignal, 'timeout');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
        await expect(getMatchState('m','l')).rejects.toBeInstanceOf(CricClubsApiError);
        expect(timeout).toHaveBeenCalledWith(20000);
        timeout.mockRestore();
    });
    it('handles wicket, completed over, next over, and second innings', () => {
        const changed = structuredClone(commentary);
        const over = changed.data.innings1Balls.oversMap.Over0;
        Object.assign(over.balls[0], { ball: 6, runsDisplay: 'W', isFour: 0, outMethod: 'Bowled' });
        const wicket = normaliseMatchState('test', matchInfo, changed);
        expect(wicket.innings.overs).toBe('1.0');
        expect(overlayEventFor(wicket)).toMatchObject({ type: 'wicket', dismissal: 'Bowled' });
        const next = { ...over, balls: [{ ...over.balls[0], ballId: 'next-over', over: 1, ball: 1, outMethod: 'Not Out', runsDisplay: '.', runs: 0 }] };
        Object.assign(changed.data.innings1Balls.oversMap, { Over1: next });
        expect(normaliseMatchState('test', matchInfo, changed).currentOver.map(ball => ball.id)).toEqual(['next-over']);
        Object.assign(changed.data, { innings2Balls: { teamName: 'Rajasthan Royals', oversMap: { Over0: { rcb: '1/0', balls: [{ ...next.balls[0], over: 0, ballId: 'chase' }] } } } });
        expect(normaliseMatchState('test', matchInfo, changed).innings).toMatchObject({ number: 2, battingTeam: 'Rajasthan Royals', bowlingTeam: 'Hyderabad Warriors', runs: 1 });
    });
    it('never substitutes the previous bowler when latestBowling is stale', () => {
        const changed = structuredClone(commentary);
        changed.data.latestBowling.bowler1.playerID = 'previous-bowler';
        const state = normaliseMatchState('test', matchInfo, changed);
        expect(state.bowler).toMatchObject({ id: 'kedar-id', runs: 12, balls: 3 });
    });
    it('rejects a successful but empty proxy response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ matchInfo: {}, commentary: { data: {} } }))));
        await expect(getMatchState('m', 'l')).rejects.toThrow('Match unavailable');
    });
    afterEach(() => vi.unstubAllGlobals());

    it('uses one same-origin proxy URL rather than exposing CricClubs security requests to OBS', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ matchInfo: { data: {} }, commentary: { data: {} } }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await getMatchInfo('match id', 'league id');
        await getCommentary('match id', 'league id');

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/cricclubs/match?matchId=match+id&leagueId=league+id', expect.objectContaining({ cache: 'no-store' }));
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/cricclubs/match?matchId=match+id&leagueId=league+id', expect.objectContaining({ cache: 'no-store' }));
    });

    it('normalises the verified 12/0 test innings and ignores auto commentary', () => {
        const state = normaliseMatchState('mJTQjabTbjHqUpybIGVqqA', matchInfo, commentary);

        expect(state.match).toMatchObject({ team1: 'Hyderabad Warriors', team2: 'Rajasthan Royals', overs: 20 });
        expect(state.innings).toMatchObject({ battingTeam: 'Hyderabad Warriors', bowlingTeam: 'Rajasthan Royals', runs: 12, wickets: 0, overs: '0.3' });
        expect(state.striker).toMatchObject({ name: 'Pavan Ch', runs: 12, balls: 3, fours: 1, sixes: 1 });
        expect(state.nonStriker).toMatchObject({ name: 'Manish Yadav qwe', runs: 0, balls: 0 });
        expect(state.bowler).toMatchObject({ name: 'Kedar Nelalu', balls: 3, runs: 12, wickets: 0, overs: '0.3' });
        expect(state.currentOver.map(ball => ball.display)).toEqual(['2', '6', '4']);
        expect(state.currentOver.map(ball => ball.id)).toEqual(['first', 'second', 'third']);
        expect(state.lastBall?.id).toBe('third');
        expect(state.event).toEqual({ type: 'FOUR', ballId: 'third' });
        expect(state.scorecard[0]).toMatchObject({
            number: 1, battingTeam: 'Hyderabad Warriors', runs: 12, wickets: 0, overs: '0.3',
            bowling: [{ name: 'Kedar Nelalu', overs: '0.3', runs: 12, wickets: 0, economy: 24 }],
        });
        expect(state.scorecard[0].batting).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Pavan Ch', runs: 12, balls: 3, fours: 1, sixes: 1, strikeRate: 400, striker: true })]));
    });

    it('retains the completed first-innings summary when deliveries start in innings two', () => {
        const chase = structuredClone(commentary);
        Object.assign(chase.data, {
            innings2Balls: {
                teamName: 'Rajasthan Royals', teamId: 'rr', rcb: '3/0', overs: '0.1',
                oversMap: { Over0: { rcb: '3/0', balls: [{ ballId: 'chase-1', over: 0, ball: 1, ballType: 'Good Ball', runs: 3, runsDisplay: '3', striker: 'rr-batter', strikerName: 'Very Long Rajasthan Batter Name', bowler: 'rr-bowler', bowlerName: 'Hyderabad Bowler', outMethod: 'Not Out' }] } },
            },
            latestBatting: { batsman1: { playerID: 'rr-batter', playerName: 'Very Long Rajasthan Batter Name', runsScored: 3, ballsFaced: 1, fours: 0, sixers: 0 } },
            latestBowling: { bowler1: { playerID: 'rr-bowler', playerName: 'Hyderabad Bowler', balls: 1, runs: 3, wickets: 0, overs: '0.1' } },
        });
        const state = normaliseMatchState('match', matchInfo, chase);
        expect(state.innings).toMatchObject({ number: 2, battingTeam: 'Rajasthan Royals', runs: 3, overs: '0.1' });
        expect(state.scorecard).toHaveLength(2);
        expect(state.scorecard[0]).toMatchObject({ number: 1, battingTeam: 'Hyderabad Warriors', runs: 12, completed: true });
        expect(state.scorecard[1]).toMatchObject({ number: 2, battingTeam: 'Rajasthan Royals', runs: 3, completed: false });
        expect(state.scorecard[1].batting[0].name).toBe('Very Long Rajasthan Batter Name');
        expect(state.scorecard[1].bowling[0]).toMatchObject({ name: 'Hyderabad Bowler', balls: 1, runs: 3 });
    });

    it('normalizes dismissal and extras from delivery fields, and omits unavailable innings fields', () => {
        const values = structuredClone(commentary);
        Object.assign(values.data, { latestBatting: undefined, latestBowling: undefined });
        const base = values.data.innings1Balls.oversMap.Over0.balls[0];
        const wide = Object.assign({}, base, { ballId: 'wide', ball: 2, ballType: 'Wide', runs: 2, runsDisplay: '2wd' });
        const out = Object.assign({}, base, { ballId: 'out', ball: 1, runs: 0, runsDisplay: 'W', outPerson: 'pavan-id', outMethod: 'Bowled' });
        Object.assign(values.data.innings1Balls.oversMap.Over0, { rcb: '2/1', balls: [wide, out] as typeof values.data.innings1Balls.oversMap.Over0.balls });
        const state = normaliseMatchState('match', matchInfo, values);
        expect(state.scorecard[0]).toMatchObject({ runs: 2, wickets: 1 });
        expect(state.scorecard[0].batting[0]).toMatchObject({ isOut: true, dismissal: 'Bowled' });
        expect(state.scorecard[0].bowling[0]).toMatchObject({ wickets: 1, runs: 2 });
        expect(state.scorecard[0].extras).toMatchObject({ total: 2, wides: 2 });
        expect(state.scorecard[0].batting[0].strikeRate).toBe(0);
        expect(state.scorecard[0].extras?.byes).toBeUndefined();
    });

    it('leaves unknown scorecard statistics blank instead of turning them into zero', () => {
        const incomplete = structuredClone(commentary);
        Object.assign(incomplete.data, { latestBatting: { batsman1: { playerID: 'fresh-id', playerName: 'Fresh Batter' } } });
        const state = normaliseMatchState('match', matchInfo, incomplete);
        expect(state.scorecard[0].batting.find(player => player.id === 'fresh-id')).toMatchObject({
            runs: null, balls: null, fours: null, sixes: null, strikeRate: null,
        });
    });

    it('ignores a pre-created empty second innings until its first delivery', () => {
        const withEmptyChase = structuredClone(commentary);
        Object.assign(withEmptyChase.data, {
            innings2Balls: { teamName: 'Rajasthan Royals', oversMap: {} },
        });

        const state = normaliseMatchState('mJTQjabTbjHqUpybIGVqqA', matchInfo, withEmptyChase);

        expect(state.innings).toMatchObject({
            number: 1,
            battingTeam: 'Hyderabad Warriors',
            runs: 12,
            wickets: 0,
            overs: '0.3',
        });
        expect(state.currentOver.map(ball => ball.display)).toEqual(['2', '6', '4']);
        expect(state.scorecard.map(innings => innings.number)).toEqual([1]);
    });

    it('detects the six on ball 2 before the later four arrives', () => {
        const afterBallTwo = structuredClone(commentary);
        afterBallTwo.data.innings1Balls.oversMap.Over0.balls = afterBallTwo.data.innings1Balls.oversMap.Over0.balls.slice(1);
        afterBallTwo.data.innings1Balls.oversMap.Over0.rcb = '8/0';
        Object.assign(afterBallTwo.data.latestBatting.batsman1, { runsScored: 8, ballsFaced: 2, fours: 0, sixers: 1 });
        Object.assign(afterBallTwo.data.latestBowling.bowler1, { balls: 2, runs: 8, overs: '0.2' });

        const state = normaliseMatchState('match', matchInfo, afterBallTwo);
        expect(state.currentOver.map(ball => ball.display)).toEqual(['2', '6']);
        expect(state.scorecard[0]).toMatchObject({ runs: 8, wickets: 0, overs: '0.2' });
        expect(state.scorecard[0].batting.find(player => player.id === 'pavan-id')).toMatchObject({ runs: 8, balls: 2, sixes: 1 });
        expect(state.event).toEqual({ type: 'SIX', ballId: 'second' });
    });

    it('preserves the existing scorebar contract without putting raw API JSON in UI components', () => {
        const data = matchStateToOverlayData(normaliseMatchState('test', matchInfo, commentary));
        expect(data.values).toMatchObject({ t1Name: 'Hyderabad Warriors', t1Total: '12', t1Wickets: '0', t1Overs: '0.3' });
        expect(data.balls).toEqual(['2', '6', '4']);
    });

    it('fetches one paired proxy response and handles malformed payloads as adapter errors', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ matchInfo, commentary }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await expect(getMatchState('match', 'league')).resolves.toMatchObject({ innings: { runs: 12, overs: '0.3' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats a JSON error envelope as a failed poll rather than an empty match', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ errorCode: 'SEC001', errorMessage: 'Security check failed' }), { status: 200 })));
        await expect(getCommentary('match', 'league')).rejects.toThrow('Security check failed');
    });

    it('also rejects an error envelope nested in the paired proxy response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            matchInfo: { data: {} },
            commentary: { errorCode: 'SEC001', errorMessage: 'Expired token' },
        }), { status: 200 })));
        await expect(getMatchState('match', 'league')).rejects.toThrow('Expired token');
    });
});
