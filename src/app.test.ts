import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./dom', () => ({ DOM: { teamName: document.createElement('div') } }));
vi.mock('./cricclubs', () => ({
    getMatchState: vi.fn(),
    matchStateToOverlayData: vi.fn((state: unknown) => state),
    overlayEventFor: vi.fn(() => null),
}));
vi.mock('./ui', () => ({ updateScoreboard: vi.fn(), updateTeamLogos: vi.fn(async () => {}) }));
vi.mock('./theme', () => ({ applyTheme: vi.fn(), updateLogo: vi.fn() }));
vi.mock('./analytics', () => ({ track: vi.fn(), trackOnce: vi.fn() }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./events', () => ({ detectEvents: vi.fn(() => []) }));
vi.mock('./cards', () => ({ enqueueCards: vi.fn(), showSampleCard: vi.fn() }));
vi.mock('./liveStream', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./liveStream')>();
    return { ...actual, linkLiveStream: vi.fn(async () => {}) };
});

import { updateScore, setupLinkStreamForm, pollLoop, resetAppStateForTests } from './app';
import { DOM } from './dom';
import { getMatchState, matchStateToOverlayData, overlayEventFor } from './cricclubs';
import { updateScoreboard, updateTeamLogos } from './ui';
import { applyTheme, updateLogo } from './theme';
import { track, trackOnce } from './analytics';
import { showToast } from './toast';
import { detectEvents } from './events';
import { enqueueCards, showSampleCard } from './cards';
import { linkLiveStream, LinkLiveStreamError } from './liveStream';
import { mock_1stInnings, mock_2ndInnings, mock_matchEnded, mock_toss, mock_noTeamImage } from './mockData';
import { sampleReplayData } from './replayData';
import { CONFIG } from './config';

function setSearch(search: string) {
    Object.defineProperty(window, 'location', { value: { search, hostname: 'score.abhinav.dev' }, writable: true });
}

function mountShell() {
    document.body.innerHTML = `
        <div id="instructions" style="display:none">
            <form id="link-stream-form">
                <input id="link-club-id"><input id="link-match-id"><input id="link-stream-url">
                <button id="link-stream-submit" type="submit">Link Stream</button>
            </form>
        </div>
        <div class="overlay"></div>
        <section id="scorecard-overlay" hidden><div id="scorecard-content"></div></section>`;
}

const instructions = () => document.getElementById('instructions')!;
const overlay = () => document.querySelector('.overlay') as HTMLElement;
const live = { values: { t1Name: 'Live' }, balls: [] } as any;

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resetAppStateForTests();
    mountShell();
    DOM.teamName.textContent = 'Loading...';
});

afterEach(() => vi.restoreAllMocks());

