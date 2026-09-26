# CricClubs V1 API path

The browser calls only `/api/cricclubs/resolve` and `/api/cricclubs/match` on its own origin. `vite.config.ts` implements the local proxy; `worker/src/resolve.ts` and `worker/src/cricclubs.ts` implement production routes.

The server fetches current match information and commentary concurrently. Each upstream request generates fresh RSA/PKCS#1 v1.5 authentication material from CricClubs' public key and the current time. No captured tokens, login cookies, or private keys are required. The implementation belongs only in server code. Vite reuses the Worker handler so development and production use the same routes and validation.

`shared/matchUrl.ts` accepts HTTPS CricClubs result links and legacy matchId/clubId query links. Verified custom domains are registered with an exact league path (`carolinacricket.org` and `www.carolinacricket.org` currently). Unknown hosts, credentials, non-HTTPS links and custom ports are rejected. This registry never selects a network destination: upstream requests always go to the fixed official API host, and upstream redirects are never followed. Additional custom domains require verification and a registry entry, not new match-handling code. Resolution uses explicit league IDs, verified aliases, or a single unambiguous league identifier from the public match page. Restricted or ambiguous pages return manual-entry guidance. There is no default league in live overlay requests.

## Numeric-ID compatibility and failure trace (2026-09-26)

1. `fullScorecard.do?clubId=38131&matchId=24778` correctly parsed as match `24778`, league `38131`. Explicit IDs bypass `/resolve`.
2. Setup called `getMatchState`, issuing same-origin `GET /api/cricclubs/match?matchId=24778&leagueId=38131`, with no request body or upstream token in the browser.
3. The old server sent these numeric IDs to `https://core-prod-origin.cricclubs.com/core/public/match/getMatchInfo?clubId=38131&matchId=24778` and `/core/public/series/match/24778/scorecard/commentary?leagueId=38131`.
4. Token creation succeeded. Requests carried fresh `x-content-token`, `Accept: application/json, text/plain, */*`, `Referer: https://app.cricclubs.com/` and the existing browser User-Agent; no cookies or credentials.
5. Match-info returned **HTTP 200 with an empty body and no Content-Type**. JSON parsing failed and the proxy produced 502. Commentary separately returned **HTTP 400**, JSON `message.text: "Invalid match id."`. Both 24778 and 24780 exhibited this behavior. This indicates the wrong identifier/API family, not an invalid match.
6. The frontend rejected the proxy's 502 before normalization and displayed its existing temporary-unavailability/retry message. That message is unchanged.

The official [CricClubs app](https://app.cricclubs.com/) uses numeric-ID endpoints. For a numeric match/league pair the proxy now issues:

```text
GET /core/match/getMatchInfo?clubId=<leagueId>&matchId=<matchId>&X-Auth-Token=null
GET /core/scoreCard/getBallByBall?clubId=<leagueId>&matchId=<matchId>&X-Auth-Token=null
```

The literal `null` is the official app's anonymous query value, not a captured authentication token. The fresh RSA content-token header is still generated server-side for each request. Opaque-ID links continue to use the original `/core/public/` endpoints. No league or match is special-cased in API routing.

Both API families must provide named teams and a usable innings/overs map. Legacy deliveries omit `ballId`, `isFour`, `isSix` and `outMethod`; the adapter uses validated creation timestamps plus innings/over/ball for stable identity, and the upstream's boundary/wicket markers. Auto comments remain excluded. Numeric roster IDs are supported. Raw commentary HTML is never rendered. Scores are read from upstream innings/over totals; no score or delivery is synthesized.

Live verification through the updated parser → Worker handler → real upstream → `getMatchState` succeeded with HTTP 200 from both endpoints:

| Match | Observed normalized state |
| --- | --- |
| 24778 / 38131 | Eagles vs Tigers, Eagles 174/2 (28.3 overs) |
| 24780 / 38131 | Gujarat Titans vs Pirates, GT 177/8 (20 overs) |
| mJTQjabTbjHqUpybIGVqqA / kieC6vVijImUZXUfaN8QOg | Hyderabad Warriors vs Rajasthan Royals, 57/1 (2.5 overs) |

These are point-in-time observations, not fixed expected live scores. Frontend and Worker regressions use reduced captured responses under `shared/fixtures`, never a runtime data fallback. Setup regressions exercise the actual adapter and form. Deployment is a separate step; the live checks execute the changed handler locally against the real upstream, not a deployed Cloudflare Worker.

## Controlled diagnostics

Set `CRICCLUBS_DIAGNOSTICS=true` in the Vite process environment or Worker variables. Default is off; no request query can enable it. Logs contain resolved IDs, ID family, fixed host, endpoint path, token-generation success, exact HTTP status, Content-Type, body length, response classification and match-validation result. Bodies, headers, credentials and token values are never logged. HTML, empty bodies, malformed JSON, unsuccessful JSON envelopes and network failures are distinguished; 401/403/404/406/5xx retain their exact upstream status in diagnostics (406 is still translated to proxy 502).

The public HTML scorecard pages themselves returned Cloudflare HTTP 403 challenge pages during inspection. The verified API calls succeeded and do not require scraping or bypassing those challenges. Unregistered custom domains and any installations not backed by the supported official APIs remain unsupported until verified.

Verification after the change: `npm run build` passed the frontend strict typecheck,
216 tests and production Vite build; Worker `npm run test:run` passed 57 tests and
`npm run typecheck` passed. The four Python highlight test scripts also passed
all 82 tests using their standalone runners. `git diff --check` passed.

`src/cricclubs.ts` normalizes newest-first commentary into chronological delivery order, ignores Auto Comment Ball records, and selects the latest innings with real delivery or non-zero score/overs data. An empty future innings cannot replace an active innings. Player summaries from a different team are ignored. The UI bridge supplies the existing scorebug and event-card components.

`src/app.ts` polls after the previous request completes, deduplicates events by ball ID, and retains the last valid frame across failed requests. Browser requests have a 20-second timeout; upstream proxy requests have a 12-second timeout. Setup uses a separate 15-second resolution timeout and user-facing retry messages.

FOUR, SIX and WICKET are supported for the live feed. Existing legacy sample/replay modes remain development aids; no replay features were added in V1 completion. See [deployment.md](deployment.md) for production routing and release checks.
