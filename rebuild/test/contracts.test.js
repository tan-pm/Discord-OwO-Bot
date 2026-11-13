import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInteraction,normalizeRelay,rpcParams,receiptId,ALIASES} from '../src/contracts/commands.js';
const ids={userId:'2',guildId:'3',channelId:'4'};
const relay=name=>({version:1,eventId:'1',...ids,commandName:name,args:[]});
const slash=name=>({id:'1',type:2,guild_id:'3',channel_id:'4',member:{user:{id:'2'}},data:{name}});
for(const [alias,canonical]of Object.entries(ALIASES))test(`normalization parity ${alias}`,()=>{
 const a=normalizeInteraction(slash(alias)),b=normalizeRelay(relay(alias));
 assert.deepEqual(Object.keys(a),['userId','guildId','channelId','commandName','args','triggerType','interactionId']);
 assert.deepEqual({...a,triggerType:'prefix'},b);assert.equal(a.commandName,canonical);
 assert.deepEqual(rpcParams(a),{interaction:'1',guild:'3',player:'2',action:canonical});assert.equal(receiptId(b),'relay:1');assert.equal(Object.isFrozen(a),true);assert.equal(Object.isFrozen(a.args),true);
});
for(const field of ['rank','reward','clock','action','receiptId','balance'])test(`unknown authority field ${field} rejected`,()=>assert.throws(()=>normalizeRelay({...relay('daily'),[field]:999}),{code:'invalid_request'}));
test('component normalization uses interaction identity and readonly action',()=>{const input={...slash(),type:3,data:{component_type:2,custom_id:'command:balance'},message:{id:'999'}};assert.deepEqual(rpcParams(normalizeInteraction(input)),{interaction:'1',guild:'3',player:'2',action:'balance'});for(const custom_id of ['command:daily','command:hunt'])assert.throws(()=>normalizeInteraction({...input,data:{component_type:2,custom_id}}),{code:'unsupported_component'});});
