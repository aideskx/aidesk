// Local metadata owner. Never traverses task workspaces or removes host chats.
// CLI authorization is explicit local maintenance, not cloud account authority.
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { readPrivateJson, writePrivateJsonExclusive, removePrivateJson, verifyPrivateDirectory, ensurePrivateDirectory } from './host-data-binding.mjs';
import { withHostTaskScope, readHostTaskTombstone, hostTaskScopeId } from './host-task-scope.mjs';
import { readHostSource, validateTaskContextIdentity } from '../domain/host-task-contract.mjs';
import { exportRecoveryLedger, cleanRecoveryLedger } from './recovery-ledger.mjs';
import { exportDataExportEvidence } from './host-data-access.mjs';
import { sha256, toolFromEvent } from './contract.mjs';
import { splitGoalMcpRequest, parseGoalDataDeleteInput, validGoalDataDeleteResult, readGoalMcpToolResult, teachingRequestSha256 } from '../domain/host-task-authority.generated.mjs';
const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const TERMINAL=new Set(['completed','interrupted','failed','busy']);
const RETAINED_METADATA=['goal_hash_tombstone','exact_cleanup_plan_and_result','hash_only_deletion_authorization','hash_only_data_export_authorization'];
export class HostTaskDataRightsError extends Error {constructor(kind){super(`host_task_data_rights:${kind}`);this.kind=kind;}}
const need=(ok,kind)=>{if(!ok)throw new HostTaskDataRightsError(kind);};
const same=(value,scope)=>value?.accountSubjectSha256===scope.accountSubjectSha256 && value?.goalIdSha256===scope.goalIdSha256;
async function optional(path){try{return await readPrivateJson(path);}catch(e){if(e.kind==='not_found')return null;throw e;}}
async function entries(path){
 try{await verifyPrivateDirectory(path);}catch(e){if(e.kind==='not_found')return [];throw e;}
 const rows=await readdir(path,{withFileTypes:true});need(rows.length<=4096,'metadata_inventory_limit');
 need(rows.every(x=>!x.isSymbolicLink() && (x.isFile() || x.isDirectory())),'unsafe_metadata');return rows.sort((a,b)=>a.name.localeCompare(b.name));
}
const keep=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const CONTEXT=['contextSha256','accountSubjectSha256','goalIdSha256','attemptIdSha256','sourceThreadIdSha256','hostIdSha256','goalVersion','operationId','requestSha256','issuedAt','expiresAt'];
const ACCESS=['accessId','accessSha256','contextId','creationContextSha256','accountSubjectSha256','goalIdSha256','attemptIdSha256','sourceThreadIdSha256','taskThreadIdSha256','ownerRunId','action','issuedAt','expiresAt'];
const RUN=['runId','action','threadId','status','createdAt','updatedAt','turnCompleted','exitCode','exitSignal','toolCallsObserved','finalMessageSha256'];
const CALL=['accountSubjectSha256','goalIdSha256','requestSha256','observedSessionId','observedCallId','accessId','accessSha256','preSha256','at'];
function boundProjection(value,keys){const out=keep(value,keys);for(const [key,v] of Object.entries(out)){
 if(key.endsWith('Sha256') || ['observedSessionId','observedCallId'].includes(key))need(v===null || HASH.test(v),'invalid_metadata');
 else if(['operationId','accessId','runId','ownerRunId','threadId'].includes(key))need(v===null || UUID.test(v),'invalid_metadata');
 else if(['issuedAt','expiresAt','createdAt','updatedAt','at'].includes(key))need(typeof v==='string' && new Date(v).toISOString()===v,'invalid_metadata');
 else if(key==='observationTool')need(['aidesk_goal_data_delete_preview','aidesk_goal_data_delete_operation'].includes(v),'invalid_metadata');
 else if(key==='action')need(['read','create','resume','interrupt'].includes(v),'invalid_metadata');
 else if(key==='status')need(['starting','running','interrupt_requested','unknown',...TERMINAL].includes(v),'invalid_metadata');
 else if(key==='exitSignal')need(v===null || ['SIGINT','SIGTERM','SIGKILL','SIGABRT','SIGSEGV'].includes(v),'invalid_metadata');
 else if(key==='contextId')need(HASH.test(v),'invalid_metadata');
 else if(key==='turnCompleted')need(typeof v==='boolean','invalid_metadata');
 else need(v===null || Number.isSafeInteger(v),'invalid_metadata');
 }return out;}
