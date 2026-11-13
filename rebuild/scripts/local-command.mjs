import { createHmac, randomInt } from 'node:crypto';
import { normalizeRelay } from '../src/contracts/commands.js';

const usage = 'Usage: npm run local:command -- <help|balance|daily|hunt|zoo> <user-id> <channel-id> [event-id]';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3 || args.length > 4) throw new Error(usage);
  const [commandName, userId, channelId, suppliedId] = args;
  const port = process.env.OWO_LOCAL_PORT ?? '8787';
  if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) throw new Error('Invalid OWO_LOCAL_PORT.');
  const secret = process.env.RELAY_SHARED_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) {
    throw new Error('Fill RELAY_SHARED_SECRET in .env (at least 32 UTF-8 bytes).');
  }
  // A synthetic snowflake for local receipts; print it so retries can reuse it.
  const eventId = suppliedId ?? String((BigInt(Date.now() - 1420070400000) << 22n) | BigInt(randomInt(4194304)));
  const envelope = { version: 1, eventId, userId, guildId: process.env.ALLOWED_GUILD_ID, channelId, commandName, args: [] };
  try { normalizeRelay(envelope); }
  catch { throw new Error(`Invalid command or Discord IDs. Fill ALLOWED_GUILD_ID in .env. ${usage}`); }

  const body = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
  console.log(`Local event ID: ${eventId} (reuse this ID to retry the same command)`);
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/relay`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'X-Relay-Timestamp': timestamp, 'X-Relay-Signature': signature },
      body
    });
  } catch { throw new Error('Cannot reach the local Worker. Start npm run dev; retry with the same event ID if the response timed out.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(`Worker HTTP ${response.status}: ${result.error ?? 'request_failed'}`);
  console.log(result.content);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