describe('updateScore mode switch', () => {
    it('shows the home screen and records a home_view when there is no match context', async () => {
        setSearch('');
        await updateScore();
        expect(instructions().style.display).toBe('flex');
        expect(overlay().style.display).toBe('none');
        expect(trackOnce).toHaveBeenCalledWith('home_view');
        expect(getMatchState).not.toHaveBeenCalled();
        expect(applyTheme).not.toHaveBeenCalled();
    });

    it('renders mock data for ?debug= without touching the network or analytics', async () => {
        const cases: [string, unknown][] = [
            ['1', mock_1stInnings], ['true', mock_1stInnings], ['2', mock_2ndInnings],
            ['3', mock_matchEnded], ['4', mock_toss], ['5', mock_noTeamImage], ['garbage', mock_1stInnings],
        ];
        for (const [debug, expected] of cases) {
            vi.mocked(updateScoreboard).mockClear();
            setSearch(`?debug=${debug}&theme=kkr`);
            await updateScore();
            expect(updateScoreboard).toHaveBeenLastCalledWith(expected);
        }
        expect(getMatchState).not.toHaveBeenCalled();
        expect(trackOnce).not.toHaveBeenCalled();
        expect(instructions().style.display).toBe('none');
        expect(overlay().style.display).toBe('');
        expect(applyTheme).toHaveBeenCalledWith('kkr');
    });

    it('cycles through the replay fixtures and wraps around', async () => {
        setSearch('?mode=replay');
        for (let i = 0; i < sampleReplayData.length + 1; i++) await updateScore();
        const calls = vi.mocked(updateScoreboard).mock.calls.map(c => c[0]);
        expect(calls).toHaveLength(sampleReplayData.length + 1);
        expect(calls[0]).toBe(sampleReplayData[0]);
        expect(calls[sampleReplayData.length]).toBe(sampleReplayData[0]);
        expect(getMatchState).not.toHaveBeenCalled();
        expect(updateTeamLogos).not.toHaveBeenCalled();
    });

    it('fetches the current public feeds for a matchId, applying theme/logo and recording overlay_start once', async () => {
        setSearch('?matchId=2079&clubId=42&theme=rcb&logo=1');
        vi.mocked(getMatchState).mockResolvedValue(live);

        await updateScore();
        await updateScore();

        expect(getMatchState).toHaveBeenCalledTimes(2);
        expect(getMatchState).toHaveBeenCalledWith('2079', '42');
        expect(matchStateToOverlayData).toHaveBeenCalledWith(live);
        expect(updateTeamLogos).toHaveBeenCalledWith(live);
        expect(updateScoreboard).toHaveBeenCalledWith(live);
        expect(applyTheme).toHaveBeenCalledWith('rcb');
        expect(updateLogo).toHaveBeenCalledWith('1');
        // trackOnce is what de-duplicates; the app must route through it, not track()
        expect(trackOnce).toHaveBeenCalledWith('overlay_start', { clubId: '42', matchId: '2079', theme: 'rcb', logo: '1' });
        expect(track).not.toHaveBeenCalled();
    });

    it('does not invent a club id when none is given', async () => {
        setSearch('?matchId=7');
        vi.mocked(getMatchState).mockResolvedValue(live);
        await updateScore();
        expect(getMatchState).toHaveBeenCalledWith('7', '');
    });

    it('routes explicit scorebug view to the unchanged scorebug', async () => {
        setSearch('?matchId=2079&leagueId=42&view=scorebug');
        vi.mocked(getMatchState).mockResolvedValue(live);
        await updateScore();
        expect(overlay().style.display).toBe('');
        expect(document.getElementById('scorecard-overlay')!.hasAttribute('hidden')).toBe(true);
        expect(updateScoreboard).toHaveBeenCalledWith(live);
    });

    it('routes explicit scorecard view through the same live state and polling call', async () => {
        setSearch('?matchId=2079&leagueId=42&view=scorecard');
        const scorecardState = {
            match: { id: '2079', team1: 'Hyderabad Warriors', team2: 'Rajasthan Royals', tournament: 'League', overs: 20, status: undefined },
            innings: { number: 1, battingTeam: 'Hyderabad Warriors', bowlingTeam: 'Rajasthan Royals', runs: 12, wickets: 0, overs: '0.3', runRate: 24 },
            scorecard: [], currentOver: [], lastBall: null, event: null,
        };
        vi.mocked(getMatchState).mockResolvedValue(scorecardState as any);
        await updateScore();
        expect(getMatchState).toHaveBeenCalledTimes(1);
        expect(overlay().style.display).toBe('none');
        expect(document.getElementById('scorecard-overlay')!.hasAttribute('hidden')).toBe(false);
        expect(document.getElementById('scorecard-content')!.textContent).toContain('Hyderabad Warriors');
    });
});

