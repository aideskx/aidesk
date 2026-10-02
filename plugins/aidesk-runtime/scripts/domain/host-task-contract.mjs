// Pure adapter contract. Callers supply host-owned context and Hook observations,
// never model-submitted witnesses. No IO, OAuth, process dispatch or new authority.
import { parseGoalTaskInput, validGoalTaskResult, splitGoalMcpRequest, readGoalMcpToolResult,
  teachingRequestSha256, canonicalTeachingJson, parseTeachingJson, isUuid, hookSha256, toolFromEvent } from './host-task-authority.generated.mjs';

export class HostTaskContractError extends Error {
  constructor(kind) { super(kind); this.name='HostTaskContractError'; this.kind=kind; }
}
const need=(value,kind)=>{if(!value)throw new HostTaskContractError(kind);};
const own=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const uuid=value=>isUuid(value)&&value===value.toLowerCase();
const id=value=>typeof value==='string'&&value.isWellFormed()&&value.length>0&&value.length<=512&&!/[\p{Cc}]/u.test(value);
const plain=value=>parseTeachingJson(canonicalTeachingJson(value),1_048_576);
function safe(kind,fn){try{return fn();}catch(error){throw error instanceof HostTaskContractError?error:new HostTaskContractError(kind);}}
function time(value){need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),'invalid_time');const ms=Date.parse(value);need(Number.isFinite(ms)&&new Date(ms).toISOString()===value,'invalid_time');return ms;}
const IDENTITY=['accountSubjectSha256','goalIdSha256','attemptIdSha256','sourceThreadIdSha256','hostIdSha256','goalVersion','operationId','requestSha256'];
const CONTEXT=['format','kind','nonceSha256','issuedAt','expiresAt','observedSessionId',...IDENTITY,'contextSha256'];
const PRE=['format','phase','tool','contextSha256',...IDENTITY,'observedSessionId','observedCallId','at'];
const WITNESS=['format','kind','contract','status','effect','creationDisposition','contextSha256',...IDENTITY,'observedSessionId','observedCallId','responseSha256','preObservedAt','observedAt'];
function original(value){const {expectedAccountSubject,businessInput}=splitGoalMcpRequest(value);const request=parseGoalTaskInput('reserve',businessInput);return {subject:expectedAccountSubject,request,identity:{
 accountSubjectSha256:hookSha256(expectedAccountSubject),goalIdSha256:hookSha256(request.goalId),attemptIdSha256:hookSha256(request.attemptId),
 sourceThreadIdSha256:hookSha256(request.sourceThreadId),hostIdSha256:hookSha256(request.hostId),goalVersion:request.goalVersion,
 operationId:request.operationId,requestSha256:teachingRequestSha256(request),
}};}
function sameIdentity(value,context){need(IDENTITY.every(key=>value[key]===context[key]),'context_identity_mismatch');}
function validIdentity(value){need(IDENTITY.filter(key=>!['operationId','goalVersion'].includes(key)).every(key=>hash(value[key]))
 &&uuid(value.operationId)&&Number.isSafeInteger(value.goalVersion)&&value.goalVersion>=1&&value.goalVersion<=2147483647,'invalid_identity');}

// Only these two observed metadata fields identify a caller. Environment,
// model arguments, roots and legacy aliases never provide a fallback.
export function readHostSource(params){return safe('invalid_source',()=>{
 const metadata=plain(params)?._meta;
 need(metadata&&uuid(metadata.threadId)&&uuid(metadata.sessionId)&&metadata.threadId===metadata.sessionId,'invalid_source');
 return Object.freeze({threadId:metadata.threadId,sessionId:metadata.sessionId});
});}

