import type { MatchState } from './cricclubs';
import fourUrl from '../assets/animations/four.webm?url';
import sixUrl from '../assets/animations/six.webm?url';
import wicketUrl from '../assets/animations/wicket.webm?url';
import './css/event-animation.css';

export type AnimationType = 'four' | 'six' | 'wicket';
export const ANIMATION_ASSETS: Record<AnimationType, string> = {
    four: fourUrl, six: sixUrl, wicket: wicketUrl,
};
const SEEN_DELIVERIES_KEY = 'cricket-overlay:animation-deliveries:v1';

/** Only consume the adapter's explicit cricket semantics, never score deltas. */
export function animationTypeFor(event: MatchState['event']): AnimationType | null {
    switch (event?.type) {
        case 'FOUR': return 'four';
        case 'SIX': return 'six';
        case 'WICKET': return 'wicket';
        default: return null;
    }
}

/** Native-video component for the scorebug. No video is fetched until requested. */
export class EventAnimation {
    private readonly seen = new Set<string>();
    private video: HTMLVideoElement | null = null;
    private enabled = true;
    private watchdog: ReturnType<typeof setTimeout> | undefined;
    private baselineRequired = false;

    constructor() {
        try {
            const saved: unknown = JSON.parse(sessionStorage.getItem(SEEN_DELIVERIES_KEY) ?? '[]');
            if (!Array.isArray(saved) || !saved.every(key => typeof key === 'string')) throw new Error('Invalid delivery history');
            saved.forEach(key => this.seen.add(key));
        } catch {
            // Restricted browser storage must not crash the scoreboard or replay the
            // first stale snapshot after a reload. New deliveries remain eligible.
            this.baselineRequired = true;
        }
        if (import.meta.env.DEV) document.addEventListener('keydown', this.onKeyDown);
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        if (!enabled) this.clear();
    }

    observe(state: MatchState, leagueId: string): void {
        const baseline = this.baselineRequired;
        this.baselineRequired = false;
        const type = animationTypeFor(state.event);
        if (!type || !state.event?.ballId) return;
        // Exclude the event type: a correction must not animate one delivery twice.
        const key = JSON.stringify([leagueId, state.match.id, state.innings.number, state.event.ballId]);
        if (this.seen.has(key)) return;
        this.seen.add(key); // Consume even when busy/quiet: never queue or replay later.
        try {
            // Store only delivery identities in this tab's session, including skipped
            // events, before playback. Reloading an OBS source must not replay them.
            sessionStorage.setItem(SEEN_DELIVERIES_KEY, JSON.stringify([...this.seen]));
        } catch {
            if (import.meta.env.DEV) console.warn('[EventAnimation] Delivery history unavailable; using in-memory deduplication.');
        }
        if (!baseline && !state.match.ended) this.play(type);
    }

    play(type: AnimationType): void {
        if (!this.enabled || this.video) return;
        const video = document.createElement('video');
        this.video = video;
        video.className = 'event-animation';
        video.dataset.type = type;
        video.setAttribute('aria-hidden', 'true');
        video.tabIndex = -1;
        video.muted = true;
        video.defaultMuted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.controls = false;
        video.loop = false;
        video.preload = 'auto'; // Only the requested alpha clip; subsequent plays use HTTP cache.

        const fail = (reason: unknown) => {
            if (this.video !== video) return;
            if (import.meta.env.DEV) console.warn(`[EventAnimation] ${type}: ${ANIMATION_ASSETS[type]}`, reason);
            this.clear();
        };
        const watchProgress = () => {
            if (this.video !== video) return;
            clearTimeout(this.watchdog);
            // A failed/stalled load must not leave a permanent layer or busy state.
            // Healthy playback completes on ended, without a duration-based cutoff.
            this.watchdog = setTimeout(() => fail('No playback progress for 10 seconds'), 10_000);
        };
        video.onended = () => { if (this.video === video) this.clear(); };
        video.onerror = () => fail(video.error ?? 'Video failed to load');
        video.onplaying = () => {
            if (this.video !== video) return;
            video.classList.add('is-playing');
            watchProgress();
        };
        video.ontimeupdate = watchProgress;
        video.src = ANIMATION_ASSETS[type];
        document.body.appendChild(video);
        watchProgress();
        try {
            // Muted autoplay also works in OBS; handle both rejected and synchronous failures.
            const playback = video.play();
            playback?.catch(fail);
        } catch (error) {
            fail(error);
        }
    }

    private clear(): void {
        const video = this.video;
        this.video = null;
        clearTimeout(this.watchdog);
        this.watchdog = undefined;
        if (!video) return;
        video.onended = video.onerror = video.onplaying = video.ontimeupdate = null;
        video.pause();
        video.removeAttribute('src');
        video.load(); // Release the media resource and any pending network request.
        video.remove();
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (!this.enabled || event.defaultPrevented || event.repeat || event.isComposing
            || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
        const type = ({ '4': 'four', '6': 'six', w: 'wicket' } as const)[event.key.toLowerCase() as '4' | '6' | 'w'];
        if (type) this.play(type);
    };

    dispose(): void {
        this.enabled = false;
        this.clear();
        this.seen.clear();
        document.removeEventListener('keydown', this.onKeyDown);
    }
}
