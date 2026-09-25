import { CricketAPIData } from './types';

const PROXY_PATH = '/api/cricclubs/match';

type JsonRecord = Record<string, unknown>;

export interface BatterState {
    id?: string;
    name: string;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
}

export interface BowlerState {
    maidens?: number;
    id?: string;
    name: string;
    balls: number;
    runs: number;
    wickets: number;
    overs: string;
}

export interface BallState {
    id: string;
    over: number;
    ball: number;
    runs: number;
    display: string;
    striker: string;
    strikerId?: string;
    nonStriker?: string;
    nonStrikerId?: string;
    bowler?: string;
    bowlerId?: string;
    isFour: boolean;
    isSix: boolean;
    isWicket: boolean;
    wicketPlayer?: string;
    wicketMethod?: string;
    timestamp?: string;
    isWide: boolean;
    isNoBall: boolean;
}

export type MatchEventType = 'FOUR' | 'SIX' | 'WICKET' | 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'DOT' | 'WIDE' | 'NO_BALL' | 'OVER_COMPLETE' | 'INNINGS_END';

export interface MatchEvent {
    type: MatchEventType;
    ballId: string;
}

export interface MatchState {
    dismissed?: BatterState;
    logos?: { batting?: string; bowling?: string };
    match: {
        ended?: boolean;
        id: string;
        team1: string;
        team2: string;
        overs: number | null;
        status?: string;
        tournament?: string;
    };
    innings: {
        number: number;
        battingTeam: string;
        bowlingTeam: string;
        runs: number;
        wickets: number;
        overs: string;
        runRate: number | null;
    };
    striker?: BatterState;
    nonStriker?: BatterState;
    bowler?: BowlerState;
    currentOver: BallState[];
    lastBall: BallState | null;
    /** The latest delivery's event. The caller de-duplicates it by ballId across polls. */
    event: MatchEvent | null;
}

export interface CricClubsMatchInfoResponse { data?: JsonRecord; [key: string]: unknown; }
export interface CricClubsCommentaryResponse { data?: JsonRecord; [key: string]: unknown; }

export class CricClubsApiError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = 'CricClubsApiError';
    }
}

function asRecord(value: unknown): JsonRecord | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
    return value === undefined || value === null ? '' : String(value).trim();
}

function numberValue(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value: unknown): boolean {
    return value === true || value === 1 || value === '1' || value === 'true';
}

async function getJson<T>(url: string): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    } catch (error) {
        throw new CricClubsApiError(error instanceof Error ? error.message : 'Could not reach CricClubs.');
    }
    if (!response.ok) throw new CricClubsApiError(`CricClubs returned HTTP ${response.status}.`, response.status);
    try {
        const payload = await response.json() as T;
        const record = asRecord(payload);
        // The public host can return a JSON security/error envelope with a 200 status.
        // Treat that as a failed poll so OBS retains its last valid frame instead of
        // replacing it with an empty scorebar.
        const envelopes = [record, asRecord(record?.matchInfo), asRecord(record?.commentary)]
            .filter((item): item is JsonRecord => item !== null);
        const failed = envelopes.find(item => stringValue(item.errorCode) && stringValue(item.errorCode) !== '0');
        if (failed) {
            throw new CricClubsApiError(stringValue(failed.errorMessage) || `CricClubs error ${stringValue(failed.errorCode)}.`);
        }
        return payload;
    } catch (error) {
        if (error instanceof CricClubsApiError) throw error;
        throw new CricClubsApiError('CricClubs returned malformed JSON.');
    }
}

function proxyUrl(matchId: string, leagueId: string): string {
    return `${PROXY_PATH}?${new URLSearchParams({ matchId, leagueId })}`;
}

/** Fetches match metadata through the first-party token/CORS proxy. */
export function getMatchInfo(matchId: string, leagueId: string): Promise<CricClubsMatchInfoResponse> {
    return getJson<{ matchInfo: CricClubsMatchInfoResponse }>(proxyUrl(matchId, leagueId)).then(data => data.matchInfo);
}

