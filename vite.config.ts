import { constants, publicEncrypt } from 'node:crypto';
import { defineConfig } from 'vite';
import { handleResolve } from './worker/src/resolve';

const CORE_ORIGIN = 'https://core-prod-origin.cricclubs.com';
const PUBLIC_KEY_B64 = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCNokj65NYc9LdYZshBi6I1BUVu8NdhcafSkzSugFVwUydw7t2DPaZcewxkko3G2R/0OS8s7ceSV/p4zljtgCNtls5A6TT2Ehsoxhqh6PHRRuK4gvhPn8gYtBXjQHkj0VWkr9VoPdEt3NQIr0MkBmwAgt5YkTCV1EZPOAnsLSnQrwIDAQAB';
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${PUBLIC_KEY_B64.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----\n`;
const OFFICIAL_HEADERS = {
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://app.cricclubs.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

function contentToken(): string {
    return publicEncrypt({ key: PUBLIC_KEY_PEM, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(`core-${Date.now()}`)).toString('base64');
}

function validId(value: string | null): value is string {
    return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

async function upstream(url: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { ...OFFICIAL_HEADERS, 'x-content-token': contentToken() } });
        if (!response.ok) return { ok: false, status: response.status };
        try {
            return { ok: true, data: await response.json() };
        } catch (error) {
            console.error(`CricClubs returned malformed JSON for ${new URL(url).pathname}:`, error);
            return { ok: false, status: 502 };
        }
    } catch (error) {
        console.error(`Could not reach CricClubs for ${new URL(url).pathname}:`, error);
        return { ok: false, status: 502 };
    }
}

export default defineConfig({
    base: './', // Important for relative paths in overlays
    build: {
        outDir: 'dist',
    },
    plugins: [{
        name: 'cricclubs-local-proxy',
        // Local equivalent of worker/src/cricclubs.ts. Browser requests remain same-origin,
        // while Node generates the short-lived public-key token upstream requires.
        configureServer(server) {
            server.middlewares.use('/api/cricclubs/resolve', async (request, response) => {
                const result = await handleResolve(new Request(new URL(request.url || '/', 'http://localhost'), { method: request.method }));
                response.writeHead(result.status, Object.fromEntries(result.headers));
                response.end(await result.text());
            });
            server.middlewares.use('/api/cricclubs/match', async (request, response) => {
                if (request.method !== 'GET') {
                    response.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
                    response.end(JSON.stringify({ error: 'Method not allowed.' }));
                    return;
                }
                const url = new URL(request.url ?? '/', 'http://localhost');
                const matchId = url.searchParams.get('matchId');
                const leagueId = url.searchParams.get('leagueId') ?? url.searchParams.get('clubId');
                if (!validId(matchId) || !validId(leagueId)) {
                    response.writeHead(400, { 'Content-Type': 'application/json' });
                    response.end(JSON.stringify({ error: 'A valid matchId and leagueId are required.' }));
                    return;
                }

                const matchParams = new URLSearchParams({ clubId: leagueId, matchId });
                const commentaryParams = new URLSearchParams({ leagueId });
                const [matchInfo, commentary] = await Promise.all([
                    upstream(`${CORE_ORIGIN}/core/public/match/getMatchInfo?${matchParams}`),
                    upstream(`${CORE_ORIGIN}/core/public/series/match/${encodeURIComponent(matchId)}/scorecard/commentary?${commentaryParams}`),
                ]);
                const failed = !matchInfo.ok ? matchInfo : !commentary.ok ? commentary : null;
                if (failed) {
                    const status = failed.status === 406 ? 502 : failed.status;
                    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    response.end(JSON.stringify({ error: `CricClubs request failed with HTTP ${failed.status}.`, upstreamStatus: failed.status }));
                    return;
                }
                response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify({ matchInfo: matchInfo.data, commentary: commentary.data }));
            });
        },
    }],
});