// nonce is generated and retained by the owner before the reserve Pre Hook.
// The finite window binds local handoff only; no server receipt timestamp is a lease.
export function createTaskContext({params,nonce,issuedAt,expiresAt,reservationInput}){return safe('invalid_context',()=>{
 need(hash(nonce),'invalid_nonce');const source=readHostSource(params),bound=original(reservationInput);
 need(bound.request.sourceThreadId===source.threadId,'source_mismatch');need(time(expiresAt)>time(issuedAt),'invalid_time');
 const base={format:1,kind:'host_task_context',nonceSha256:hookSha256(nonce),issuedAt,expiresAt,observedSessionId:hookSha256(source.sessionId),...bound.identity};
 return Object.freeze({...base,contextSha256:hookSha256(base)});
});}
function immutableContext(value,nonce){const context=plain(value);need(own(context,CONTEXT)&&context.format===1&&context.kind==='host_task_context','invalid_context');
 validIdentity(context);need(hash(nonce)&&context.nonceSha256===hookSha256(nonce)&&hash(context.contextSha256),'nonce_mismatch');
 const {contextSha256,...base}=context;need(hookSha256(base)===contextSha256,'context_changed');
 need(context.observedSessionId===context.sourceThreadIdSha256,'source_mismatch');
 need(time(context.issuedAt)<time(context.expiresAt),'invalid_time');return context;
}
// Historical identity is not a fresh witness or permission to create/resume.
// Internal readers use this without manufacturing a time inside the old window.
export function validateTaskContextIdentity({context,nonce}){return safe('invalid_context',()=>Object.freeze(immutableContext(context,nonce)));}
function checkContext(value,nonce,at){const context=immutableContext(value,nonce);
 const now=time(at);need(now>=time(context.issuedAt)&&now<time(context.expiresAt),'context_outside_window');return context;
}
function hookEvent(value,phase,context){const event=plain(value);need(event.hook_event_name===phase&&toolFromEvent(event)==='aidesk_goal_task_reserve','invalid_hook');
 need(id(event.session_id)&&hookSha256(event.session_id)===context.observedSessionId&&id(event.tool_use_id),'hook_source_mismatch');
 const bound=original(event.tool_input);sameIdentity(bound.identity,context);return {event,...bound,observedCallId:hookSha256(event.tool_use_id)};
}

export function bindReservePre({context:input,nonce,event,observedAt}){return safe('invalid_pre',()=>{
 const context=checkContext(input,nonce,observedAt),bound=hookEvent(event,'PreToolUse',context);
 return Object.freeze({format:1,phase:'PreToolUse',tool:'aidesk_goal_task_reserve',contextSha256:context.contextSha256,
  ...bound.identity,observedSessionId:context.observedSessionId,observedCallId:bound.observedCallId,at:observedAt});
});}

// Run only inside the Post Hook on its actual tool_response. Failure means no
// local creation witness; it does not undo or relabel a committed reservation.
export function createReserveWitness({context:input,nonce,pre:preInput,event,observedAt}){return safe('invalid_receipt',()=>{
 const context=checkContext(input,nonce,observedAt),pre=plain(preInput),bound=hookEvent(event,'PostToolUse',context);
 need(own(pre,PRE)&&pre.format===1&&pre.phase==='PreToolUse'&&pre.tool==='aidesk_goal_task_reserve','invalid_pre');
 need(pre.contextSha256===context.contextSha256,'pre_context_mismatch');sameIdentity(pre,context);
 need(pre.observedSessionId===context.observedSessionId&&pre.observedCallId===bound.observedCallId,'pre_call_mismatch');
 need(time(pre.at)>=time(context.issuedAt)&&time(pre.at)<=time(observedAt),'pre_outside_window');
 const {businessResult}=readGoalMcpToolResult(bound.event.tool_response,bound.subject);
 need(validGoalTaskResult('reserve',businessResult,bound.request),'invalid_receipt');
 need(businessResult.status==='recorded'&&businessResult.action==='reserve'&&businessResult.effect==='applied'&&businessResult.creationDisposition==='fresh','not_fresh');
 return Object.freeze({format:1,kind:'reserve_witness',contract:'aidesk-goal-task-v1',status:'recorded',effect:'applied',creationDisposition:'fresh',
  contextSha256:context.contextSha256,...bound.identity,observedSessionId:context.observedSessionId,observedCallId:bound.observedCallId,
  responseSha256:hookSha256(bound.event.tool_response),preObservedAt:pre.at,observedAt});
});}

// Inputs must come from the owner's safe ledger reader, not the local MCP args.
// This pure predicate does not consume a nonce or provide atomic exactly-once IO.
export function validateReserveWitness({context:input,nonce,params,witness:inputWitness,now}){return safe('invalid_witness',()=>{
 const context=checkContext(input,nonce,now),source=readHostSource(params),witness=plain(inputWitness);
 need(hookSha256(source.threadId)===context.sourceThreadIdSha256&&hookSha256(source.sessionId)===context.observedSessionId,'source_mismatch');
 need(own(witness,WITNESS)&&witness.format===1&&witness.kind==='reserve_witness'&&witness.contract==='aidesk-goal-task-v1'
  &&witness.status==='recorded'&&witness.effect==='applied'&&witness.creationDisposition==='fresh','invalid_witness');
 need(witness.contextSha256===context.contextSha256,'witness_context_mismatch');sameIdentity(witness,context);
 need(witness.observedSessionId===context.observedSessionId&&hash(witness.observedCallId)&&hash(witness.responseSha256),'invalid_witness');
 need(time(witness.preObservedAt)>=time(context.issuedAt)&&time(witness.observedAt)>=time(witness.preObservedAt)
  &&time(witness.observedAt)<=time(now),'witness_outside_window');
 return Object.freeze(witness);
});}