/** Fetches ball-by-ball commentary through the first-party token/CORS proxy. */
export function getCommentary(matchId: string, leagueId: string): Promise<CricClubsCommentaryResponse> {
    return getJson<{ commentary: CricClubsCommentaryResponse }>(proxyUrl(matchId, leagueId)).then(data => data.commentary);
}

function responseData(response: JsonRecord): JsonRecord {
    return asRecord(response.data) ?? response;
}

function allRecords(value: unknown, result: JsonRecord[] = []): JsonRecord[] {
    const record = asRecord(value);
    if (!record) return result;
    result.push(record);
    for (const child of Object.values(record)) {
        if (asRecord(child)) allRecords(child, result);
        else for (const item of asArray(child)) if (asRecord(item)) allRecords(item, result);
    }
    return result;
}

/** Finds the first non-empty value for one of several known API field spellings. */
function field(value: unknown, names: string[]): unknown {
    const wanted = new Set(names.map(name => name.toLowerCase()));
    for (const record of allRecords(value)) {
        for (const [key, item] of Object.entries(record)) {
            if (wanted.has(key.toLowerCase()) && stringValue(item)) return item;
        }
    }
    return undefined;
}

interface InningsSource {
    number: number;
    data: JsonRecord;
    oversMap: JsonRecord;
}

function inningsSources(commentary: JsonRecord): InningsSource[] {
    const data = responseData(commentary);
    const result: InningsSource[] = [];
    for (const [key, value] of Object.entries(data)) {
        const match = /^innings(\d+)balls$/i.exec(key);
        const innings = asRecord(value);
        const oversMap = innings && asRecord(innings.oversMap);
        if (match && innings && oversMap) result.push({ number: Number(match[1]), data: innings, oversMap });
    }
    return result.sort((a, b) => a.number - b.number);
}

function sortedOverEntries(oversMap: JsonRecord): Array<[number, JsonRecord]> {
    return Object.entries(oversMap)
        .map(([key, value]) => {
            const match = /over(\d+)/i.exec(key);
            const record = asRecord(value);
            return match && record ? [Number(match[1]), record] as [number, JsonRecord] : null;
        })
        .filter((entry): entry is [number, JsonRecord] => entry !== null)
        .sort(([a], [b]) => a - b);
}

function ballFromRaw(raw: JsonRecord, over: number, fallbackBall: number): BallState | null {
    if (stringValue(raw.ballType).toLowerCase() === 'auto comment ball') return null;
    const id = stringValue(raw.ballId);
    // Commentary can include text-only records without a ball id. They are never a delivery.
    if (!id) return null;
    const display = stringValue(raw.runsDisplay) || (raw.outMethod && stringValue(raw.outMethod).toLowerCase() !== 'not out' ? 'W' : stringValue(raw.runs) || '.');
    const type = stringValue(raw.ballType).toLowerCase();
    const isWide = /wide|\bwd\b/.test(type) || /wd$/i.test(display);
    const isNoBall = /no.?ball|\bnb\b/.test(type) || /nb$/i.test(display);
    const wicketMethod = stringValue(raw.outMethod);
    const isWicket = wicketMethod !== '' && wicketMethod.toLowerCase() !== 'not out';
    return {
        id,
        over: numberValue(raw.over, over),
        ball: numberValue(raw.ball, fallbackBall),
        runs: numberValue(raw.runs),
        display,
        striker: stringValue(raw.strikerName) || 'Batter',
        strikerId: stringValue(raw.striker) || undefined,
        nonStriker: stringValue(raw.nonStrikerName) || undefined,
        nonStrikerId: stringValue(raw.nonStriker) || undefined,
        bowler: stringValue(raw.bowlerName) || undefined,
        bowlerId: stringValue(raw.bowler) || undefined,
        isFour: boolValue(raw.isFour),
        isSix: boolValue(raw.isSix),
        isWicket,
        wicketPlayer: stringValue(raw.outPerson) || undefined,
        wicketMethod: isWicket ? wicketMethod : undefined,
        timestamp: stringValue(raw.time) || undefined,
        isWide,
        isNoBall,
    };
}

