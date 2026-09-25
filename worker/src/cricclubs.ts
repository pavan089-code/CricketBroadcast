/**
 * First-party proxy for the current CricClubs public endpoints.
 *
 * CricClubs requires a fresh `x-content-token`: RSA/PKCS#1 v1.5 encryption of
 * `core-<epoch_ms>` with the public key shipped by its web application. No
 * credentials, cookies, or private keys are involved. Keeping the generated
 * token here also avoids the upstream API's missing CORS headers in OBS.
 */
const CORE_ORIGIN = 'https://core-prod-origin.cricclubs.com';
const MODULUS = BigInt('0x8da248fae4d61cf4b75866c8418ba23505456ef0d76171a7d29334ae805570532770eedd833da65c7b0c64928dc6d91ff4392f2cedc79257fa78ce58ed80236d96ce40e934f6121b28c61aa1e8f1d146e2b882f84f9fc818b415e3407923d155a4afd5683dd12ddcd408af4324066c0082de58913095d4464f3809ec2d29d0af');
const EXPONENT = 65537n;
const KEY_BYTES = 128;
const OFFICIAL_REFERER = 'https://app.cricclubs.com/';
const OFFICIAL_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
};

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
    let result = 1n;
    let factor = base % modulus;
    let power = exponent;
    while (power > 0n) {
        if (power & 1n) result = (result * factor) % modulus;
        power >>= 1n;
        factor = (factor * factor) % modulus;
    }
    return result;
}

/** Creates a one-use token. It is intentionally neither logged nor returned. */
export function createContentToken(now = Date.now()): string {
    const message = new TextEncoder().encode(`core-${now}`);
    const paddingLength = KEY_BYTES - 3 - message.length;
    if (paddingLength < 8) throw new Error('CricClubs token message is too long.');

    const padding = new Uint8Array(paddingLength);
    crypto.getRandomValues(padding);
    for (let index = 0; index < padding.length; index++) {
        while (padding[index] === 0) crypto.getRandomValues(padding.subarray(index, index + 1));
    }

    const encodedMessage = new Uint8Array(KEY_BYTES);
    encodedMessage[1] = 2;
    encodedMessage.set(padding, 2);
    encodedMessage[2 + paddingLength] = 0;
    encodedMessage.set(message, 3 + paddingLength);

    let numericMessage = 0n;
    for (const byte of encodedMessage) numericMessage = (numericMessage << 8n) | BigInt(byte);
    let encrypted = modPow(numericMessage, EXPONENT, MODULUS);
    const bytes = new Uint8Array(KEY_BYTES);
    for (let index = KEY_BYTES - 1; index >= 0; index--) {
        bytes[index] = Number(encrypted & 0xffn);
        encrypted >>= 8n;
    }
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function validId(value: string | null): value is string {
    return value !== null && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
    });
}

async function upstreamJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
    let response: Response;
    try {
        response = await fetch(url, {
            signal: AbortSignal.timeout(12000),
            headers: {
                'x-content-token': createContentToken(),
                Accept: 'application/json, text/plain, */*',
                Referer: OFFICIAL_REFERER,
                'User-Agent': OFFICIAL_USER_AGENT,
            },
        });
    } catch {
        return { ok: false, status: 502 };
    }
    if (!response.ok) return { ok: false, status: response.status };
    try {
        const data = await response.json() as Record<string, unknown>;
        if (data?.errorCode && data.errorCode !== '0') return { ok: false, status: 502 };
        return { ok: true, data };
    } catch {
        return { ok: false, status: 502 };
    }
}

/** Handles GET /api/cricclubs/match?matchId=…&leagueId=…. */
export async function handleCricClubs(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

    const url = new URL(request.url);
    const matchId = url.searchParams.get('matchId');
    const leagueId = url.searchParams.get('leagueId') ?? url.searchParams.get('clubId');
    if (!validId(matchId) || !validId(leagueId)) return json({ error: 'A valid matchId and leagueId are required.' }, 400);

    const matchParams = new URLSearchParams({ clubId: leagueId, matchId });
    const commentaryParams = new URLSearchParams({ leagueId });
    const [matchInfo, commentary] = await Promise.all([
        upstreamJson(`${CORE_ORIGIN}/core/public/match/getMatchInfo?${matchParams}`),
        upstreamJson(`${CORE_ORIGIN}/core/public/series/match/${encodeURIComponent(matchId)}/scorecard/commentary?${commentaryParams}`),
    ]);

    if (!matchInfo.ok) return upstreamFailure(matchInfo.status);
    if (!commentary.ok) return upstreamFailure(commentary.status);
    return json({ matchInfo: matchInfo.data, commentary: commentary.data });
}

function upstreamFailure(upstreamStatus: number): Response {
    const status = upstreamStatus === 406 ? 502 : upstreamStatus;
    return json({ error: `CricClubs request failed with HTTP ${upstreamStatus}.`, upstreamStatus }, status);
}
