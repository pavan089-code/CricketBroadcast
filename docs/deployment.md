# Deployment — V1 release procedure

The current V1 production path is:

Browser → Netlify same-origin `/api/*` rewrites → `https://overlay-analytics.23eg107d09.workers.dev` → CricClubs.

Netlify serves the static `dist/` site and proxies `/api/cricclubs/*`, `/api/collect`, and `/stats*` using `netlify.toml`. The Worker is initially exposed through `workers.dev`; no custom domain or DNS route is required. `vite preview` serves static files only; use `npm run dev` for local live API testing.

## Release only after approval

Run these steps for an approved release:

1. Use `pavan089-code/CricketBroadcast`, production branch `master`, and preserve its history. The Netlify project is `stupendous-centaur-21db85` (site ID `9415985f-531e-4a22-8722-521500bc48e7`), serving `https://stupendous-centaur-21db85.netlify.app`. Never force-push a release.
2. From the project root, run `npm ci`, `npm test -- --run`, and `npm run build`. In `worker/`, run `npm ci`, `npm run typecheck`, and `npm run test:run`.
3. Confirm the Cloudflare account, the `workers.dev` subdomain, the D1 database ID in `worker/wrangler.toml`, and that Netlify reads build command `npm run build` and publish directory `dist` from `netlify.toml`. The project uses the repository root and Node 24. No frontend environment variables are required. Do not configure a custom domain or DNS route during this phase.
4. In `worker/`, authenticate with `npx wrangler login` if needed. Verify existing `VISITOR_SALT` and `STATS_KEY` secrets or Access settings; do not print secret values or rotate existing secrets unnecessarily. The CricClubs proxy needs no private credentials. `/stats` remains closed when neither Access nor a stats key is configured.
5. Apply the existing analytics migration, if pending: `npx wrangler d1 migrations apply overlay-analytics --remote`.
6. Deploy the Worker first: `npm run deploy` from `worker/`.
7. Verify the production resolve and match endpoints return JSON using a known valid match. Confirm invalid input produces a controlled response and no token is returned.
8. Merge/push the reviewed release through the upstream project's normal process to trigger the configured Netlify production build. Do not publish `worker/`, reference archives, or local QA fixtures as static assets.
9. At the Netlify production URL, connect a match, generate/copy its OBS URL, and test it in an OBS Browser Source at 1920×1080 and 1280×720. Confirm transparent composition, current-over order, event graphics, and recovery. Check `/stats` requires authorization.

The Cloudflare account, existing production DNS, Netlify settings, production secrets, and remote migration state must be inspected at release time; local configuration checks do not establish their current deployed state.

## Local validation

Use Node 24 (also used in `.github/workflows/ci.yml`). Run `npm run dev` for the first-party local proxy. A missing league ID is never guessed. The setup page resolves it from an explicit URL, a verified alias, or an unambiguous public-page value; blocked discovery requests manual entry.

For a local Worker runtime check, run `npm run dev -- --local --port 8787` inside `worker/`. This is local only and does not deploy. An upstream challenge or transient failure is a failed poll; the overlay retains the last valid frame.

The production Worker workflow is manual. Do not add deployment credentials or trigger it before release approval. A TLS failure should be fixed by trusting the appropriate organization CA, never by disabling certificate validation.