function ballsInInnings(source: InningsSource): Array<{ ball: BallState; overData: JsonRecord }> {
    const seen = new Set<string>();
    const result: Array<{ ball: BallState; overData: JsonRecord }> = [];
    for (const [over, overData] of sortedOverEntries(source.oversMap)) {
        // API arrays are newest-first. Reversing each over preserves delivery order even
        // when illegal balls share the same legal-ball number and timestamp.
        for (const [index, raw] of asArray(overData.balls).slice().reverse().entries()) {
            const ball = ballFromRaw(asRecord(raw) ?? {}, over, index + 1);
            if (ball && !seen.has(ball.id)) {
                seen.add(ball.id);
                result.push({ ball, overData });
            }
        }
    }
    return result;
}

function selectInnings(sources: InningsSource[]): { source: InningsSource; balls: Array<{ ball: BallState; overData: JsonRecord }> } | null {
    const candidates = sources.map(source => ({ source, balls: ballsInInnings(source) }));
    // CricClubs pre-creates later-innings objects (including the team name) before
    // those innings begin. Require a real delivery or non-zero score/overs.
    const active = candidates.filter(item => item.balls.length > 0
        || numberValue(item.source.data.runs) > 0
        || numberValue(item.source.data.overs) > 0
        || ((scoreFrom(item.source.data.rcb)?.runs ?? 0) + (scoreFrom(item.source.data.rcb)?.wickets ?? 0)) > 0);
    return active.at(-1)
        ?? candidates.find(item => stringValue(item.source.data.teamName))
        ?? null;
}

function scoreFrom(value: unknown): { runs: number; wickets: number } | null {
    const match = /^(\d+)\s*\/\s*(\d+)$/.exec(stringValue(value));
    return match ? { runs: Number(match[1]), wickets: Number(match[2]) } : null;
}

function scoreEvent(ball: BallState, inningsEnded: boolean): MatchEvent | null {
    let type: MatchEventType | null = null;
    if (ball.isWicket) type = 'WICKET';
    else if (ball.isFour) type = 'FOUR';
    else if (ball.isSix) type = 'SIX';
    else if (ball.isWide) type = 'WIDE';
    else if (ball.isNoBall) type = 'NO_BALL';
    else if (ball.runs === 0) type = 'DOT';
    else if (ball.runs === 1) type = 'SINGLE';
    else if (ball.runs === 2) type = 'DOUBLE';
    else if (ball.runs === 3) type = 'TRIPLE';
    else if (ball.ball >= 6) type = 'OVER_COMPLETE';
    else if (inningsEnded) type = 'INNINGS_END';
    return type ? { type, ballId: ball.id } : null;
}

function playerStats(balls: BallState[], playerName: string, playerId?: string): BatterState | undefined {
    if (!playerName) return undefined;
    const playerBalls = balls.filter(ball => playerId ? ball.strikerId === playerId : ball.striker === playerName);
    return {
        id: playerId,
        name: playerName,
        runs: playerBalls.reduce((total, ball) => total + (ball.isWide ? 0 : ball.runs), 0),
        balls: playerBalls.filter(ball => !ball.isWide && !ball.isNoBall).length,
        fours: playerBalls.filter(ball => ball.isFour).length,
        sixes: playerBalls.filter(ball => ball.isSix).length,
    };
}

function bowlingStats(balls: BallState[], bowlerName: string, bowlerId?: string): BowlerState | undefined {
    if (!bowlerName) return undefined;
    const spell = balls.filter(ball => bowlerId ? ball.bowlerId === bowlerId : ball.bowler === bowlerName);
    const legal = spell.filter(ball => !ball.isWide && !ball.isNoBall).length;
    return {
        id: bowlerId,
        name: bowlerName,
        balls: legal,
        runs: spell.reduce((total, ball) => total + ball.runs, 0),
        wickets: spell.filter(ball => ball.isWicket).length,
        overs: `${Math.floor(legal / 6)}.${legal % 6}`,
    };
}

