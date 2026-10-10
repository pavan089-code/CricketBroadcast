import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shell from '../index.html?raw';
import { pollLoop, resetAppStateForTests, stopPolling, updateScore } from './app';
import { resetCardsForTests } from './cards';
import { resetUiStateForTests } from './ui';

// Production DOM IDs, resolved lazily because dom.ts normally runs at module import.
vi.mock('./dom', () => ({ DOM: new Proxy({}, {
    get: (_, name: string) => document.getElementById(name === 'ballContainer' ? 'ball-by-ball'
        : name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)),
}) }));

type Outcome = 'DOT' | 'SINGLE' | 'DOUBLE' | 'FOUR' | 'SIX' | 'WICKET';
const runs: Record<Outcome, number> = { DOT: 0, SINGLE: 1, DOUBLE: 2, FOUR: 4, SIX: 6, WICKET: 0 };
// Synthetic upstream fixture only. The real adapter, UI and polling implementation run below.
function payload(outcome: Outcome, delivery: number) {
    return {
        matchInfo: { data: { team1Name: 'Test A', team2Name: 'Test B', totalOvers: 50 } },
        commentary: { data: { innings1Balls: { teamName: 'Test A', oversMap: {
            [`Over${Math.floor((delivery - 1) / 6)}`]: {
                rcb: `${delivery}/0`,
                balls: Array.from({ length: (delivery - 1) % 6 + 1 }, (_, index) => ({
                    ballId: `stress-${delivery - index}`, over: Math.floor((delivery - 1) / 6), ball: (delivery - 1) % 6 + 1 - index,
                    ballType: 'Good Ball', runs: index === 0 ? runs[outcome] : 0,
                    runsDisplay: index === 0 ? (outcome === 'WICKET' ? 'W' : String(runs[outcome])) : '0',
                    strikerName: 'Test Batter', bowlerName: 'Test Bowler',
                    outMethod: index === 0 && outcome === 'WICKET' ? 'Bowled' : 'Not Out',
                    isFour: index === 0 && outcome === 'FOUR', isSix: index === 0 && outcome === 'SIX',
                })),
            },
        } } } },
    };
}

let response = payload('DOT', 1);
let offline = false;
let starts: string[];
let ended = 0;
const clip = () => document.querySelector<HTMLVideoElement>('.event-animation');
const score = () => document.getElementById('team-score')!.textContent;
const fetchMock = vi.fn(async () => {
    if (offline) throw new Error('Simulated outage');
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
});

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLVideoElement) {
        starts.push(this.dataset.type!);
        this.dispatchEvent(new Event('playing'));
        const duration = { four: 1800, six: 1950, wicket: 2100 }[this.dataset.type!] ?? 2100;
        setTimeout(() => { if (this.isConnected) { ended++; this.dispatchEvent(new Event('ended')); } }, duration);
        return Promise.resolve();
    });
    sessionStorage.clear();
    document.body.innerHTML = new DOMParser().parseFromString(shell, 'text/html').body.innerHTML;
    window.history.replaceState(null, '', '/?matchId=stress&leagueId=test&nostats=1');
    resetAppStateForTests(); resetCardsForTests(); resetUiStateForTests();
    response = payload('DOT', 1); offline = false; starts = []; ended = 0;
});

