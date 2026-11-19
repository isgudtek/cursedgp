/**
 * Ably token server (Cloudflare Worker). The real Ably key is a secret of this Worker, never sent to a browser.
 * The game asks GET /token; the Worker answers with a signed Ably TokenRequest that expires after an hour.
 * The SDK then exchanges it with Ably for a token. Only the game's own origins may ask.
 */
const ALLOWED = ['https://isgudtek.github.io', 'http://localhost:5173', 'http://localhost:5180', 'http://localhost:5199'];
const TTL_MS = 60 * 60 * 1000;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    Vary: 'Origin',
  };
}

function b64(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'GET') return new Response('method not allowed', { status: 405, headers: cors(origin) });
    if (!ALLOWED.includes(origin)) return new Response('forbidden', { status: 403, headers: cors(origin) });
    const url = new URL(request.url);
    if (url.pathname !== '/token') return new Response('not found', { status: 404, headers: cors(origin) });

    // The secret is "appId.keyId:secret"; the key name is the part before the colon.
    const [keyName, secret] = String(env.ABLY_KEY).split(':');
    const clientId = (url.searchParams.get('clientId') || '').slice(0, 40);
    const capability = JSON.stringify({ '*': ['publish', 'subscribe', 'presence'] });
    const ttl = String(TTL_MS);
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID().replace(/-/g, '');
    // Ably's signing string for a TokenRequest: each field on its own line.
    const text = `${keyName}\n${ttl}\n${capability}\n${clientId}\n${timestamp}\n${nonce}\n`;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
    const body = { keyName, ttl: TTL_MS, capability, timestamp: Number(timestamp), nonce, mac };
    if (clientId) body.clientId = clientId;
    return new Response(JSON.stringify(body), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) },
    });
  },
};