function playerName(record: JsonRecord): string {
    return [stringValue(record.firstName), stringValue(record.lastName)].filter(Boolean).join(' ')
        || stringValue(record.playerName);
}

function batterSummary(commentary: JsonRecord, slot: 'batsman1' | 'batsman2', teamId: string): BatterState | undefined {
    const latestBatting = asRecord(responseData(commentary).latestBatting);
    const batter = asRecord(latestBatting?.[slot]);
    const name = batter ? playerName(batter) : '';
    if (!batter || !name) return undefined;
    if (teamId && stringValue(batter.teamId) && stringValue(batter.teamId) !== teamId) return undefined;
    return {
        id: stringValue(batter.playerID) || undefined,
        name,
        runs: numberValue(batter.runsScored),
        balls: numberValue(batter.ballsFaced),
        fours: numberValue(batter.fours),
        sixes: numberValue(batter.sixers),
    };
}

function bowlerSummary(commentary: JsonRecord, currentBowlerId?: string): BowlerState | undefined {
    const latestBowling = asRecord(responseData(commentary).latestBowling);
    if (!latestBowling) return undefined;
    const bowlers = Object.values(latestBowling).map(asRecord)
        .filter((item): item is JsonRecord => item !== null);
    const bowler = currentBowlerId ? bowlers.find(item => stringValue(item.playerID) === currentBowlerId) : bowlers[0];
    const name = bowler ? playerName(bowler) : '';
    if (!bowler || !name) return undefined;
    const balls = numberValue(bowler.balls);
    return {
        id: stringValue(bowler.playerID) || currentBowlerId,
        name,
        balls,
        maidens: numberValue(bowler.maidens),
        runs: numberValue(bowler.runs),
        wickets: numberValue(bowler.wickets),
        overs: stringValue(bowler.overs) || `${Math.floor(balls / 6)}.${balls % 6}`,
    };
}

function teamNames(matchInfo: JsonRecord, innings: InningsSource): { team1: string; team2: string } {
    const team1 = stringValue(field(matchInfo, ['team1Name', 't1Name', 'firstTeamName', 'homeTeamName', 'teamOneName'])) || stringValue(field(matchInfo, ['teamName1']));
    const team2 = stringValue(field(matchInfo, ['team2Name', 't2Name', 'secondTeamName', 'awayTeamName', 'teamTwoName'])) || stringValue(field(matchInfo, ['teamName2']));
    const batting = stringValue(innings.data.teamName) || team1 || 'Batting Team';
    return { team1: team1 || batting, team2: team2 || 'Bowling Team' };
}