describe('event cards', () => {
    const frame2 = { values: { t1Name: 'Live', t1Wickets: '1' }, balls: ['W'], lastBall: { id: 'second' } } as any;

    it('uses the latest ball ID to enqueue a current-API event exactly once', async () => {
        setSearch('?matchId=1');
        const first = { ...live, lastBall: { id: 'first' } };
        vi.mocked(getMatchState).mockResolvedValueOnce(first).mockResolvedValueOnce(frame2).mockResolvedValueOnce(frame2);
        const wicket = { type: 'wicket', name: 'X', runs: '1', balls: '2', dismissal: '' };
        vi.mocked(overlayEventFor).mockReturnValue(wicket as any);

        await updateScore();
        await updateScore();
        await updateScore();

        expect(overlayEventFor).toHaveBeenCalledTimes(2);
        expect(enqueueCards).toHaveBeenCalledTimes(2);
        expect(enqueueCards).toHaveBeenLastCalledWith([wicket]);
    });

    it('also fires in replay mode', async () => {
        setSearch('?mode=replay');
        await updateScore();
        await updateScore();
        expect(detectEvents).toHaveBeenCalledTimes(2);
        expect(detectEvents).toHaveBeenLastCalledWith(sampleReplayData[0], sampleReplayData[1]);
    });

    it('is silenced by ?quiet', async () => {
        setSearch('?matchId=1&quiet');
        vi.mocked(getMatchState).mockResolvedValue(live);
        await updateScore();
        await updateScore();
        expect(detectEvents).not.toHaveBeenCalled();
        expect(enqueueCards).not.toHaveBeenCalled();
    });

    it('holds a sample card once in debug mode when asked', async () => {
        setSearch('?debug=1&card=wicket');
        await updateScore();
        await updateScore();
        expect(showSampleCard).toHaveBeenCalledTimes(1);
        expect(showSampleCard).toHaveBeenCalledWith('wicket');
    });
});

describe('updateScore error handling', () => {
    it('recovers after repeated proxy failures without erasing the last frame or replaying its event', async () => {
        setSearch('?matchId=1&leagueId=league');
        const frame = { ...live, lastBall: {id:'stable-ball'} };
        vi.mocked(getMatchState).mockResolvedValueOnce(frame)
            .mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new Error('502'))
            .mockResolvedValueOnce(frame).mockResolvedValueOnce({...frame,lastBall:{id:'new-ball'}});
        vi.mocked(overlayEventFor).mockReturnValue({type:'boundary',runs:6});
        await updateScore();
        DOM.teamName.textContent = 'Last valid frame';
        await updateScore(); await updateScore();
        expect(DOM.teamName.textContent).toBe('Last valid frame');
        expect(updateScoreboard).toHaveBeenCalledTimes(1);
        await updateScore();
        expect(enqueueCards).toHaveBeenCalledTimes(1);
        await updateScore();
        expect(updateScoreboard).toHaveBeenCalledTimes(3);
        expect(enqueueCards).toHaveBeenCalledTimes(2);
    });
    it('shows a calm reconnecting state before any frame has rendered', async () => {
        setSearch('?matchId=1');
        vi.mocked(getMatchState).mockRejectedValue(new Error('HTTP error! status: 500'));
        await updateScore();
        expect(DOM.teamName.textContent).toBe('Connecting…');
        expect(updateScoreboard).not.toHaveBeenCalled();
    });

    it('keeps the last good frame after a successful render', async () => {
        setSearch('?matchId=1');
        vi.mocked(getMatchState).mockResolvedValueOnce(live).mockRejectedValueOnce(new Error('timeout'));
        await updateScore();
        DOM.teamName.textContent = 'Lions'; // what updateScoreboard would have painted
        await updateScore();
        expect(DOM.teamName.textContent).toBe('Lions');
        expect(console.error).toHaveBeenCalled();
    });

    it('treats a logo failure like a fetch failure and does not paint half a frame', async () => {
        setSearch('?matchId=1');
        vi.mocked(getMatchState).mockResolvedValue(live);
        vi.mocked(updateTeamLogos).mockRejectedValueOnce(new Error('img'));
        await updateScore();
        expect(updateScoreboard).not.toHaveBeenCalled();
        expect(DOM.teamName.textContent).toBe('Connecting…');
    });
});

