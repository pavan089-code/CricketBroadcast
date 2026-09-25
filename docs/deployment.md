# Deployment — V1 release procedure

The intended production path is:

Browser → `https://score.abhinav.dev/api/cricclubs/*` → first-party Cloudflare Worker → CricClubs.

Netlify serves the static `dist/` site. Cloudflare must proxy `score.abhinav.dev` so the routes in `worker/wrangler.toml` intercept `/api/cricclubs/resolve*` and `/api/cricclubs/match*`, including query strings. A Netlify preview domain alone does not provide these Worker routes. `vite preview` also serves static files only; use `npm run dev` for local live API testing.

## Release only after approval

No deployment was performed during the final V1 pass. Run these steps only after review:

1. Use the approved upstream Git checkout and preserve its history. This workspace arrived without `.git`; the new local `.git` has no historical commits or remote. Import the reviewed source changes into the upstream checkout rather than replacing upstream history or force-pushing it.
2. From the project root, run `npm ci`, `npm test -- --run`, and `npm run build`. In `worker/`, run `npm ci`, `npm run typecheck`, and `npm run test:run`.
3. Confirm the Cloudflare account and the `abhinav.dev` zone, the existing D1 database ID in `worker/wrangler.toml`, and that the Netlify production project uses build command `npm run build` and publish directory `dist`. If its base directory points at the old nested folder, change it to the repository root. Do not change DNS unless inspection shows a separate, approved correction is necessary.
4. In `worker/`, authenticate with `npx wrangler login` if needed. Verify existing `VISITOR_SALT` and `STATS_KEY` secrets or Access settings; do not print secret values or rotate existing secrets unnecessarily. The CricClubs proxy needs no private credentials. `/stats` remains closed when neither Access nor a stats key is configured.
5. Apply the existing analytics migration, if pending: `npx wrangler d1 migrations apply overlay-analytics --remote`.
6. Deploy the Worker first: `npm run deploy` from `worker/`. This is the explicit production step; it was not run in this pass.
7. Verify the production resolve and match endpoints return JSON using a known valid match. Confirm invalid input produces a controlled response and no token is returned.
8. Merge/push the reviewed release through the upstream project's normal process to trigger the configured Netlify production build. Do not publish `worker/`, reference archives, or local QA fixtures as static assets.
9. At `https://score.abhinav.dev/`, connect a match, generate/copy its OBS URL, and test it in an OBS Browser Source at 1920×1080 and 1280×720. Confirm transparent composition, current-over order, event graphics, and recovery. Check `/stats` requires authorization.

The Cloudflare account, existing production DNS, Netlify settings, production secrets, and remote migration state must be inspected at release time; local configuration checks do not establish their current deployed state.

## Local validation

Use Node 24 (also used in `.github/workflows/ci.yml`). Run `npm run dev` for the first-party local proxy. A missing league ID is never guessed. The setup page resolves it from an explicit URL, a verified alias, or an unambiguous public-page value; blocked discovery requests manual entry.

For a local Worker runtime check, run `npm run dev -- --local --port 8787` inside `worker/`. This is local only and does not deploy. An upstream challenge or transient failure is a failed poll; the overlay retains the last valid frame.

The production Worker workflow is manual. Do not add deployment credentials or trigger it before release approval. A TLS failure should be fixed by trusting the appropriate organization CA, never by disabling certificate validation.