async function inventory(dataRoot,scope,{forCleanup=false}={}){
 hostTaskScopeId(scope);await verifyPrivateDirectory(dataRoot);const root=join(dataRoot,'host-tasks'),files=[],contexts=[],accesses=[],calls=[],retainedWorkspaces=[];
 const add=async path=>{const read=await readPrivateJson(path);files.push({path:relative(dataRoot,path),sha256:read.sha256});need(files.length<=16384,'metadata_inventory_limit');return read.value;};
 for(const entry of await entries(join(root,'contexts'))){
  need(entry.isDirectory() && HASH.test(entry.name),'unsafe_metadata');const directory=join(root,'contexts',entry.name);
  const prepared=await optional(join(directory,'prepared.json'));if(!prepared)continue; // Unattributed incomplete claims are retained, never guessed.
  if(!same(prepared.value.context,scope))continue;
  const c=validateTaskContextIdentity(prepared.value);need(prepared.value.contextId===entry.name,'invalid_metadata');
  const expected=sha256({accountSubjectSha256:c.accountSubjectSha256,goalIdSha256:c.goalIdSha256,attemptIdSha256:c.attemptIdSha256});need(expected===entry.name,'invalid_metadata');
  const item={contextId:entry.name,...boundProjection(c,CONTEXT),runs:[]};contexts.push(item);
  for(const child of await entries(directory)){
   const path=join(directory,child.name);
   if(child.name==='workspace'){need(child.isDirectory(),'unsafe_metadata');retainedWorkspaces.push({contextId:entry.name,preserved:true});continue;}
   if(['execution.lock','hook.lock'].includes(child.name)){need(!forCleanup,'owner_busy');continue;}
   if(child.name==='runs'){
    need(child.isDirectory(),'unsafe_metadata');for(const run of await entries(path)){
     need(run.isDirectory() && UUID.test(run.name),'unsafe_metadata');const runPath=join(path,run.name);let state=null;
     for(const field of await entries(runPath)){
      need(field.isFile() && ['intent.json','state.json','worker-started.json','control.json'].includes(field.name),'unknown_owner_metadata');
      if(field.name==='control.json'){need(!forCleanup,'owner_control_present');continue;}
      const v=await add(join(runPath,field.name));if(field.name==='state.json')state=v;
     }
     need(state?.format===1 && state.contextId===entry.name && state.runId===run.name,'invalid_run_state');
     if(forCleanup)need(TERMINAL.has(state.status) && (Number.isInteger(state.exitCode) || typeof state.exitSignal==='string'),'owner_not_terminal');
     item.runs.push(boundProjection(state,RUN));
    }continue;
   }
   need(child.isFile() && ['prepared.json','pre.json','witness.json','dispatch.json','current-run.json'].includes(child.name),'unknown_owner_metadata');
   await add(path);
  }
  const index=join(root,'by-reserve',scope.accountSubjectSha256,`${c.operationId}.json`),v=await add(index);
  need(v.contextId===entry.name && v.contextSha256===c.contextSha256 && v.accountSubjectSha256===scope.accountSubjectSha256,'invalid_metadata');
  if(forCleanup){
   const dispatch=await optional(join(directory,'dispatch.json')),pointer=await optional(join(directory,'current-run.json'));
   if(dispatch)need(dispatch.value.contextId===entry.name && dispatch.value.contextSha256===c.contextSha256 && dispatch.value.action==='create'
     && pointer?.value.format===1 && UUID.test(pointer.value.runId) && item.runs.some(run=>run.runId===pointer.value.runId),'owner_not_terminal');
   else need(pointer===null && item.runs.length===0,'owner_not_terminal');
  }
 }
 for(const entry of await entries(join(root,'accesses'))){
  need(entry.isDirectory() && UUID.test(entry.name),'unsafe_metadata');const directory=join(root,'accesses',entry.name),prepared=await optional(join(directory,'prepared.json'));
  if(!prepared || !same(prepared.value.access,scope))continue;
  const {access,nonce}=prepared.value,{accessSha256,...base}=access;
  need(access.accessId===entry.name && HASH.test(nonce) && access.nonceSha256===sha256(nonce) && sha256(base)===accessSha256,'invalid_access');
  accesses.push(boundProjection(access,ACCESS));
  for(const child of await entries(directory)){need(child.isFile() && ['prepared.json','pre.json','witness.json','consumed.json'].includes(child.name),'unknown_owner_metadata');await add(join(directory,child.name));}
 }
 for(const entry of await entries(join(root,'access-by-read'))){
  need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name),'unsafe_metadata');const path=join(root,'access-by-read',entry.name),v=(await readPrivateJson(path)).value;if(same(v,scope))await add(path);
 }
 for(const session of await entries(join(root,'access-calls'))){
  need(session.isDirectory() && HASH.test(session.name),'unsafe_metadata');for(const call of await entries(join(root,'access-calls',session.name))){
   need(call.isFile() && /^[a-f0-9]{64}\.json$/u.test(call.name),'unsafe_metadata');const path=join(root,'access-calls',session.name,call.name),v=(await readPrivateJson(path)).value;
   if(same(v,scope)){calls.push(boundProjection(v,CALL));await add(path);}
  }
 }
 files.sort((a,b)=>a.path.localeCompare(b.path));
 return {contexts,accesses,calls,files,retainedCopies:{hostChats:'preserved',taskWorkspaces:retainedWorkspaces,independentExports:'preserved',otherGoalsAndAccounts:'preserved'}};
}
async function deletionEvidence(dataRoot,scope){
 const directory=join(dataRoot,'host-tasks/scopes',hostTaskScopeId(scope),'deletion-witnesses'),witnesses=[],calls=[],bound=new Set();
 for(const entry of await entries(directory)){
  need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name),'unsafe_metadata');const value=validateDeletionWitness((await readPrivateJson(join(directory,entry.name))).value);need(same(value,scope),'invalid_deletion_witness');witnesses.push(value);bound.add(`${value.observedSessionId}/${value.observedCallId}`);
 }
 for(const session of await entries(join(dataRoot,'host-tasks/deletion-read-calls'))){
  need(session.isDirectory() && HASH.test(session.name),'unsafe_metadata');for(const entry of await entries(join(dataRoot,'host-tasks/deletion-read-calls',session.name))){
   need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name),'unsafe_metadata');const value=(await readPrivateJson(join(dataRoot,'host-tasks/deletion-read-calls',session.name,entry.name))).value;
   if(same(value,scope) || value?.accountSubjectSha256===scope.accountSubjectSha256 && bound.has(`${value.observedSessionId}/${value.observedCallId}`))calls.push(boundProjection(value,['accountSubjectSha256','goalIdSha256','operationId','observationTool','observationRequestSha256','observedSessionId','observedCallId','at']));
  }
 }
 return {witnesses,readClaims:calls,retention:'hash_only_deletion_authorization_and_reconciliation; does_not_enable_task_dispatch'};
}
export async function exportHostTaskMetadata(dataRoot,scope){
 const tombstone=await readHostTaskTombstone(dataRoot,scope),deletionAuthorization=await deletionEvidence(dataRoot,scope),dataExportAuthorization=await exportDataExportEvidence(dataRoot,scope),localLedger=await exportRecoveryLedger(dataRoot,scope);
 if(tombstone){
  const directory=join(dataRoot,'host-tasks/scopes',hostTaskScopeId(scope)),plan=await readPrivateJson(join(directory,'cleanup-plan.json'));
  need(plan.sha256===tombstone.planSha256,'cleanup_plan_changed');const result=await optional(join(directory,'cleanup-result.json'));
  return {status:result?'metadata_deleted':'cleanup_pending',tombstone,deletionAuthorization,dataExportAuthorization,localLedger,retainedMetadata:RETAINED_METADATA,retainedCopies:plan.value.retainedCopies,contexts:[],accesses:[],calls:[],bodyStored:false,credentialsStored:false};
 }
 const {files,...value}=await inventory(dataRoot,scope);need(await readHostTaskTombstone(dataRoot,scope)===null,'metadata_changed');
 return {status:'ok',scope:'local_owner_metadata',deletionAuthorization,dataExportAuthorization,localLedger,retainedMetadata:RETAINED_METADATA,...value,metadataFileCount:files.length,metadataDigests:files.map(file=>({pathSha256:sha256(file.path),sha256:file.sha256})),bodyStored:false,credentialsStored:false};
}
export async function exportHostTaskMetadataForSubject(dataRoot,{accountSubjectSha256,goalIdSha256=null}){
 need(HASH.test(accountSubjectSha256),'invalid_goal_scope');if(goalIdSha256)return [await exportHostTaskMetadata(dataRoot,{accountSubjectSha256,goalIdSha256})];
 const root=join(dataRoot,'host-tasks'),goals=new Set();const take=v=>{if(v?.accountSubjectSha256===accountSubjectSha256 && HASH.test(v.goalIdSha256))goals.add(v.goalIdSha256);};
 for(const name of ['contexts','accesses'])for(const entry of await entries(join(root,name))){need(entry.isDirectory(),'unsafe_metadata');const record=await optional(join(root,name,entry.name,'prepared.json'));take(record?.value?.context ?? record?.value?.access);}
 for(const entry of await entries(join(root,'scopes'))){need(entry.isDirectory() && HASH.test(entry.name),'unsafe_metadata');take((await optional(join(root,'scopes',entry.name,'deleted.json')))?.value);for(const witness of await entries(join(root,'scopes',entry.name,'deletion-witnesses'))){need(witness.isFile() && /^[a-f0-9]{64}\.json$/u.test(witness.name),'unsafe_metadata');take((await readPrivateJson(join(root,'scopes',entry.name,'deletion-witnesses',witness.name))).value);}
  for(const prepared of await entries(join(root,'scopes',entry.name,'data-exports'))){need(prepared.isDirectory() && UUID.test(prepared.name),'unsafe_metadata');take((await optional(join(root,'scopes',entry.name,'data-exports',prepared.name,'prepared.json')))?.value.access);}
  for(const session of await entries(join(root,'scopes',entry.name,'data-export-calls'))){need(session.isDirectory() && HASH.test(session.name),'unsafe_metadata');for(const call of await entries(join(root,'scopes',entry.name,'data-export-calls',session.name))){need(call.isFile() && /^[a-f0-9]{64}\.json$/u.test(call.name),'unsafe_metadata');take((await readPrivateJson(join(root,'scopes',entry.name,'data-export-calls',session.name,call.name))).value);}}}
 for(const session of await entries(join(root,'access-calls'))){need(session.isDirectory() && HASH.test(session.name),'unsafe_metadata');for(const entry of await entries(join(root,'access-calls',session.name))){need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name),'unsafe_metadata');take((await readPrivateJson(join(root,'access-calls',session.name,entry.name))).value);}}
 const result=[];for(const goal of [...goals].sort())result.push(await exportHostTaskMetadata(dataRoot,{accountSubjectSha256,goalIdSha256:goal}));return result;
}
function pathFor(dataRoot,name){
 const hash='[a-f0-9]{64}',uuid='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
 const pattern=new RegExp(`^host-tasks/(?:contexts/${hash}/(?:prepared|pre|witness|dispatch|current-run)\\.json|contexts/${hash}/runs/${uuid}/(?:intent|state|worker-started)\\.json|by-reserve/${hash}/${uuid}\\.json|accesses/${uuid}/(?:prepared|pre|witness|consumed)\\.json|access-by-read/${hash}\\.json|access-calls/${hash}/${hash}\\.json)$`,'u');
 need(typeof name==='string' && pattern.test(name),'invalid_cleanup_plan');return resolve(dataRoot,name);
}
export async function cleanHostTaskMetadata(dataRoot,scope,{confirm=false,afterMetadata,ledgerFilter={}}={}){
 need(ledgerFilter && Object.keys(ledgerFilter).every(key=>['targetSha256','targetKind'].includes(key)),'invalid_ledger_filter');
 need(confirm===true,'confirm_required');scope={accountSubjectSha256:scope.accountSubjectSha256,goalIdSha256:scope.goalIdSha256};return withHostTaskScope(dataRoot,scope,async owned=>{
  const planPath=join(owned.directory,'cleanup-plan.json'),resultPath=join(owned.directory,'cleanup-result.json');let original=await optional(planPath);
  if(!original){
   need(!owned.tombstone,'cleanup_plan_missing');const preview=await inventory(dataRoot,scope,{forCleanup:true});
   const value={format:1,kind:'host_task_cleanup_plan',cleanupId:randomUUID(),scopeId:owned.scopeId,...scope,at:new Date().toISOString(),files:preview.files,retainedCopies:preview.retainedCopies};
   original=await writePrivateJsonExclusive(planPath,value);
  }
  const plan=original.value;need(plan?.format===1 && plan.kind==='host_task_cleanup_plan' && same(plan,scope) && plan.scopeId===owned.scopeId && UUID.test(plan.cleanupId) && Array.isArray(plan.files),'invalid_cleanup_plan');
  if(owned.tombstone)need(owned.tombstone.planSha256===original.sha256 && owned.tombstone.cleanupId===plan.cleanupId,'cleanup_plan_changed');
  else {const fresh=await inventory(dataRoot,scope,{forCleanup:true});need(sha256(fresh.files)===sha256(plan.files),'cleanup_plan_stale');await writePrivateJsonExclusive(join(owned.directory,'deleted.json'),{format:1,kind:'host_task_goal_deleted',scopeId:owned.scopeId,...scope,cleanupId:plan.cleanupId,planSha256:original.sha256,at:plan.at});}
  // The permanent fence is already visible. Exact plan+bytes, never a fresh
  // scan or recursive removal, resumes any partially completed cleanup.
  for(const file of plan.files){need(HASH.test(file.sha256),'invalid_cleanup_plan');const path=pathFor(dataRoot,file.path),current=await optional(path);if(!current)continue;need(current.sha256===file.sha256,'cleanup_file_changed');await removePrivateJson(path,{expectedSha256:file.sha256});}
  if(afterMetadata)await afterMetadata();
  const localLedger=await cleanRecoveryLedger(dataRoot,{...scope,...ledgerFilter});
  let result=await optional(resultPath);
  if(!result)result=await writePrivateJsonExclusive(resultPath,{format:1,status:'completed',cleanupId:plan.cleanupId,scopeId:owned.scopeId,...scope,planSha256:original.sha256,metadataFilesRemoved:plan.files.length,at:new Date().toISOString(),retainedCopies:plan.retainedCopies,retainedMetadata:RETAINED_METADATA,bodyStored:false,credentialsStored:false});
  return {...result.value,retainedMetadata:RETAINED_METADATA,localLedger};
 },{allowDeleted:true});
}
// Read-only guard usable by ordinary recovery ledger writers. A tombstone
// revokes task dispatch; it is not a cloud deletion or an account proof.
export { readHostTaskTombstone };

