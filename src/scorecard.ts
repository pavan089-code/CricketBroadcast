import { InningsScorecard, MatchState } from './cricclubs';

const cell = (tag: 'th' | 'td', value: string, className = ''): HTMLTableCellElement => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
};

function table(headers: string[], rows: string[][], className: string): HTMLTableElement {
    const element = document.createElement('table');
    element.className = className;
    const head = element.createTHead().insertRow();
    for (const heading of headers) head.appendChild(cell('th', heading));
    const body = element.createTBody();
    for (const values of rows) {
        const row = body.insertRow();
        values.forEach((value, index) => row.appendChild(cell('td', value, index === 0 ? 'player-cell' : '')));
    }
    return element;
}

function inningsPanel(innings: InningsScorecard, active: boolean): HTMLElement {
    const panel = document.createElement('section');
    panel.className = `scorecard-innings${active ? ' is-active' : ' is-complete'}`;
    const heading = document.createElement('div');
    heading.className = 'scorecard-innings-heading';
    const title = document.createElement('span');
    title.textContent = `${innings.number}${innings.number === 1 ? 'st' : innings.number === 2 ? 'nd' : 'th'} Innings · ${innings.battingTeam}`;
    const score = document.createElement('strong');
    score.textContent = `${innings.runs}/${innings.wickets}  (${innings.overs} ov)`;
    heading.append(title, score);
    panel.appendChild(heading);
    if (!active) return panel;

    const rate = document.createElement('p');
    rate.className = 'scorecard-rate';
    rate.textContent = innings.runRate === null ? '' : `CRR ${innings.runRate.toFixed(2)}`;
    panel.appendChild(rate);

    const grid = document.createElement('div');
    grid.className = 'scorecard-grid';
    const batting = document.createElement('div');
    const battingHeading = document.createElement('h3');
    battingHeading.textContent = 'Batting';
    batting.appendChild(battingHeading);
    batting.appendChild(table(['Batter', 'Dismissal', 'R', 'B', '4s', '6s', 'SR'], innings.batting.map(player => [
        `${player.name}${player.striker ? '  *' : ''}`,
        player.isOut ? player.dismissal || 'Out' : 'Not out',
        player.runs === null ? '—' : String(player.runs), player.balls === null ? '—' : String(player.balls),
        player.fours === null ? '—' : String(player.fours), player.sixes === null ? '—' : String(player.sixes),
        player.strikeRate === null ? '—' : player.strikeRate.toFixed(2),
    ]), 'scorecard-table batting-table'));
    grid.appendChild(batting);

    if (innings.extras) {
        const extras = document.createElement('p');
        extras.className = 'scorecard-extras';
        const breakdown = [
            ['Wides', innings.extras.wides], ['No-balls', innings.extras.noBalls],
            ['Byes', innings.extras.byes], ['Leg-byes', innings.extras.legByes],
        ].filter((item): item is [string, number] => typeof item[1] === 'number');
        extras.textContent = `Extras ${innings.extras.total}${breakdown.length ? `  (${breakdown.map(([label, value]) => `${label} ${value}`).join(', ')})` : ''}`;
        batting.appendChild(extras);
    }

    const total = document.createElement('p');
    total.className = 'scorecard-total';
    total.textContent = `TOTAL  ${innings.runs}/${innings.wickets}  ·  ${innings.overs} OV`;
    batting.appendChild(total);

    const bowling = document.createElement('div');
    const bowlingHeading = document.createElement('h3');
    bowlingHeading.textContent = 'Bowling';
    bowling.appendChild(bowlingHeading);
    bowling.appendChild(table(['Bowler', 'O', 'M', 'R', 'W', 'ECO'], innings.bowling.map(player => [
        player.name, player.overs, typeof player.maidens === 'number' ? String(player.maidens) : '—',
        String(player.runs), String(player.wickets), player.economy === null ? '—' : player.economy.toFixed(2),
    ]), 'scorecard-table bowling-table'));
    grid.appendChild(bowling);
    panel.appendChild(grid);
    return panel;
}

/** Paints the live scorecard from the same normalized state as the scorebug. */
export function renderFullScorecard(state: MatchState): void {
    const root = document.getElementById('scorecard-content');
    if (!root) return;
    const fragment = document.createDocumentFragment();
    const header = document.createElement('header');
    header.className = 'scorecard-header';
    if (state.match.tournament) {
        const tournament = document.createElement('p');
        tournament.className = 'scorecard-tournament';
        tournament.textContent = state.match.tournament;
        header.appendChild(tournament);
    }
    const teams = document.createElement('h1');
    teams.textContent = `${state.match.team1}  vs  ${state.match.team2}`;
    header.appendChild(teams);
    const details = document.createElement('p');
    details.className = 'scorecard-match-details';
    details.textContent = [state.match.matchType, state.match.overs ? `${state.match.overs} overs` : '', state.match.status, state.match.result].filter(Boolean).join(' · ');
    header.appendChild(details);
    fragment.appendChild(header);

    const currentNumber = state.innings.number;
    if (state.scorecard.length) {
        for (const innings of state.scorecard) fragment.appendChild(inningsPanel(innings, innings.number === currentNumber));
    } else {
        const empty = document.createElement('p');
        empty.className = 'scorecard-empty';
        empty.textContent = 'Waiting for the first delivery.';
        fragment.appendChild(empty);
    }
    if (state.match.target !== undefined || state.match.requiredRunRate !== undefined) {
        const chase = document.createElement('p');
        chase.className = 'scorecard-match-details';
        chase.textContent = [state.match.target !== undefined ? `Target ${state.match.target}` : '', state.match.requiredRunRate !== undefined ? `RRR ${state.match.requiredRunRate.toFixed(2)}` : ''].filter(Boolean).join(' · ');
        fragment.appendChild(chase);
    }
    root.replaceChildren(fragment);
}
