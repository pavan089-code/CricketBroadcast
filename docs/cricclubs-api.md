# CricClubs V1 API path

The browser calls only `/api/cricclubs/resolve` and `/api/cricclubs/match` on its own origin. `vite.config.ts` implements the local proxy; `worker/src/resolve.ts` and `worker/src/cricclubs.ts` implement production routes.

The server fetches current match information and commentary concurrently. Each upstream request generates fresh RSA/PKCS#1 v1.5 authentication material from CricClubs' public key and the current time. No captured tokens, login cookies, or private keys are required. The implementation belongs only in server code.

`shared/matchUrl.ts` accepts HTTPS CricClubs result links and legacy matchId/clubId query links. Resolution uses explicit league IDs, verified aliases, or a single unambiguous league identifier from the public match page. Restricted or ambiguous pages return manual-entry guidance. There is no default league in live overlay requests.

`src/cricclubs.ts` normalizes newest-first commentary into chronological delivery order, ignores Auto Comment Ball records, and selects the latest innings with real delivery or non-zero score/overs data. An empty future innings cannot replace an active innings. Player summaries from a different team are ignored. The UI bridge supplies the existing scorebug and event-card components.

`src/app.ts` polls after the previous request completes, deduplicates events by ball ID, and retains the last valid frame across failed requests. Browser requests have a 20-second timeout; upstream proxy requests have a 12-second timeout. Setup uses a separate 15-second resolution timeout and user-facing retry messages.

FOUR, SIX and WICKET are supported for the live feed. Existing legacy sample/replay modes remain development aids; no replay features were added in V1 completion. See [deployment.md](deployment.md) for production routing and release checks.