const DELETION_KEYS=['format','kind','scopeId','witnessId','accountSubjectSha256','goalIdSha256','operationId','requestSha256','snapshotSha256','observationTool','observationRequestSha256','observedSessionId','observedCallId','responseSha256','preObservedAt','observedAt','expiresAt','witnessSha256'];
const iso=value=>typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value;
function validateDeletionWitness(value){
 need(value && Object.keys(value).length===DELETION_KEYS.length && DELETION_KEYS.every(k=>Object.hasOwn(value,k)) && value.format===1 && value.kind==='host_goal_deletion_witness','invalid_deletion_witness');
 need(DELETION_KEYS.filter(k=>k.endsWith('Sha256') || ['scopeId','witnessId','observedSessionId','observedCallId'].includes(k)).every(k=>HASH.test(value[k])) && UUID.test(value.operationId) && ['aidesk_goal_data_delete','aidesk_goal_data_delete_preview','aidesk_goal_data_delete_operation'].includes(value.observationTool),'invalid_deletion_witness');
 need(['preObservedAt','observedAt','expiresAt'].every(k=>iso(value[k])) && Date.parse(value.expiresAt)-Date.parse(value.observedAt)===900000 && Date.parse(value.preObservedAt)<=Date.parse(value.observedAt) && Date.parse(value.observedAt)-Date.parse(value.preObservedAt)<900000,'invalid_deletion_witness');
 const {witnessSha256,...base}=value;need(sha256(base)===witnessSha256 && hostTaskScopeId(value)===value.scopeId,'invalid_deletion_witness');return value;
}
// Actual Hook only: parse the authoritative account envelope and exact original
// delete, then bind its contemporaneous Pre. Model arguments are never proof.
export async function observeHostGoalDeletion(dataRoot,event,{readPreRecord,observedAt=new Date().toISOString()}={}){
 const tool=toolFromEvent(event),action=({aidesk_goal_data_delete:'delete',aidesk_goal_data_delete_preview:'preview',aidesk_goal_data_delete_operation:'operation'})[tool];
 if(!action || !['PreToolUse','PostToolUse'].includes(event?.hook_event_name) || action==='delete' && event.hook_event_name==='PreToolUse')return {status:'not_applicable'};
 try{
  const {expectedAccountSubject,businessInput}=splitGoalMcpRequest(event.tool_input),input=parseGoalDataDeleteInput(action,businessInput);
  need(UUID.test(event.session_id) && typeof event.tool_use_id==='string' && event.tool_use_id.length>0 && event.tool_use_id.length<=512 && iso(observedAt),'invalid_deletion_source');
  const call={format:1,kind:'host_deletion_read_pre',observationTool:tool,goalIdSha256:input.goalId?sha256(input.goalId):null,operationId:input.operationId ?? null,accountSubjectSha256:sha256(expectedAccountSubject),observationRequestSha256:teachingRequestSha256(input),observedSessionId:sha256(event.session_id),observedCallId:sha256(event.tool_use_id)};
  const readPath=join(dataRoot,'host-tasks/deletion-read-calls',call.observedSessionId,`${call.observedCallId}.json`);
  if(event.hook_event_name==='PreToolUse'){
   await verifyPrivateDirectory(dataRoot);for(const path of [join(dataRoot,'host-tasks'),join(dataRoot,'host-tasks/deletion-read-calls'),join(dataRoot,'host-tasks/deletion-read-calls',call.observedSessionId)])await ensurePrivateDirectory(path);
   const old=await optional(readPath);if(old)need(Object.keys(call).every(k=>old.value[k]===call[k]) && iso(old.value.at),'deletion_pre_mismatch');
   else await writePrivateJsonExclusive(readPath,{...call,at:observedAt});return {status:'read_pre_bound'};
  }
  const {businessResult}=readGoalMcpToolResult(event.tool_response,expectedAccountSubject);
  need(validGoalDataDeleteResult(action,businessResult,input),'cloud_deletion_unverified');
  const receipt=action==='delete'?businessResult:businessResult.receipt;
  need((action==='delete' || action==='preview'?businessResult.status==='deleted':businessResult.status==='completed' && businessResult.terminal===true) && receipt?.status==='deleted','cloud_deletion_unverified');
  const request=parseGoalDataDeleteInput('delete',{contract:receipt.contract,operationId:receipt.operationId,goalId:receipt.goalId,expectedSnapshot:receipt.snapshot});
  need(validGoalDataDeleteResult('delete',receipt,request),'cloud_deletion_unverified');
  const scope={accountSubjectSha256:call.accountSubjectSha256,goalIdSha256:sha256(request.goalId)},identity={...scope,operationId:request.operationId,requestSha256:teachingRequestSha256(request),observationTool:tool,observationRequestSha256:call.observationRequestSha256,observedSessionId:call.observedSessionId,observedCallId:call.observedCallId};
  let pre;
  if(action==='delete'){
   need(typeof readPreRecord==='function','deletion_pre_missing');pre=await readPreRecord();
   need(pre?.phase==='PreToolUse' && pre.tool===tool && ['accountSubjectSha256','goalIdSha256','operationId','requestSha256','observedSessionId','observedCallId'].every(k=>pre[k]===identity[k]) && iso(pre.at),'deletion_pre_mismatch');
  }else{
   pre=(await readPrivateJson(readPath)).value;need(Object.keys(call).every(k=>pre[k]===call[k]) && iso(pre.at),'deletion_pre_mismatch');
  }
  return await withHostTaskScope(dataRoot,scope,async owned=>{
   const witnessId=sha256(identity),directory=join(owned.directory,'deletion-witnesses');await ensurePrivateDirectory(directory);
   const path=join(directory,`${witnessId}.json`),previous=await optional(path),at=previous?.value.observedAt ?? observedAt;
   const base={format:1,kind:'host_goal_deletion_witness',scopeId:owned.scopeId,witnessId,...identity,snapshotSha256:request.expectedSnapshot,responseSha256:sha256(event.tool_response),preObservedAt:pre.at,observedAt:at,expiresAt:new Date(Date.parse(at)+900000).toISOString()};
   const witness=validateDeletionWitness({...base,witnessSha256:sha256(base)});
   if(previous)need(sha256(previous.value)===sha256(witness),'deletion_witness_conflict');else await writePrivateJsonExclusive(path,witness);
   return {status:'deletion_witness_saved',scopeId:owned.scopeId,witnessId,expiresAt:witness.expiresAt};
  },{allowDeleted:true});
 }catch(error){return {status:'rejected',error:/^[a-z_]{1,80}$/u.test(error?.kind ?? '')?error.kind:'deletion_witness_unavailable'};}
}
export async function readHostDeletionWitness(dataRoot,{scopeId,witnessId,params,now=new Date().toISOString()}={}){
 need(HASH.test(scopeId) && HASH.test(witnessId) && iso(now),'invalid_deletion_witness');await verifyPrivateDirectory(dataRoot);
 const value=validateDeletionWitness((await readPrivateJson(join(dataRoot,'host-tasks/scopes',scopeId,'deletion-witnesses',`${witnessId}.json`))).value),source=readHostSource(params);
 need(value.scopeId===scopeId && value.witnessId===witnessId && value.observedSessionId===sha256(source.sessionId),'deletion_source_mismatch');
 need(Date.parse(now)>=Date.parse(value.observedAt) && Date.parse(now)<Date.parse(value.expiresAt),'deletion_witness_expired');
 const prior=await optional(join(dataRoot,'host-tasks/scopes',scopeId,'cleanup-plan.json'));
 if(prior)need(prior.value?.kind==='host_task_cleanup_plan' && prior.value.scopeId===scopeId && same(prior.value,value) && UUID.test(prior.value.cleanupId),'invalid_cleanup_plan');
 return {scope:{accountSubjectSha256:value.accountSubjectSha256,goalIdSha256:value.goalIdSha256},scopeId,witnessId,cleanupId:prior?.value.cleanupId ?? null,operationId:value.operationId,requestSha256:value.requestSha256,expiresAt:value.expiresAt,cloudDeletionVerified:true};
}
