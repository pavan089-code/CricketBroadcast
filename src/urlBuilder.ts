import { AVAILABLE_THEMES, DEFAULT_THEME, resolveTheme, ThemeName } from './theme';
import { showToast } from './toast';
import { CricClubsApiError, getMatchState } from './cricclubs';
import { parseMatchUrl, validId } from '../shared/matchUrl';
import { safeImage } from './overlayOptions';

export interface OverlayLinkParams {
    matchId: string;
    /** Preferred current API name. `clubId` is accepted for callers on older integrations. */
    leagueId?: string;
    clubId?: string;
    theme: string;
    title?: string;
    color?: string;
    teamLogo?: string;
    opponentLogo?: string;
    sponsor?: string;
    quiet?: boolean;
    view?: 'scorebug' | 'scorecard';
}

/** Backward-compatible URL builder; view is only emitted when explicitly requested. */
export function buildOverlayUrl({ matchId, leagueId, clubId, theme, view, ...options }: OverlayLinkParams, base: { origin: string; pathname: string } = window.location): string {
    const params = new URLSearchParams();
    params.set('matchId', matchId.trim());
    const resolvedLeagueId = (leagueId ?? clubId ?? '').trim();
    if (resolvedLeagueId) params.set('leagueId', resolvedLeagueId);
    if (view) params.set('view', view);
    const resolved = resolveTheme(theme);
    if (resolved !== DEFAULT_THEME) params.set('theme', resolved);
    if (options.title?.trim()) params.set('title', options.title.trim().slice(0, 100));
    if (/^#[0-9a-f]{6}$/i.test(options.color || '')) params.set('color', options.color!);
    for (const key of ['teamLogo', 'opponentLogo', 'sponsor'] as const) {
        const image = safeImage(options[key] || null);
        if (image) params.set(key, image);
    }
    if (options.quiet) params.set('quiet', '1');
    return `${base.origin}${base.pathname}?${params.toString()}`;
}

/** Human label for the theme <select>: franchise codes upper-cased, core names title-cased. */
export function themeLabel(theme: ThemeName): string {
    if (theme.length <= 4) return theme.toUpperCase();
    return theme.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Wires match validation and the independent scorebug / scorecard links. */
export function setupUrlBuilder() {
    const matchInput = document.getElementById('build-match-id') as HTMLInputElement | null;
    const clubInput = document.getElementById('build-club-id') as HTMLInputElement | null;
    const themeSelect = document.getElementById('build-theme') as HTMLSelectElement | null;
    const links = (['scorebug', 'scorecard'] as const).map(view => ({
        view,
        output: document.getElementById(`${view}-url`) as HTMLOutputElement | null,
        copy: document.getElementById(`${view}-copy`) as HTMLButtonElement | null,
        preview: document.getElementById(`${view}-preview`) as HTMLAnchorElement | null,
    }));
    if (!matchInput || !clubInput || !themeSelect || links.some(link => !link.output || !link.copy || !link.preview)) return;

    for (const theme of AVAILABLE_THEMES) {
        const option = document.createElement('option');
        option.value = theme;
        option.textContent = themeLabel(theme);
        option.selected = theme === DEFAULT_THEME;
        themeSelect.appendChild(option);
    }
    clubInput.value = '';
    const urlInput = document.getElementById('match-url') as HTMLInputElement | null;
    const connect = document.getElementById('connect-match') as HTMLButtonElement | null;
    const status = document.getElementById('connection-status');
    const summary = document.getElementById('connected-match');
    let validated = false;
    let busy = false;
    let retry = false;
    let revision = 0;
    let manualLeague = false;
    clubInput.addEventListener('input', () => { manualLeague = true; });
    urlInput?.addEventListener('input', () => { manualLeague = false; clubInput.value = ''; matchInput.value = ''; });
    const optionValue = (key: string) => (document.getElementById(`build-${key}`) as HTMLInputElement | null)?.value || '';

    const render = () => {
        const matchId = matchInput.value.trim();
        for (const link of links) {
            const url = buildOverlayUrl({ matchId, leagueId: clubInput.value, theme: themeSelect.value, view: link.view,
                title: optionValue('title'), color: optionValue('color'), teamLogo: optionValue('teamLogo'),
                opponentLogo: optionValue('opponentLogo'), sponsor: optionValue('sponsor'),
                quiet: (document.getElementById('build-quiet') as HTMLInputElement | null)?.checked });
            link.output!.textContent = validated ? url : 'Connect your match to generate this URL.';
            link.output!.dataset.state = validated ? 'ready' : 'incomplete';
            link.copy!.disabled = !validated;
            link.preview!.href = validated ? url : '#';
            link.preview!.setAttribute('aria-disabled', String(!validated));
            link.preview!.tabIndex = validated ? 0 : -1;
            link.preview!.style.pointerEvents = validated ? '' : 'none';
        }
        if (connect) connect.disabled = busy || !(urlInput?.value.trim() || matchId);
    };
    themeSelect.addEventListener('change', render);
    for (const key of ['title', 'color', 'teamLogo', 'opponentLogo', 'sponsor']) {
        document.getElementById(`build-${key}`)?.addEventListener('input', render);
    }
    document.getElementById('build-quiet')?.addEventListener('change', render);
    render();
    for (const input of [urlInput, matchInput, clubInput]) input?.addEventListener('input', () => {
        revision++;
        validated = false;
        if (status) status.textContent = 'Connect the match to validate this link.';
        if (summary) summary.textContent = '';
        render();
    });
    connect?.addEventListener('click', async () => {
        if (busy) return;
        const attempt = ++revision;
        validated = false;
        busy = true;
        connect.textContent = retry ? 'Retrying…' : 'Connecting…';
        if (status) status.textContent = retry ? 'Retrying your connection…' : 'Connecting to your match…';
        if (summary) summary.textContent = '';
        render();
        let stage: 'url' | 'league' | 'match' = 'url';
        try {
            if (urlInput?.value.trim()) {
                const parsed = parseMatchUrl(urlInput.value);
                matchInput.value = parsed.matchId;
                if (parsed.leagueId) clubInput.value = parsed.leagueId;
                else if (!manualLeague || !clubInput.value.trim()) {
                    stage = 'league';
                    if (status) status.textContent = 'Finding the league for your match…';
                    const response = await fetch(`/api/cricclubs/resolve?${new URLSearchParams({ url: urlInput.value })}`, { signal: AbortSignal.timeout(15000) });
                    const resolved = await response.json();
                    if (attempt !== revision) return;
                    if (!response.ok || typeof resolved.leagueId !== 'string' || !validId(resolved.leagueId)) throw new Error('League ID required.');
                    clubInput.value = resolved.leagueId;
                }
            }
            stage = 'league';
            if (!validId(clubInput.value.trim())) throw new Error('League ID required.');
            stage = 'url';
            if (!validId(matchInput.value.trim())) throw new Error('Enter a valid match ID or paste a complete CricClubs match URL.');
            stage = 'match';
            if (status) status.textContent = 'Validating your match…';
            const state = await getMatchState(matchInput.value.trim(), clubInput.value.trim());
            if (attempt !== revision) return;
            validated = true;
            retry = false;
            if (status) status.textContent = 'Match validated. Copy either overlay URL or preview it.';
            if (summary) summary.textContent = `${state.match.team1} vs ${state.match.team2} · ${state.innings.battingTeam} ${state.innings.runs}/${state.innings.wickets} (${state.innings.overs} ov)${state.match.status ? ` · ${state.match.status}` : ''}`;
        } catch (error) {
            if (attempt !== revision) return;
            console.error('Match connection failed:', error);
            retry = true;
            if (status) status.textContent = stage === 'url'
                ? (error instanceof Error ? error.message : 'Paste a complete CricClubs match URL.')
                : stage === 'league'
                    ? 'League ID required. We could not find it from this link. Enter the league ID below, then retry.'
                    : error instanceof CricClubsApiError && [400, 404].includes(error.status ?? 0)
                        ? 'Match not found. Check the match link and league ID, then retry.'
                        : 'The match is temporarily unavailable. Check your connection and retry.';
            if (stage !== 'url') (document.getElementById('advanced-ids') as HTMLDetailsElement | null)?.setAttribute('open', '');
        } finally {
            busy = false;
            connect.textContent = retry ? 'Retry connection' : 'Connect match';
            render();
        }
    });

    document.getElementById('url-builder')?.addEventListener('submit', event => {
        event.preventDefault();
        connect?.click();
    });
    for (const link of links) link.preview!.addEventListener('click', event => {
        if (!validated) event.preventDefault();
    });
    for (const link of links) link.copy!.addEventListener('click', async () => {
        if (!validated) return;
        if (!matchInput.value.trim()) {
            showToast('Enter a match ID first.', 'error');
            matchInput.focus();
            return;
        }
        try {
            await navigator.clipboard.writeText(link.output!.textContent ?? '');
            const previousLabel = link.copy!.textContent;
            link.copy!.textContent = 'Copied!';
            window.setTimeout(() => { link.copy!.textContent = previousLabel; }, 1800);
            if (status) status.textContent = 'URL copied. Add it to OBS as a Browser Source at 1920 × 1080 or 1280 × 720.';
            showToast(`${link.view === 'scorebug' ? 'Scorebug' : 'Full scorecard'} URL copied.`, 'success');
        } catch {
            showToast('Copy failed. Select the URL and copy it manually.', 'error');
        }
    });
}
