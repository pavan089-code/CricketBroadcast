import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchEventType, MatchState } from './cricclubs';
import { ANIMATION_ASSETS, animationTypeFor, EventAnimation } from './eventAnimation';

function state(type: MatchEventType = 'FOUR', ballId = 'delivery-1'): MatchState {
    return {
        match: { id: 'match-1', team1: 'A', team2: 'B', overs: 20 },
        innings: { number: 1, battingTeam: 'A', bowlingTeam: 'B', runs: 4, wickets: 0, overs: '0.1', runRate: 24 },
        scorecard: [], currentOver: [], lastBall: null, event: { type, ballId },
    };
}

let animation: EventAnimation;
const video = () => document.querySelector<HTMLVideoElement>('.event-animation');
const finish = () => video()!.dispatchEvent(new Event('ended'));
const key = (value: string, target: EventTarget = document, options: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }));

beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.stubEnv('DEV', true);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div id="score">Live score</div>';
    animation = new EventAnimation();
});

afterEach(() => {
    animation.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('normalized event selection and delivery identity', () => {
    it('does not replay a consumed delivery after the Browser Source reloads mid-animation', () => {
        animation.observe(state(), 'league');
        expect(video()).not.toBeNull();
        animation.dispose();
        animation = new EventAnimation();
        for (let poll = 0; poll < 6; poll++) animation.observe(state(), 'league');
        expect(video()).toBeNull();
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()!.dataset.type).toBe('six');
    });

    it('persists skipped busy deliveries across reloads too', () => {
        animation.observe(state(), 'league');
        animation.observe(state('SIX', 'delivery-2'), 'league');
        animation.dispose();
        animation = new EventAnimation();
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()).toBeNull();
    });

    it.each(['denied', 'malformed', 'quota'])('recovers from %s session storage without breaking playback', problem => {
        animation.dispose();
        if (problem === 'denied') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Denied'); });
        if (problem === 'malformed') sessionStorage.setItem('cricket-overlay:animation-deliveries:v1', '{broken');
        if (problem === 'quota') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
        animation = new EventAnimation();
        animation.observe(state(), 'league');
        if (problem === 'quota') finish();
        else expect(video()).toBeNull();
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()!.dataset.type).toBe('six');
        finish();
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()).toBeNull();
    });
    it.each([
        ['FOUR', 'four'], ['SIX', 'six'], ['WICKET', 'wicket'],
    ] as const)('%s plays the transparent %s.webm asset', (event, type) => {
        animation.observe(state(event), 'league');
        expect(ANIMATION_ASSETS[type]).toMatch(new RegExp(`/assets/animations/${type}\\.webm`));
        expect(video()!.getAttribute('src')).toBe(ANIMATION_ASSETS[type]);
        expect(video()!.dataset.type).toBe(type);
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    });

    it('never infers events from extras, arbitrary score changes, or missing events', () => {
        for (const type of ['WIDE', 'NO_BALL', 'DOT', 'SINGLE', 'DOUBLE', 'TRIPLE', 'OVER_COMPLETE', 'INNINGS_END'] as const) {
            expect(animationTypeFor({ type, ballId: type })).toBeNull();
            animation.observe({ ...state(type, type), innings: { ...state().innings, runs: 6, wickets: 1 } }, 'league');
        }
        animation.observe({ ...state(), event: null }, 'league');
        animation.observe(state('FOUR', ''), 'league');
        expect(video()).toBeNull();
    });

    it('consumes the same delivery once, including stale responses and corrected event types', () => {
        animation.observe(state(), 'league');
        finish();
        animation.observe(state(), 'league');
        animation.observe(state('SIX'), 'league');
        expect(video()).toBeNull();
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()!.dataset.type).toBe('six');
        finish();
        animation.observe(state(), 'league');
        expect(video()).toBeNull();
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    });

    it('distinguishes new deliveries even with identical over/ball coordinates', () => {
        animation.observe(state('FOUR', 'illegal-1'), 'league');
        finish();
        animation.observe(state('FOUR', 'illegal-2'), 'league');
        expect(video()).not.toBeNull();
    });

    it('scopes delivery IDs by innings, match and league', () => {
        animation.observe(state(), 'league');
        finish();
        animation.observe({ ...state(), innings: { ...state().innings, number: 2 } }, 'league');
        finish();
        animation.observe({ ...state(), match: { ...state().match, id: 'match-2' } }, 'league');
        finish();
        animation.observe(state(), 'another-league');
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(4);
    });

    it('does not interrupt or queue a second event, including later polls of the skipped event', () => {
        animation.observe(state(), 'league');
        const first = video();
        animation.observe(state('WICKET', 'delivery-2'), 'league');
        expect(video()).toBe(first);
        finish();
        animation.observe(state('WICKET', 'delivery-2'), 'league');
        expect(video()).toBeNull();
        animation.observe(state('SIX', 'delivery-3'), 'league');
        expect(video()!.dataset.type).toBe('six');
    });

    it('does not play historical events in an ended match or events consumed while disabled', () => {
        animation.observe({ ...state(), match: { ...state().match, ended: true } }, 'league');
        expect(video()).toBeNull();
        animation.setEnabled(false);
        animation.observe(state('SIX', 'delivery-2'), 'league');
        animation.setEnabled(true);
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()).toBeNull();
    });
});