afterEach(() => {
    stopPolling(); resetAppStateForTests(); resetCardsForTests();
    vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('production animation stress through the real adapter and score UI', () => {
    it.each([500, 250, 100])('drops rapid events at %i ms without interrupting video or score updates', async interval => {
        const sequence: Outcome[] = ['FOUR', 'SIX', 'WICKET', 'FOUR', 'SIX', 'WICKET'];
        let first: HTMLVideoElement | null = null;
        for (let i = 0; i < sequence.length; i++) {
            response = payload(sequence[i], i + 1);
            await updateScore();
            if (i === 0) first = clip();
            if (i * interval < 1800) expect(clip()).toBe(first);
            expect(score()).toBe(String(i + 1));
            expect(document.querySelectorAll('video').length).toBeLessThanOrEqual(1);
            await vi.advanceTimersByTimeAsync(interval);
        }
        await vi.advanceTimersByTimeAsync(2000);
        expect(clip()).toBeNull();
        expect(starts).toEqual(interval === 500 ? ['four', 'six'] : ['four']);
        await updateScore(); // Latest skipped event must stay consumed.
        expect(clip()).toBeNull();
        response = payload('WICKET', 7);
        await updateScore();
        expect(clip()!.dataset.type).toBe('wicket');
        expect(console.error).not.toHaveBeenCalled();
    });

    it.each(['FOUR', 'SIX', 'WICKET'] as const)('plays %s exactly once over six identical polls', async outcome => {
        response = payload(outcome, 1);
        for (let poll = 0; poll < 6; poll++) {
            await updateScore();
            await vi.advanceTimersByTimeAsync(2300);
        }
        expect(starts).toEqual([outcome.toLowerCase()]);
        expect(ended).toBe(1);
        expect(clip()).toBeNull();
    });

    it('plays A/B/C/D once each when idle and preserves wicket/four/six ordering under overlap', async () => {
        for (const [i, outcome] of (['FOUR', 'SIX', 'WICKET', 'FOUR'] as const).entries()) {
            response = payload(outcome, i + 1);
            await updateScore(); await vi.advanceTimersByTimeAsync(2300); await updateScore();
        }
        expect(starts).toEqual(['four', 'six', 'wicket', 'four']);
        response = payload('WICKET', 5); await updateScore();
        const current = clip();
        response = payload('FOUR', 6); await updateScore();
        response = payload('SIX', 7); await updateScore();
        expect(clip()).toBe(current);
        expect(score()).toBe('7');
        await vi.advanceTimersByTimeAsync(2300); await updateScore();
        expect(clip()).toBeNull();
        response = payload('FOUR', 8); await updateScore();
        expect(clip()!.dataset.type).toBe('four');
    });

    it('recovers polling after an outage and reload without a stale-event flood', async () => {
        response = payload('FOUR', 1); await pollLoop();
        expect(starts).toEqual(['four']);
        stopPolling(); resetAppStateForTests(); // Browser reload, with session storage intact.
        await pollLoop();
        expect(starts).toEqual(['four']);
        offline = true;
        await vi.advanceTimersByTimeAsync(15_000);
        expect(score()).toBe('1');
        expect(fetchMock).toHaveBeenCalledTimes(12);
        offline = false;
        await vi.advanceTimersByTimeAsync(9000);
        expect(starts).toEqual(['four']);
        response = payload('SIX', 2);
        await vi.advanceTimersByTimeAsync(1500);
        expect(score()).toBe('2');
        expect(starts).toEqual(['four', 'six']);
    });

    it('runs 30 simulated minutes with bounded DOM, timers and listeners and no polling degradation', async () => {
        const added = vi.spyOn(document, 'addEventListener');
        const removed = vi.spyOn(document, 'removeEventListener');
        const sequence: Outcome[] = ['DOT', 'SINGLE', 'DOUBLE', 'FOUR', 'SINGLE', 'SIX', 'DOT', 'WICKET', 'SINGLE', 'DOT'];
        const baseElements = document.querySelectorAll('*').length;
        let maxElements = baseElements;
        let maxTimers = 0;
        await pollLoop();
        // 120 deliveries at 15s per delivery; ten real poll iterations per delivery.
        for (let delivery = 1; delivery <= 120; delivery++) {
            response = payload(sequence[(delivery - 1) % sequence.length], delivery);
            for (let poll = 0; poll < 10; poll++) {
                await vi.advanceTimersByTimeAsync(1500);
                expect(score()).toBe(String(delivery));
                expect(document.querySelectorAll('video').length).toBeLessThanOrEqual(1);
                maxElements = Math.max(maxElements, document.querySelectorAll('*').length);
                maxTimers = Math.max(maxTimers, vi.getTimerCount());
            }
            expect(clip()).toBeNull();
            expect(vi.getTimerCount()).toBe(1); // Only the next poll remains after each delivery.
        }
        expect(fetchMock).toHaveBeenCalledTimes(1201);
        expect(starts).toHaveLength(36);
        expect(ended).toBe(36);
        expect(maxElements - baseElements).toBeLessThanOrEqual(7); // Six ball indicators + one video.
        // jsdom StorageImpl.setItem also schedules one zero-delay storage-event task.
        expect(maxTimers).toBeLessThanOrEqual(5); // Poll, card, simulated ended, watchdog, storage event.
        expect(added.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
        expect(console.error).not.toHaveBeenCalled();
        const journal = JSON.parse(sessionStorage.getItem('cricket-overlay:animation-deliveries:v1')!);
        expect(journal).toHaveLength(36); // Growth is per unique event, never per poll.
        stopPolling(); resetCardsForTests();
        expect(vi.getTimerCount()).toBe(0);
        expect(removed.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    });
});
