import { MAX_BODY_BYTES, SIGNATURE_WINDOW_SECONDS, ContractError, assertAllowedGuild, normalizeRelay, normalizeInteraction, rpcParams, messagePayload } from './contracts/commands.js';

const encoder = new TextEncoder();
const FAILURE = 'Không thể xử lý lúc này. Hãy thử lại sau.';
const HELP = '/balance • /daily • /hunt • /zoo';
const snowflake = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const hexBytes = hex => Uint8Array.from(hex.match(/../g), value => parseInt(value, 16));
const fresh = (timestamp, nowSeconds = Date.now() / 1000) => typeof timestamp === 'string' && /^[0-9]{1,12}$/.test(timestamp) && Math.abs(nowSeconds - Number(timestamp)) <= SIGNATURE_WINDOW_SECONDS;
const errorResponse = (status, code) => Response.json({ error: code }, { status });
const placeholder = value => /(?:your[_ -]|replace[_ -]?me|change[_ -]?me|placeholder|example|<|>)/i.test(value);
const validKey = key => typeof key === 'string' && /^[a-f0-9]{64}$/i.test(key);

/** Verify Discord's signature over the exact timestamp and raw body. */
export async function verify(request, body, publicKey, nowSeconds = Date.now() / 1000) {
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  if (!fresh(timestamp, nowSeconds) || !/^[a-f0-9]{128}$/i.test(signature || '') || !validKey(publicKey)) return false;
  try {
    const key = await crypto.subtle.importKey('raw', hexBytes(publicKey), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hexBytes(signature), encoder.encode(timestamp + body));
  } catch { return false; }
}

export async function verifyRelay(request, body, secret, nowSeconds = Date.now() / 1000) {
  const timestamp = request.headers.get('x-relay-timestamp');
  const signature = request.headers.get('x-relay-signature');
  if (!fresh(timestamp, nowSeconds) || !/^[a-f0-9]{64}$/i.test(signature || '') || typeof secret !== 'string' || encoder.encode(secret).byteLength < 32) return false;
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, hexBytes(signature), encoder.encode(timestamp + '.' + body));
  } catch { return false; }
}

async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length && /^[0-9]+$/.test(length) && Number(length) > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => {});
    throw new ContractError('body_too_large', 413);
  }
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ContractError('body_too_large', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } finally { reader.releaseLock(); }
}

function databaseKey(env) {
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof key !== 'string' || !key.trim() || placeholder(key) || /\s/.test(key)
    || (env.SUPABASE_SECRET_KEY !== undefined && !/^sb_secret_[A-Za-z0-9_-]+$/.test(key))) {
    throw new ContractError('misconfigured', 503);
  }
  return key;
}

function databaseURL(env) {
  try {
    const url = new URL(env.SUPABASE_URL);
    if (placeholder(env.SUPABASE_URL) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/?$/.test(url.pathname)) throw new Error();
    databaseKey(env);
    return `${url.origin}/rest/v1/rpc/play`;
  } catch { throw new ContractError('misconfigured', 503); }
}

async function play(command, env, url) {
  const key = databaseKey(env);
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    // New Supabase secret keys are opaque API keys, not bearer JWTs.
    headers: { apikey: key, ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(rpcParams(command))
  });
  if (!response.ok) throw new Error('rpc_failed');
  const content = await response.json();
  if (typeof content !== 'string' || !content.length || content.length > 2000) throw new Error('invalid_rpc_response');
  return content;
}

function webhookURL(input) {
  if (!snowflake(input.application_id) || typeof input.token !== 'string' || !/^[A-Za-z0-9._-]{1,256}$/.test(input.token)) throw new ContractError('invalid_request');
  return `https://discord.com/api/v10/webhooks/${input.application_id}/${input.token}/messages/@original`;
}

async function complete(command, env, rpcURL, deliveryURL) {
  let content;
  try { content = await play(command, env, rpcURL); }
  catch { content = FAILURE; }
  try {
    const response = await fetch(deliveryURL, { method: 'PATCH', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(messagePayload(content)) });
    if (!response.ok) console.error('Discord delivery failed', response.status);
  } catch { console.error('Discord delivery failed'); }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method !== 'POST' || !['/', '/interactions', '/relay'].includes(path)) return errorResponse(404, 'not_found');
    const relay = path === '/relay';
    try {
      // Each route accepts only its own authentication configuration and headers.
      const validRelaySecret = typeof env.RELAY_SHARED_SECRET === 'string'
        && encoder.encode(env.RELAY_SHARED_SECRET).byteLength >= 32
        && !placeholder(env.RELAY_SHARED_SECRET);
      if (relay ? !validRelaySecret : !validKey(env.DISCORD_PUBLIC_KEY)) {
        throw new ContractError('misconfigured', 503);
      }
      const body = await readBody(request);
      if (!await (relay ? verifyRelay(request, body, env.RELAY_SHARED_SECRET) : verify(request, body, env.DISCORD_PUBLIC_KEY))) return errorResponse(401, 'unauthorized');
      let input;
      try { input = JSON.parse(body); } catch { throw new ContractError('invalid_request'); }
      if (!relay && input?.type === 1) return Response.json({ type: 1 });
      if (!snowflake(env.ALLOWED_GUILD_ID)) throw new ContractError('misconfigured', 503);
      const command = relay ? normalizeRelay(input) : normalizeInteraction(input);
      assertAllowedGuild(command.guildId, env.ALLOWED_GUILD_ID);
      if (command.commandName === 'help') return Response.json(relay ? messagePayload(HELP) : { type: 4, data: messagePayload(HELP) });
      const rpcURL = databaseURL(env);
      if (relay) {
        try { return Response.json(messagePayload(await play(command, env, rpcURL))); }
        catch { return errorResponse(503, 'upstream_unavailable'); }
      }
      const deliveryURL = webhookURL(input);
      ctx.waitUntil(complete(command, env, rpcURL, deliveryURL));
      return Response.json({ type: 5 });
    } catch (error) {
      if (error instanceof ContractError) return errorResponse(error.status, error.code);
      return errorResponse(400, 'invalid_request');
    }
  }
};