describe('pollLoop', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('re-arms after each update completes and survives a thrown error', async () => {
        setSearch('?matchId=1');
        vi.mocked(getMatchState).mockResolvedValue(live);
        const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        await pollLoop();
        expect(timeoutSpy).toHaveBeenCalledWith(pollLoop, CONFIG.REFRESH_RATE);
        expect(getMatchState).toHaveBeenCalledTimes(1);

        // Advance one interval: exactly one more poll, scheduled only after the first finished.
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        expect(getMatchState).toHaveBeenCalledTimes(2);

        // Even an unexpected throw outside updateScore's own try/catch keeps the loop alive.
        vi.mocked(updateTeamLogos).mockImplementationOnce(() => { throw new Error('sync boom'); });
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        await vi.advanceTimersByTimeAsync(CONFIG.REFRESH_RATE);
        expect(getMatchState).toHaveBeenCalledTimes(4);
    });
});

describe('setupLinkStreamForm', () => {
    const form = () => document.getElementById('link-stream-form') as HTMLFormElement;
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    const button = () => document.getElementById('link-stream-submit') as HTMLButtonElement;
    const submit = async () => {
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(button().hasAttribute('aria-busy')).toBe(false));
    };

    beforeEach(() => {
        setupLinkStreamForm();
        input('link-match-id').value = ' 2079 ';
        input('link-stream-url').value = ' https://www.youtube.com/watch?v=dQw4w9WgXcQ ';
    });

    it('prefills the default club id', () => {
        expect(input('link-club-id').value).toBe(CONFIG.DEFAULT_CLUB_ID);
    });

    it('does nothing when a field is blank', async () => {
        input('link-match-id').value = '';
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(linkLiveStream).not.toHaveBeenCalled();
        expect(track).not.toHaveBeenCalled();
    });

    it('submits trimmed values, toasts success and records the outcome', async () => {
        await submit();
        expect(linkLiveStream).toHaveBeenCalledWith({ clubId: CONFIG.DEFAULT_CLUB_ID, matchId: '2079', liveStreamURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
        expect(showToast).toHaveBeenCalledWith('Live stream link submitted!', 'success');
        expect(track).toHaveBeenCalledWith('link_stream_submit', { clubId: CONFIG.DEFAULT_CLUB_ID, matchId: '2079', videoId: 'dQw4w9WgXcQ', outcome: 'submitted' });
        expect(button().textContent).toBe('Link Stream');
    });

    it('marks the button busy while in flight, ignores repeat submits, then restores it', async () => {
        let release!: () => void;
        vi.mocked(linkLiveStream).mockImplementationOnce(() => new Promise<void>(r => { release = r; }));
        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(button().getAttribute('aria-busy')).toBe('true');
        expect(button().textContent).toBe('Linking...');
        expect(button().disabled).toBe(false);

        form().dispatchEvent(new Event('submit', { cancelable: true }));
        expect(linkLiveStream).toHaveBeenCalledTimes(1);

        release();
        await vi.waitFor(() => expect(button().hasAttribute('aria-busy')).toBe(false));
        expect(button().textContent).toBe('Link Stream');
    });

    it('maps typed failures to their outcome codes and shows the error message', async () => {
        vi.mocked(linkLiveStream).mockRejectedValueOnce(new LinkLiveStreamError('popup_blocked', 'Your browser blocked the request popup.'));
        await submit();
        expect(showToast).toHaveBeenCalledWith('Your browser blocked the request popup.', 'error');
        expect(track).toHaveBeenCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'popup_blocked' }));

        vi.mocked(linkLiveStream).mockRejectedValueOnce(new LinkLiveStreamError('invalid_url', 'Could not find a YouTube video ID in that URL.'));
        await submit();
        expect(track).toHaveBeenLastCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'invalid_url' }));
    });

    it('reports unknown failures as error with a generic message when there is none', async () => {
        vi.mocked(linkLiveStream).mockRejectedValueOnce(new Error(''));
        await submit();
        expect(showToast).toHaveBeenCalledWith('Failed to link live stream. Please try again.', 'error');
        expect(track).toHaveBeenLastCalledWith('link_stream_submit', expect.objectContaining({ outcome: 'error' }));
    });
});

