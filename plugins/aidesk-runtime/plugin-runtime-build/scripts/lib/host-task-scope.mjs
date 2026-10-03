// One short-lived goal mutex shared by local task metadata owners. It never
// owns cloud authority, kills a process, or reclaims an unproven old lock.
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { verifyPrivateDirectory, ensurePrivateDirectory, readPrivateJson,
  writePrivateJsonExclusive, removePrivateJson } from './host-data-binding.mjs';
import { sha256 } from './contract.mjs';
const HASH=/^[a-f0-9]{64}$/u,UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
export class HostTaskScopeError extends Error { constructor(kind){super(`host_task_scope:${kind}`);this.kind=kind;} }
const need=(ok,kind)=>{if(!ok)throw new HostTaskScopeError(kind);};
export function hostTaskScopeId(scope){need(scope && HASH.test(scope.accountSubjectSha256) && HASH.test(scope.goalIdSha256),'invalid_goal_scope');return sha256({accountSubjectSha256:scope.accountSubjectSha256,goalIdSha256:scope.goalIdSha256});}
async function optional(path){try{return await readPrivateJson(path);}catch(e){if(e.kind==='not_found')return null;throw e;}}
async function directory(dataRoot,scope,create){
  need(typeof dataRoot==='string' && dataRoot===resolve(dataRoot),'invalid_data_root');await verifyPrivateDirectory(dataRoot);
  const scopeId=hostTaskScopeId(scope),root=join(dataRoot,'host-tasks'),scopes=join(root,'scopes'),path=join(scopes,scopeId);
  for(const value of [root,scopes,path])await (create?ensurePrivateDirectory:verifyPrivateDirectory)(value);
  return {dataRoot,scopeId,directory:path,accountSubjectSha256:scope.accountSubjectSha256,goalIdSha256:scope.goalIdSha256};
}
function validateTombstone(record,scope){
  if(!record)return null;const value=record.value;
  need(value && Object.keys(value).sort().join(',')==='accountSubjectSha256,at,cleanupId,format,goalIdSha256,kind,planSha256,scopeId' && value.format===1 && value.kind==='host_task_goal_deleted' && value.scopeId===scope.scopeId
    && value.accountSubjectSha256===scope.accountSubjectSha256 && value.goalIdSha256===scope.goalIdSha256
    && HASH.test(value.planSha256) && UUID.test(value.cleanupId) && typeof value.at==='string' && Number.isFinite(Date.parse(value.at)),'invalid_goal_tombstone');return value;
}
export async function readHostTaskTombstone(dataRoot,scope){
  let owned;try{owned=await directory(dataRoot,scope,false);}catch(e){if(e.kind==='not_found')return null;throw e;}
  return validateTombstone(await optional(join(owned.directory,'deleted.json')),owned);
}
export async function withHostTaskScope(dataRoot,scope,fn,{allowDeleted=false}={}){
  const owned=await directory(dataRoot,scope,true),path=join(owned.directory,'scope.lock.json');let lock;
  try{lock=await writePrivateJsonExclusive(path,{format:1,owner:randomUUID(),at:new Date().toISOString()});}
  catch(e){if(['already_exists','busy'].includes(e.kind))throw new HostTaskScopeError('goal_scope_busy');throw e;}
  try{
    const tombstone=validateTombstone(await optional(join(owned.directory,'deleted.json')),owned);
    need(allowDeleted || tombstone===null,'local_goal_deleted');return await fn({...owned,tombstone});
  }finally{await removePrivateJson(path,{expectedSha256:lock.sha256});}
}
