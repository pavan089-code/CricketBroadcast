/** Public league IDs, verified from match URLs. These are identifiers, not credentials.
 * CricClubs results URLs omit this ID; public page lookup may be challenge-protected.
 * Add only verified slug → ID pairs. Unknown leagues use page lookup / explicit IDs.
 */
export const LEAGUE_ALIASES: Readonly<Record<string, string>> = {
    chevva: 'kieC6vVijImUZXUfaN8QOg',
};
