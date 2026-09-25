import { beforeEach, describe, expect, it } from 'vitest';
import { renderFullScorecard } from './scorecard';
import { MatchState } from './cricclubs';

describe('full scorecard rendering', () => {
    beforeEach(() => {
        document.body.innerHTML = '<section id="scorecard-overlay"><div id="scorecard-content"></div></section>';
    });

    it('shows the active innings, completed innings summary, extras, wickets and long names safely', () => {
        const state = {
            match: { id: 'm', team1: 'Hyderabad Warriors', team2: 'Rajasthan Royals', tournament: 'League Final', overs: 20, status: 'Live' },
            innings: { number: 2, battingTeam: 'Rajasthan Royals', bowlingTeam: 'Hyderabad Warriors', runs: 3, wickets: 1, overs: '0.1', runRate: 18 },
            scorecard: [
                { number: 1, battingTeam: 'Hyderabad Warriors', bowlingTeam: 'Rajasthan Royals', runs: 160, wickets: 7, overs: '20.0', runRate: 8, batting: [], bowling: [], completed: true },
                { number: 2, battingTeam: 'Rajasthan Royals', bowlingTeam: 'Hyderabad Warriors', runs: 3, wickets: 1, overs: '0.1', runRate: 18,
                    extras: { total: 1, wides: 1 }, completed: false,
                    batting: [{ name: 'An Extremely Long Player Name for a Narrow Broadcast Layout', runs: 3, balls: 1, fours: 0, sixes: 0, isOut: true, dismissal: 'Run out', strikeRate: 300, striker: true }],
                    bowling: [{ name: 'A Bowler', balls: 1, overs: '0.1', maidens: 0, runs: 3, wickets: 0, economy: 18 }],
                },
            ], currentOver: [], lastBall: null, event: null,
        } as MatchState;
        renderFullScorecard(state);
        const content = document.getElementById('scorecard-content')!;
        expect(content.textContent).toContain('League Final');
        expect(content.textContent).toContain('Hyderabad Warriors  vs  Rajasthan Royals');
        expect(content.textContent).toContain('160/7  (20.0 ov)');
        expect(content.textContent).toContain('Run out');
        expect(content.textContent).toContain('Extras 1  (Wides 1)');
        expect(content.textContent).toContain('A Bowler');
        expect(content.querySelector('.is-active')).not.toBeNull();
        expect(content.querySelector('.player-cell')?.textContent).toContain('An Extremely Long Player Name');
        expect(content.querySelectorAll('script')).toHaveLength(0);
    });

    it('renders empty innings data without inventing extras or optional statistics', () => {
        const state = {
            match: { id: 'm', team1: 'One', team2: 'Two', overs: null },
            innings: { number: 0, battingTeam: 'One', bowlingTeam: 'Two', runs: 0, wickets: 0, overs: '0.0', runRate: null },
            scorecard: [], currentOver: [], lastBall: null, event: null,
        } as MatchState;
        renderFullScorecard(state);
        expect(document.getElementById('scorecard-content')!.textContent).toContain('Waiting for the first delivery.');
        expect(document.getElementById('scorecard-content')!.textContent).not.toContain('Extras');
    });
});
