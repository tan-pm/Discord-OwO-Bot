/** Shared ingress contract; never accepts reward, clock, rank or balance inputs. */
export const MAX_BODY_BYTES = 16384;
export const SIGNATURE_WINDOW_SECONDS = 300;
export const ALIASES = Object.freeze({ balance: 'balance', bal: 'balance', cash: 'balance', daily: 'daily', hunt: 'hunt', h: 'hunt', zoo: 'zoo', z: 'zoo', help: 'help' });
const COMPONENTS = Object.freeze({ 'command:balance': 'balance', 'command:zoo': 'zoo', 'command:help': 'help' });
const snowflake = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
export class ContractError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'ContractError'; this.code = code; this.status = status; }
}
/** @typedef {{userId:string,guildId:string,channelId:string,commandName:string,args:[],triggerType:'prefix'|'slash'|'component',interactionId:string}} NormalizedCommandContext */
export function canonicalCommand(name) {
  if (typeof name !== 'string' || !Object.hasOwn(ALIASES, name.toLowerCase())) throw new ContractError('unsupported_command');
  return ALIASES[name.toLowerCase()];
}
function context(userId, guildId, channelId, commandName, args, triggerType, interactionId) {
  if (![userId, guildId, channelId, interactionId].every(snowflake) || !Array.isArray(args) || args.length) throw new ContractError('invalid_request');
  return Object.freeze({ userId, guildId, channelId, commandName, args: Object.freeze([]), triggerType, interactionId });
}
/** Validate configuration before comparing guilds. Placeholder values fail closed. */
export function assertAllowedGuild(guildId, configured) {
  if (!snowflake(configured)) throw new ContractError('misconfigured', 503);
  if (guildId !== configured) throw new ContractError('forbidden_guild', 403);
}
/** @returns {NormalizedCommandContext} */
export function normalizeRelay(input) {
  const keys = ['version', 'eventId', 'userId', 'guildId', 'channelId', 'commandName', 'args'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 || Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(input, key))) throw new ContractError('invalid_request');
  return context(input.userId, input.guildId, input.channelId, canonicalCommand(input.commandName), input.args, 'prefix', input.eventId);
}
/** Discord PING is handled by ingress before calling this function. @returns {NormalizedCommandContext} */
export function normalizeInteraction(input) {
  if (!input || typeof input !== 'object') throw new ContractError('invalid_request');
  let name;
  if (input.type === 2) {
    if (input.data?.type !== undefined && input.data.type !== 1) throw new ContractError('unsupported_command');
    if (input.data?.options !== undefined && (!Array.isArray(input.data.options) || input.data.options.length)) throw new ContractError('invalid_request');
    name = canonicalCommand(input.data?.name);
  } else if (input.type === 3) {
    if (input.data?.component_type !== 2 || !Object.hasOwn(COMPONENTS, input.data?.custom_id ?? '')) throw new ContractError('unsupported_component');
    name = COMPONENTS[input.data.custom_id];
  } else throw new ContractError('invalid_request');
  return context(input.member?.user?.id, input.guild_id, input.channel_id, name, [], input.type === 2 ? 'slash' : 'component', input.id);
}
/** Preserve old Discord receipt IDs; a prefix can never collide with a snowflake. */
export function receiptId(command) { return command.triggerType === 'prefix' ? `relay:${command.interactionId}` : command.interactionId; }
export function rpcParams(command) { return { interaction: receiptId(command), guild: command.guildId, player: command.userId, action: command.commandName }; }
export function messagePayload(content) { return { content, allowed_mentions: { parse: [] } }; }
