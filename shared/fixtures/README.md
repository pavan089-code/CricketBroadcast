These are reduced **real public upstream responses**, captured on 2026-09-26
from CricClubs' numeric-ID `getMatchInfo` and `getBallByBall` endpoints for club
38131. They are test fixtures only, never used as live fallback data.

Unneeded match metadata, player profile URLs, team logo URLs and empty delivery
pitch/direction fields were removed. Scores, delivery order, timestamps, IDs,
commentary and player figures retain the upstream values.

- 24778: Eagles vs Tigers, Eagles 172/2 after 28 overs.
- 24780: Gujarat Titans vs Pirates, Gujarat Titans 177/8 after 20 overs.

Later live checks can show different scores. These fixtures cover numeric player
IDs, deliveries without ballId, boundaries and wickets without explicit flags,
auto comments, extras and pre-created future innings.
