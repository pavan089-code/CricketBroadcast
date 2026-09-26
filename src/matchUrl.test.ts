import { describe, expect, it } from 'vitest';
import { parseMatchUrl } from '../shared/matchUrl';

describe('CricClubs link parsing', () => {
    it.each([
        ['https://cricclubs.com/CarolinaCricket/fullScorecard.do?clubId=38131&matchId=24778', '24778'],
        ['https://www.carolinacricket.org/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131', '24780'],
    ])('extracts numeric IDs from verified installations: %s', (url, matchId) => {
        expect(parseMatchUrl(url)).toMatchObject({ matchId, leagueId: '38131' });
    });
    it.each([
        'https://www.carolinacricket.org.evil.test/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131',
        'https://evil.test/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131',
        'https://www.carolinacricket.org/other/viewScorecard.do?matchId=24780&clubId=38131',
        'https://www.carolinacricket.org:8443/CarolinaCricket/viewScorecard.do?matchId=24780&clubId=38131',
    ])('rejects unverified white-label links: %s', url => expect(() => parseMatchUrl(url)).toThrow());
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