/** Normalises the current public CricClubs responses into a stable overlay model. */
export function normaliseMatchState(matchId: string, matchInfoResponse: CricClubsMatchInfoResponse, commentaryResponse: CricClubsCommentaryResponse): MatchState {
    const matchInfo = responseData(matchInfoResponse);
    const commentary = responseData(commentaryResponse);
    const selected = selectInnings(inningsSources(commentary));
    const totalOvers = numberValue(field(matchInfo, ['totalOvers', 'overs', 'noOfOvers', 'matchOvers']), NaN);
    const tournament = stringValue(field(matchInfo, ['seriesName', 'tournamentName', 'leagueName'])) || undefined;
    const names = selected ? teamNames(matchInfo, selected.source) : {
        team1: stringValue(field(matchInfo, ['team1Name', 't1Name', 'teamOneName'])) || 'Team 1',
        team2: stringValue(field(matchInfo, ['team2Name', 't2Name', 'teamTwoName'])) || 'Team 2',
    };

    if (!selected) {
        return {
            match: { id: matchId, ...names, tournament, overs: Number.isFinite(totalOvers) ? totalOvers : null, status: stringValue(field(matchInfo, ['status', 'matchStatus'])) || undefined },
            innings: { number: 0, battingTeam: names.team1, bowlingTeam: names.team2, runs: 0, wickets: 0, overs: '0.0', runRate: null },
            currentOver: [], lastBall: null, event: null,
        };
    }

    const allBalls = selected.balls.map(item => item.ball);
    const lastBall = allBalls.at(-1) ?? null;
    const activeOver = lastBall?.over;
    const activeEntries = activeOver === undefined ? [] : selected.balls.filter(item => item.ball.over === activeOver);
    const overData = activeEntries.at(-1)?.overData ?? {};
    const score = scoreFrom(overData.rcb) ?? scoreFrom(selected.source.data.rcb) ?? scoreFrom(field(selected.source.data, ['score', 'total', 'runsWickets'])) ?? {
        runs: allBalls.reduce((total, ball) => total + ball.runs, 0),
        wickets: allBalls.filter(ball => ball.isWicket).length,
    };
    const legalBalls = lastBall ? lastBall.over * 6 + lastBall.ball : 0;
    const summaryOvers = stringValue(selected.source.data.overs);
    const overs = !lastBall && /^\d+(\.[0-5])?$/.test(summaryOvers) ? summaryOvers : `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
    const battingTeam = stringValue(selected.source.data.teamName) || names.team1;
    const bowlingTeam = battingTeam === names.team1 ? names.team2 : names.team1;
    const runRate = lastBall && (lastBall.over * 6 + lastBall.ball) > 0
        ? Number((score.runs * 6 / (lastBall.over * 6 + lastBall.ball)).toFixed(2)) : null;
    const inningsEnded = boolValue(field(selected.source.data, ['isInningsEnded', 'inningsEnded'])) || boolValue(field(matchInfo, ['isMatchEnded', 'matchEnded']));
    const dismissedId = lastBall?.wicketPlayer || lastBall?.strikerId;
    const roster = [...asArray(matchInfo.team1Players), ...asArray(matchInfo.team2Players)].map(asRecord);
    const dismissedPlayer = roster.find(player => player && stringValue(player.encryptedPlayerId) === dismissedId);
    const dismissedName = dismissedPlayer ? playerName(dismissedPlayer) : lastBall?.striker || 'Wicket';
    const dismissed = lastBall?.isWicket ? playerStats(allBalls, dismissedName, dismissedId) : undefined;
    if (lastBall?.isWicket) lastBall.wicketPlayer = dismissedName;

    return {
        dismissed,
        logos: { batting: stringValue(selected.source.data.teamLogoPath), bowling: stringValue(inningsSources(commentary).find(source => source.data.teamName === bowlingTeam)?.data.teamLogoPath) },
        match: { id: matchId, ...names, tournament, ended: boolValue(field(matchInfo, ['isMatchEnded', 'matchEnded'])), overs: Number.isFinite(totalOvers) ? totalOvers : null, status: stringValue(field(matchInfo, ['status', 'matchStatus'])) || undefined },
        innings: { number: selected.source.number, battingTeam, bowlingTeam, runs: score.runs, wickets: score.wickets, overs, runRate },
        // Ball commentary abbreviates display names (for example "Pavan C" and
        // "Kedar N"). The latest summaries carry full names and current figures.
        striker: batterSummary(commentary, 'batsman1', stringValue(selected.source.data.teamId)) ?? (lastBall ? playerStats(allBalls, lastBall.striker, lastBall.strikerId) : undefined),
        nonStriker: batterSummary(commentary, 'batsman2', stringValue(selected.source.data.teamId)) ?? (lastBall?.nonStriker ? playerStats(allBalls, lastBall.nonStriker, lastBall.nonStrikerId) : undefined),
        bowler: bowlerSummary(commentary, lastBall?.bowlerId) ?? (lastBall?.bowler ? bowlingStats(allBalls, lastBall.bowler, lastBall.bowlerId) : undefined),
        currentOver: activeEntries.map(item => item.ball),
        lastBall,
        event: lastBall ? scoreEvent(lastBall, inningsEnded) : null,
    };
}

/** Fetches both current public endpoints and returns one normalised match state. */
export async function getMatchState(matchId: string, leagueId: string): Promise<MatchState> {
    if (!matchId.trim() || !leagueId.trim()) throw new CricClubsApiError('A match ID and league ID are required.');
    const { matchInfo, commentary } = await getJson<{ matchInfo: CricClubsMatchInfoResponse; commentary: CricClubsCommentaryResponse }>(proxyUrl(matchId, leagueId));
    if (!asRecord(matchInfo) || !asRecord(commentary) || !asRecord(commentary.data)
        || !Object.keys(commentary.data || {}).some(key => /^innings\d+Balls$/i.test(key))) {
        throw new CricClubsApiError('Match unavailable. Check the match link and try again.', 404);
    }
    return normaliseMatchState(matchId, matchInfo, commentary);
}

/** Compatibility bridge: preserves the existing scorebar, QR, and card components. */
export function matchStateToOverlayData(state: MatchState): CricketAPIData {
    const rr = state.innings.runRate === null ? '' : state.innings.runRate.toFixed(2);
    return {
        values: {
            matchId: state.match.id,
            firstLogo: state.logos?.batting,
            secondLogo: state.logos?.bowling,
            customTextValue: [state.match.tournament, `${state.innings.number ? `Innings ${state.innings.number}` : 'Awaiting play'} · vs ${state.innings.bowlingTeam}`].filter(Boolean).join(' · '),
            t1Name: state.innings.battingTeam,
            t2Name: state.innings.bowlingTeam,
            t1Total: String(state.innings.runs),
            t1Wickets: String(state.innings.wickets),
            t1Overs: state.innings.overs,
            t1RR: rr,
            totalOvers: state.match.overs ?? undefined,
            isSecondInningsStarted: 'false',
            isMatchEnded: state.match.ended ? '1' : '0',
            result: state.match.status,
            batsman1Name: state.striker?.name,
            batsman1Runs: String(state.striker?.runs ?? 0),
            batsman1Balls: String(state.striker?.balls ?? 0),
            batsman1Fours: String(state.striker?.fours ?? 0),
            batsman1Sixers: String(state.striker?.sixes ?? 0),
            batsman2Name: state.nonStriker?.name,
            batsman2Runs: String(state.nonStriker?.runs ?? 0),
            batsman2Balls: String(state.nonStriker?.balls ?? 0),
            batsman2Fours: String(state.nonStriker?.fours ?? 0),
            batsman2Sixers: String(state.nonStriker?.sixes ?? 0),
            bowlerName: state.bowler?.name,
            bowlerMaidens: String(state.bowler?.maidens ?? 0),
            bowlerRuns: String(state.bowler?.runs ?? 0),
            bowlerWickets: String(state.bowler?.wickets ?? 0),
            bowlerOvers: state.bowler?.overs ?? '0.0',
        },
        balls: state.currentOver.map(ball => ball.display),
    };
}

/** Converts only scorebar-supported delivery events to the existing timed graphics. */
export function overlayEventFor(state: MatchState): import('./events').OverlayEvent | null {
    const event = state.event;
    if (!event) return null;
    if (event.type === 'FOUR') return { type: 'boundary', runs: 4 };
    if (event.type === 'SIX') return { type: 'boundary', runs: 6 };
    if (event.type === 'WICKET') return {
        type: 'wicket',
        name: state.lastBall?.wicketPlayer || state.lastBall?.striker || 'Wicket',
        runs: String(state.dismissed?.runs ?? 0),
        balls: String(state.dismissed?.balls ?? 0),
        dismissal: state.lastBall?.wicketMethod ?? '',
    };
    return null;
}
