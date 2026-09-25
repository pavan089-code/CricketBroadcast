import { describe, expect, it } from 'vitest';
import { parseMatchUrl } from '../shared/matchUrl';

describe('CricClubs link parsing', () => {
    it('extracts a results match and league slug without inventing an ID', () => {
        expect(parseMatchUrl('https://cricclubs.com/chevva/results/abc_123?tab=full_scorecard'))
            .toEqual({ matchId: 'abc_123', slug: 'chevva', leagueId: undefined });
    });
    it('accepts explicit league IDs and legacy club query links', () => {
        expect(parseMatchUrl('https://cricclubs.com/x/results/m?leagueId=l').leagueId).toBe('l');
        expect(parseMatchUrl('https://www.cricclubs.com/x/viewScorecard.do?matchId=123&clubId=456'))
            .toMatchObject({ matchId: '123', leagueId: '456' });
    });
    it.each(['https://cricclubs.com.evil.test/x/results/m', 'https://user:pass@cricclubs.com/x/results/m', 'http://cricclubs.com/x/results/m', 'https://cricclubs.com/', 'https://cricclubs.com/x/results/..', 'https://cricclubs.com/x/results/a%2Fb'])('rejects invalid or untrusted links: %s', value => {
        expect(() => parseMatchUrl(value)).toThrow();
    });
});