describe('native video lifecycle', () => {
    it('uses muted inline autoplay once without controls/focus and reveals only on playing', () => {
        expect(video()).toBeNull();
        animation.play('four');
        const clip = video()!;
        expect(clip.muted).toBe(true);
        expect(clip.defaultMuted).toBe(true);
        expect(clip.autoplay).toBe(true);
        expect(clip.playsInline).toBe(true);
        expect(clip.loop).toBe(false);
        expect(clip.controls).toBe(false);
        expect(clip.tabIndex).toBe(-1);
        expect(clip.getAttribute('aria-hidden')).toBe('true');
        expect(clip.classList.contains('is-playing')).toBe(false);
        clip.dispatchEvent(new Event('playing'));
        expect(clip.classList.contains('is-playing')).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(video()).toBe(clip); // Not cut off by an assumed 1.58s duration.
        finish();
        expect(video()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        animation.play('six');
        expect(video()!.dataset.type).toBe('six');
    });

    it.each(['error', 'rejection', 'throw', 'timeout'])('clears on %s without touching the score and permits the next event', async failure => {
        if (failure === 'rejection') vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Blocked'));
        if (failure === 'throw') vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => { throw new Error('Codec'); });
        animation.observe(state(), 'league');
        if (failure === 'error') video()!.dispatchEvent(new Event('error'));
        if (failure === 'timeout') vi.advanceTimersByTime(10_000);
        await Promise.resolve();
        expect(video()).toBeNull();
        expect(document.getElementById('score')!.textContent).toBe('Live score');
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(ANIMATION_ASSETS.four), expect.anything());
        animation.observe(state(), 'league');
        expect(video()).toBeNull(); // Failures are not retried each poll.
        animation.observe(state('SIX', 'delivery-2'), 'league');
        expect(video()!.dataset.type).toBe('six');
    });

    it('a late rejection from a cleared video cannot clear its replacement', async () => {
        let reject!: (error: Error) => void;
        vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
        animation.play('four');
        finish();
        animation.play('six');
        reject(new Error('Late abort'));
        await Promise.resolve();
        expect(video()!.dataset.type).toBe('six');
    });

    it('cleans up video, timers and keyboard listeners on disposal', () => {
        animation.play('four');
        animation.dispose();
        key('6');
        expect(video()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('development-only hotkeys', () => {
    it.each([['4', 'four'], ['6', 'six'], ['w', 'wicket'], ['W', 'wicket']])('%s triggers %s', (value, type) => {
        key(value);
        expect(video()!.dataset.type).toBe(type);
    });

    it('ignores typing, held keys, composition and modified shortcuts', () => {
        document.body.insertAdjacentHTML('beforeend', '<input><textarea></textarea><select></select><div contenteditable="true"><span>edit</span></div><div role="textbox"></div>');
        document.querySelectorAll('input, textarea, select, span, [role="textbox"]').forEach(target => key('4', target));
        for (const options of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) key('6', document, options);
        key('x');
        expect(video()).toBeNull();
        animation.setEnabled(false);
        key('w');
        expect(video()).toBeNull();
    });

    it('does not register hotkeys in production', () => {
        animation.dispose();
        vi.stubEnv('DEV', false);
        animation = new EventAnimation();
        key('4'); key('6'); key('w');
        expect(video()).toBeNull();
    });
});
