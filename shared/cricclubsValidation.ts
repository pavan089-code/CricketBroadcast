function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Both API families must supply real team metadata and a usable innings object. */
export function validMatchPayload(matchInfo: unknown, commentary: unknown): boolean {
    const info = record(record(matchInfo)?.data);
    const balls = record(record(commentary)?.data);
    if (!info || !balls) return false;
    const named = (names: string[]) => names.some(key => typeof info[key] === 'string' && (info[key] as string).trim());
    if (!named(['team1Name', 't1Name', 'teamOneName', 'firstTeamName', 'homeTeamName'])
        || !named(['team2Name', 't2Name', 'teamTwoName', 'secondTeamName', 'awayTeamName'])) return false;
    return Object.entries(balls).some(([key, value]) => {
        const innings = record(value);
        return /^innings\d+Balls$/i.test(key) && innings !== null
            && typeof innings.teamName === 'string' && !!innings.teamName.trim()
            && record(innings.oversMap) !== null;
    });
}
