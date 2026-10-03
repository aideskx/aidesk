import { lstat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { verifyPrivateDirectory, ensurePrivateDirectory, createPrivateDirectoryExclusive, readPrivateJson, writePrivateJsonExclusive, removePrivateJson } from './host-data-binding.mjs';
import { sha256, toolFromEvent } from './contract.mjs';
import { withHostTaskScope, readHostTaskTombstone } from './host-task-scope.mjs';
import { createTaskContext, bindReservePre, createReserveWitness, validateReserveWitness, validateTaskContextIdentity, readHostSource } from '../domain/host-task-contract.mjs';

const WINDOW_MS=15*60*1000;
const HASH=/^[a-f0-9]{64}$/u, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const own=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
export class HostTaskContextError extends Error { constructor(kind){super(`host_task_context:${kind}`);this.kind=kind;} }
function need(ok,kind){if(!ok)throw new HostTaskContextError(kind);}
function bounded(error){return /^[a-z_]{1,80}$/u.test(error?.kind ?? '')?error.kind:'context_io_unavailable';}
async function safe(fn){try{return await fn();}catch(e){throw e instanceof HostTaskContextError?e:new HostTaskContextError(bounded(e));}}
function clock(now){const value=now ?? new Date().toISOString();need(typeof value==='string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString()===value,'invalid_time');return value;}
const contextIdFor=c=>sha256({accountSubjectSha256:c.accountSubjectSha256,goalIdSha256:c.goalIdSha256,attemptIdSha256:c.attemptIdSha256});
function layout(dataRoot){need(typeof dataRoot==='string' && dataRoot===resolve(dataRoot),'invalid_data_root');const root=join(dataRoot,'host-tasks');return {dataRoot,root,contexts:join(root,'contexts'),index:join(root,'by-reserve')};}
const equal=(a,b)=>sha256(a)===sha256(b);
function validDispatchNamespace(value,directory){
  const path=v=>typeof v==='string' && v.length<=4096 && !v.includes('\0') && isAbsolute(v) && v===resolve(v);
  return own(value,['home','workspace','homeSha256','workspaceSha256','homeSelection','desktopNamespaceMatch'])
    && path(value.home) && path(value.workspace) && value.workspace===join(directory,'workspace')
    && value.homeSha256===sha256(value.home) && value.workspaceSha256===sha256(value.workspace)
    && ['host_default','CODEX_HOME'].includes(value.homeSelection) && value.desktopNamespaceMatch==='not_observed';
}
async function still(directory){need(equal((await verifyPrivateDirectory(directory.path)).identity,directory.identity),'directory_changed');}
async function missing(path){try{await lstat(path);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
async function directories(l,{create=false}={}){
  await verifyPrivateDirectory(l.dataRoot);
  for(const p of [l.root,l.contexts,l.index])await (create?ensurePrivateDirectory:verifyPrivateDirectory)(p);
}
async function unconsumed(directory){need(await missing(join(directory,'dispatch.json')),'context_consumed');}
async function lockContext(directory,fn){
  const d=await verifyPrivateDirectory(directory),path=join(directory,'hook.lock');let lock;
  try{lock=await writePrivateJsonExclusive(path,{format:1,owner:randomBytes(32).toString('hex')});}
  catch(e){if(e.kind==='already_exists' || e.kind==='busy')throw new HostTaskContextError('context_busy');throw e;}
  try{await still(d);return await fn();}
  finally{
    await still(d);const current=await readPrivateJson(path);
    need(equal(current.identity,lock.identity) && current.sha256===lock.sha256,'context_lock_changed');
    await removePrivateJson(path,{expectedSha256:lock.sha256});
  }
}
function validatePrepared(value,id){
  need(own(value,['format','kind','contextId','context','nonce']) && value.format===1 && value.kind==='host_task_prepared' && value.contextId===id,'invalid_prepared_context');
  const c=validateTaskContextIdentity(value);need(HASH.test(id) && contextIdFor(c)===id,'invalid_prepared_context');
  need(Date.parse(c.expiresAt)-Date.parse(c.issuedAt)===WINDOW_MS,'invalid_context_window');return value;
}
function indexValue(contextId,c){return {format:1,kind:'host_task_context_index',contextId,contextSha256:c.contextSha256,accountSubjectSha256:c.accountSubjectSha256,operationId:c.operationId};}
async function load(dataRoot,id){
  need(HASH.test(id),'invalid_context_id');const l=layout(dataRoot);await directories(l);const directory=join(l.contexts,id);await verifyPrivateDirectory(directory);
  const prepared=validatePrepared((await readPrivateJson(join(directory,'prepared.json'))).value,id);
  need(await readHostTaskTombstone(dataRoot,prepared.context)===null,'local_goal_deleted');
  const c=prepared.context,subjectDir=join(l.index,c.accountSubjectSha256);await verifyPrivateDirectory(subjectDir);
  const index=(await readPrivateJson(join(subjectDir,`${c.operationId}.json`))).value;
  need(equal(index,indexValue(id,c)),'context_index_mismatch');
  return {contextId:id,directory,context:c,nonce:prepared.nonce};
}
// Claims the attempt before returning any context. Partial preparation is a
// non-reusable tombstone, never permission to rebuild or choose another op.
export async function prepareTaskContext(dataRoot,{params,reservationInput,now}={}){return safe(async()=>{
  const issuedAt=clock(now),nonce=randomBytes(32).toString('hex');
  const context=createTaskContext({params,reservationInput,nonce,issuedAt,expiresAt:new Date(Date.parse(issuedAt)+WINDOW_MS).toISOString()});
  return withHostTaskScope(dataRoot,context,async()=>{
  const contextId=contextIdFor(context),l=layout(dataRoot);await directories(l,{create:true});
  const directory=join(l.contexts,contextId);
  try{await createPrivateDirectoryExclusive(directory);}catch(e){if(e.kind==='already_exists')throw new HostTaskContextError('context_already_exists');throw e;}
  const subjectDir=join(l.index,context.accountSubjectSha256);await ensurePrivateDirectory(subjectDir);
  // Index and prepared publication are exclusive. A crash between them cannot
  // produce a usable context, and the attempt directory blocks reconstruction.
  await writePrivateJsonExclusive(join(subjectDir,`${context.operationId}.json`),indexValue(contextId,context));
  await writePrivateJsonExclusive(join(directory,'prepared.json'),{format:1,kind:'host_task_prepared',contextId,context,nonce});
  const actual=await load(dataRoot,contextId);need(equal(actual.context,context),'context_changed');
  return {contextId,contextSha256:context.contextSha256,issuedAt,expiresAt:context.expiresAt};
  });
});}
async function lookupHook(dataRoot,event){
  if(toolFromEvent(event)!=='aidesk_goal_task_reserve' || !['PreToolUse','PostToolUse'].includes(event?.hook_event_name))return null;
  const args=event.tool_input;
  if(typeof args?.expectedAccountSubject!=='string' || !UUID.test(args?.operationId ?? ''))return null;
  if(typeof dataRoot!=='string' || dataRoot!==resolve(dataRoot))return null;
  const l=layout(dataRoot);
  // A legacy reserve without prepared local state keeps its existing path.
  if(await missing(l.root))return null;
  await directories(l);const subjectDir=join(l.index,sha256(args.expectedAccountSubject));
  if(await missing(subjectDir))return null;await verifyPrivateDirectory(subjectDir);
  const path=join(subjectDir,`${args.operationId}.json`);if(await missing(path))return null;
  const index=(await readPrivateJson(path)).value;
  need(own(index,['format','kind','contextId','contextSha256','accountSubjectSha256','operationId']) && index.format===1 && index.kind==='host_task_context_index' && index.accountSubjectSha256===sha256(args.expectedAccountSubject) && index.operationId===args.operationId,'context_index_mismatch');
  return load(dataRoot,index.contextId);
}
const LEDGER_PRE_FIELDS=['phase','tool','operationId','accountSubjectSha256','requestSha256','goalIdSha256','observedSessionId','observedCallId','contextSha256','at'];
function sameLedgerPre(record,pre){need(record && LEDGER_PRE_FIELDS.every(k=>record[k]===pre[k]),'pre_ledger_binding_mismatch');}
async function existingJson(path){try{return (await readPrivateJson(path)).value;}catch(e){if(e.kind==='not_found')return null;throw e;}}
// Only the actual Hook entry supplies these callbacks. They expose its real
// stored ledger row, never a model-provided assertion of a Pre/Post event.
export async function observeReserveHook(dataRoot,event,{observedAt,appendPreRecord,readPreRecord}={}){
  try {
    const prepared=await lookupHook(dataRoot,event);if(!prepared)return {status:'not_applicable'};
    return await withHostTaskScope(dataRoot,prepared.context,()=>lockContext(prepared.directory,async()=>{
      const current=await load(dataRoot,prepared.contextId);await unconsumed(current.directory);const at=clock(observedAt);
      const prePath=join(current.directory,'pre.json'),witnessPath=join(current.directory,'witness.json');
      if(event.hook_event_name==='PreToolUse'){
        need(typeof appendPreRecord==='function','pre_ledger_callback_missing');
        const proposed=bindReservePre({...current,event,observedAt:at});
        const stored=await appendPreRecord({contextSha256:proposed.contextSha256});
        need(stored && typeof stored.created==='boolean','pre_ledger_binding_missing');
        if(stored.created){sameLedgerPre(stored.record,proposed);await writePrivateJsonExclusive(prePath,proposed);}
        else {
          // A deduplicated legacy or crash-before-pre.json row grants nothing.
          const previous=await existingJson(prePath);need(previous,'pre_not_previously_bound');
          sameLedgerPre(stored.record,previous);
          const actual=bindReservePre({...current,event,observedAt:previous.at});need(equal(previous,actual),'pre_replay_mismatch');
        }
        return {status:'pre_bound',contextId:current.contextId,contextSha256:current.context.contextSha256};
      }
      need(typeof readPreRecord==='function','pre_ledger_callback_missing');
      const pre=(await readPrivateJson(prePath)).value;sameLedgerPre(await readPreRecord(),pre);
      const witness=createReserveWitness({...current,pre,event,observedAt:at});
      const previous=await existingJson(witnessPath);
      if(previous){const original=createReserveWitness({...current,pre,event,observedAt:previous.observedAt});need(equal(previous,original),'witness_replay_mismatch');}
      else await writePrivateJsonExclusive(witnessPath,witness);
      return {status:'witness_saved',contextId:current.contextId,contextSha256:current.context.contextSha256};
    }));
  }catch(e){return {status:'rejected',error:bounded(e)};}
}
// This is an internal API. The MCP layer supplies actual params and must never
// accept paths, nonce, Pre or witness objects from model arguments.
export async function readPreparedContext(dataRoot,contextId,params,{now}={}){return safe(async()=>{
  const prepared=await load(dataRoot,contextId);await unconsumed(prepared.directory);
  const source=readHostSource(params);need(sha256(source.threadId)===prepared.context.sourceThreadIdSha256,'source_mismatch');
  const pre=(await readPrivateJson(join(prepared.directory,'pre.json'))).value;
  const witness=(await readPrivateJson(join(prepared.directory,'witness.json'))).value;
  validateReserveWitness({...prepared,params,witness,now:clock(now)});
  need(pre.contextSha256===witness.contextSha256 && pre.at===witness.preObservedAt && pre.observedCallId===witness.observedCallId && LEDGER_PRE_FIELDS.filter(k=>!['phase','tool','at'].includes(k)).every(k=>pre[k]===witness[k]),'pre_witness_mismatch');
  await unconsumed(prepared.directory);return {...prepared,pre,witness};
});}

// Package-internal identity lookup for the separate access-witness owner. This
// is never exposed as an MCP handler and grants no read/control/create rights.
export async function loadOwnedTaskIdentity(dataRoot,contextId){return safe(async()=>{
  const prepared=await load(dataRoot,contextId),c=prepared.context;
  const dispatch=(await readPrivateJson(join(prepared.directory,'dispatch.json'))).value;
  need(own(dispatch,['format','runId','contextId','contextSha256','action','threadId','sourceThreadIdSha256','promptSha256','executable','namespace','createdAt','automaticRetry'])
    && dispatch.format===1 && UUID.test(dispatch.runId) && dispatch.contextId===contextId
    && dispatch.contextSha256===c.contextSha256 && dispatch.sourceThreadIdSha256===c.sourceThreadIdSha256
    && dispatch.action==='create' && dispatch.threadId===null && HASH.test(dispatch.promptSha256)
    && typeof dispatch.executable==='string' && dispatch.executable===resolve(dispatch.executable)
    && dispatch.automaticRetry===false && validDispatchNamespace(dispatch.namespace,prepared.directory),'invalid_create_dispatch');
  const at=clock(dispatch.createdAt);need(Date.parse(at)>=Date.parse(c.issuedAt) && Date.parse(at)<Date.parse(c.expiresAt),'dispatch_outside_window');
  return {contextId,directory:prepared.directory,context:c,dispatch,creationPermission:false};
});}
// Same-source historical status can outlive the handoff window. Cross-source
// access must instead present the separate fresh task-read Hook witness.
export async function readOwnedTaskContext(dataRoot,contextId,params){return safe(async()=>{
  const owned=await loadOwnedTaskIdentity(dataRoot,contextId),source=readHostSource(params);
  need(sha256(source.threadId)===owned.context.sourceThreadIdSha256,'source_mismatch');return owned;
});}
