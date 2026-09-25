import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('./dom', () => ({ DOM: { overlayImage: document.createElement('img') } }));
vi.mock('./toast', () => ({ showToast: vi.fn() }));
vi.mock('./cricclubs', async original => ({ ...await original<typeof import('./cricclubs')>(), getMatchState: vi.fn() }));
import { buildOverlayUrl, themeLabel, setupUrlBuilder } from './urlBuilder';
import { CricClubsApiError, getMatchState } from './cricclubs';
import { showToast } from './toast';
import { AVAILABLE_THEMES } from './theme';
const base = { origin: 'https://score.abhinav.dev', pathname: '/' };
const link = 'https://cricclubs.com/chevva/results/mJTQjabTbjHqUpybIGVqqA?asfd=Hyderabad+Warriors+vs+Rajasthan+Royals&tab=full_scorecard';
const state = { match: { team1: 'Hyderabad Warriors', team2: 'Rajasthan Royals' }, innings: { battingTeam: 'Hyderabad Warriors', runs: 12, wickets: 0, overs: '0.3' } } as Awaited<ReturnType<typeof getMatchState>>;
describe('buildOverlayUrl', () => {
    it('always includes an explicitly supplied league, including the old default', () => {
        expect(buildOverlayUrl({ matchId: '2079', leagueId: '1089463', theme: 'modern-light' }, base)).toBe('https://score.abhinav.dev/?matchId=2079&leagueId=1089463');
    });
    it('trims IDs, accepts clubId, and resolves themes', () => {
        expect(buildOverlayUrl({ matchId: ' 2079 ', clubId: ' 42 ', theme: 'kkr' }, base)).toBe('https://score.abhinav.dev/?matchId=2079&leagueId=42&theme=kkr');
        expect(buildOverlayUrl({ matchId: '1', theme: 'modern' }, base)).toBe('https://score.abhinav.dev/?matchId=1');
        expect(buildOverlayUrl({ matchId: '1', theme: 'sparkly' }, {...base, pathname:'/overlay/'})).toBe('https://score.abhinav.dev/overlay/?matchId=1');
    });
    it('round trips broadcast configuration and excludes unsafe image URLs', () => {
        const url = new URL(buildOverlayUrl({ matchId:'m', leagueId:'l', theme:'neon', title:'Cup & Final', color:'#123456', teamLogo:'https://example.com/team.png', opponentLogo:'javascript:alert(1)', sponsor:'https://example.com/sponsor.png', quiet:true }, base));
        expect(Object.fromEntries(url.searchParams)).toMatchObject({matchId:'m',leagueId:'l',theme:'neon',title:'Cup & Final',color:'#123456',teamLogo:'https://example.com/team.png',sponsor:'https://example.com/sponsor.png',quiet:'1'});
        expect(url.searchParams.has('opponentLogo')).toBe(false);
    });
});
it('labels core themes and franchise codes', () => {
    expect(themeLabel('kkr')).toBe('KKR');
    expect(themeLabel('modern-light')).toBe('Modern Light');
});
describe('setupUrlBuilder with the real setup form', () => {
    const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const writeText = vi.fn(async () => {});
    const enter = (id: string, value: string) => { const input = el<HTMLInputElement>(id); input.value=value; input.dispatchEvent(new Event('input')); };
    const connect = async () => { el<HTMLButtonElement>('connect-match').click(); await vi.waitFor(() => expect(el<HTMLButtonElement>('connect-match').disabled).toBe(false)); };
    const generate = () => el<HTMLButtonElement>('build-generate').click();
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = readFileSync('index.html','utf8');
        Object.defineProperty(window,'location',{value:{...base, search:'', hostname:'score.abhinav.dev'},writable:true});
        Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
        vi.spyOn(console,'error').mockImplementation(()=>{});
        vi.mocked(getMatchState).mockResolvedValue(state);
        vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({leagueId:'kieC6vVijImUZXUfaN8QOg'}))));
        setupUrlBuilder();
    });
    afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
    it('starts with no guessed league and disables connect, generate and copy', () => {
        expect(el<HTMLInputElement>('build-club-id').value).toBe('');
        for (const id of ['connect-match','build-generate','build-copy']) expect(el<HTMLButtonElement>(id).disabled).toBe(true);
        expect(Array.from(el<HTMLSelectElement>('build-theme').options).map(o=>o.value)).toEqual([...AVAILABLE_THEMES]);
        expect(el('build-url').textContent).not.toContain('matchId=');
    });
    it('validates the known URL before generate and copy, then invalidates changes', async () => {
        enter('match-url',link); await connect();
        expect(getMatchState).toHaveBeenCalledWith('mJTQjabTbjHqUpybIGVqqA','kieC6vVijImUZXUfaN8QOg');
        expect(el('connected-match').textContent).toContain('12/0 (0.3 ov)');
        expect(el<HTMLButtonElement>('build-copy').disabled).toBe(true);
        generate(); el<HTMLButtonElement>('build-copy').click();
        await vi.waitFor(()=>expect(writeText).toHaveBeenCalledWith('https://score.abhinav.dev/?matchId=mJTQjabTbjHqUpybIGVqqA&leagueId=kieC6vVijImUZXUfaN8QOg'));
        expect(el('connection-status').textContent).toContain('URL copied');
        enter('build-title','Final');
        expect(el<HTMLButtonElement>('build-copy').disabled).toBe(true);
        generate(); expect(el('build-url').textContent).toContain('title=Final');
        enter('match-url','https://cricclubs.com/other/results/new');
        expect(el<HTMLButtonElement>('build-generate').disabled).toBe(true);
        expect(el<HTMLInputElement>('build-club-id').value).toBe('');
    });
    it('reports invalid URLs without a network call',async()=>{
        enter('match-url','https://evil.test/results/m');await connect();
        expect(fetch).not.toHaveBeenCalled();expect(getMatchState).not.toHaveBeenCalled();
        expect(el('connection-status').textContent).toContain('Use an HTTPS match link');
    });
    it('requires a league after blocked discovery and validates a manual fallback',async()=>{
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({error:'HTTP 406 SEC001'}),{status:422}));
        enter('match-url',link);await connect();
        expect(el('connection-status').textContent).toContain('League ID required');
        expect(el<HTMLDetailsElement>('advanced-ids').open).toBe(true);
        expect(el<HTMLButtonElement>('build-generate').disabled).toBe(true);
        expect(getMatchState).not.toHaveBeenCalled();
        enter('build-club-id','manualLeague');await connect();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(getMatchState).toHaveBeenCalledWith('mJTQjabTbjHqUpybIGVqqA','manualLeague');
    });
    it('uses an explicit league from a URL without discovery',async()=>{
        enter('match-url',link+'&leagueId=explicit');await connect();
        expect(fetch).not.toHaveBeenCalled();expect(getMatchState).toHaveBeenCalledWith('mJTQjabTbjHqUpybIGVqqA','explicit');
    });
    it.each([new Error('fetch failed'),new CricClubsApiError('HTTP 406 SEC001',502),new DOMException('timed out','TimeoutError')])('hides technical failures and recovers on retry: %s',async error=>{
        vi.mocked(getMatchState).mockRejectedValueOnce(error);
        enter('match-url',link);await connect();
        expect(el('connection-status').textContent).toBe('The match is temporarily unavailable. Check your connection and retry.');
        expect(el<HTMLButtonElement>('build-generate').disabled).toBe(true);
        expect(el('connect-match').textContent).toBe('Retry connection');
        await connect();expect(el<HTMLButtonElement>('build-generate').disabled).toBe(false);
    });
    it('distinguishes invalid matches',async()=>{
        vi.mocked(getMatchState).mockRejectedValueOnce(new CricClubsApiError('unavailable',404));
        enter('match-url',link);await connect();expect(el('connection-status').textContent).toContain('Match not found');
    });
    it('ignores stale league responses when the URL changes during discovery',async()=>{
        let release!: (r:Response)=>void;
        vi.mocked(fetch).mockReturnValueOnce(new Promise(r=>{release=r;}));
        enter('match-url',link);el<HTMLButtonElement>('connect-match').click();
        expect(el('connection-status').textContent).toContain('Finding the league');
        enter('match-url','https://cricclubs.com/other/results/new');
        release(new Response(JSON.stringify({leagueId:'oldLeague'})));
        await vi.waitFor(()=>expect(el<HTMLButtonElement>('connect-match').disabled).toBe(false));
        expect(el<HTMLInputElement>('build-club-id').value).toBe('');expect(getMatchState).not.toHaveBeenCalled();
    });
    it('ignores stale match validation after IDs change',async()=>{
        let release!: (s:typeof state)=>void;
        vi.mocked(getMatchState).mockReturnValueOnce(new Promise(r=>{release=r;}));
        enter('match-url',link+'&leagueId=explicit');el<HTMLButtonElement>('connect-match').click();
        enter('build-club-id','changed');release(state);
        await vi.waitFor(()=>expect(el<HTMLButtonElement>('connect-match').disabled).toBe(false));
        expect(el<HTMLButtonElement>('build-generate').disabled).toBe(true);
        expect(el('connected-match').textContent).toBe('');
    });
    it('reports clipboard failure with a manual-copy fallback',async()=>{
        writeText.mockRejectedValueOnce(new Error('denied'));enter('match-url',link);await connect();generate();el<HTMLButtonElement>('build-copy').click();
        await vi.waitFor(()=>expect(showToast).toHaveBeenLastCalledWith('Copy failed. Select the link and copy it manually.','error'));
    });
    it('does nothing if the setup form is absent',()=>{document.body.innerHTML='';expect(()=>setupUrlBuilder()).not.toThrow();});
});
