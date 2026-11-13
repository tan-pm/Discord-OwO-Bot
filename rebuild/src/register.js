const { DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, ALLOWED_GUILD_ID } = process.env;
if (!DISCORD_BOT_TOKEN || ![DISCORD_APPLICATION_ID, ALLOWED_GUILD_ID].every(value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value))) throw new Error('Missing or invalid Discord configuration');
const commands = ['help','balance','daily','hunt','zoo'].map(name => ({name,description:`OwO: ${name}`,type:1}));
const response = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${ALLOWED_GUILD_ID}/commands`,{method:'PUT',headers:{Authorization:`Bot ${DISCORD_BOT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(commands)});
if (!response.ok) throw new Error(`Registration failed: ${response.status}`);
console.log('Registered five guild commands.');
