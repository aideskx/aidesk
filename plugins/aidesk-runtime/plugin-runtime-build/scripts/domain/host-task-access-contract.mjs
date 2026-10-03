// A fresh authenticated read permits access to an existing local task; it never
// grants another creation or upgrades a cloud source claim into host evidence.
import { parseGoalTaskInput, validGoalTaskResult, splitGoalMcpRequest, readGoalMcpToolResult,
  teachingRequestSha256, canonicalTeachingJson, parseTeachingJson, hookSha256, toolFromEvent } from './host-task-authority.generated.mjs';
import { readHostSource } from './host-task-contract.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const ACTIONS = ['read', 'resume', 'interrupt'];
export const TASK_ACCESS_WINDOW_MS = 120000;
export class HostTaskAccessError extends Error { constructor(kind) { super(`host_task_access:${kind}`); this.kind = kind; } }
const need = (ok, kind) => { if (!ok) throw new HostTaskAccessError(kind); };
const plain = value => parseTeachingJson(canonicalTeachingJson(value), 1048576);
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
function safe(kind, fn) { try { return fn(); } catch (error) { throw error instanceof HostTaskAccessError ? error : new HostTaskAccessError(kind); } }
function time(value) { need(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'invalid_time'); return Date.parse(value); }
const BASE = ['format', 'kind', 'accessId', 'contextId', 'creationContextSha256', 'action', 'nonceSha256', 'issuedAt', 'expiresAt',
  'accountSubjectSha256', 'goalIdSha256', 'attemptIdSha256', 'hostIdSha256', 'reservationOperationId', 'reservationRequestSha256',
  'sourceThreadIdSha256', 'observedSessionId', 'requestSha256', 'ownerRunId', 'taskThreadIdSha256'];
const PRE = ['format', 'kind', 'accessId', 'accessSha256', 'requestSha256', 'accountSubjectSha256', 'goalIdSha256', 'observedSessionId', 'observedCallId', 'at'];
const WITNESS = ['format', 'kind', 'accessId', 'accessSha256', 'requestSha256', 'accountSubjectSha256', 'goalIdSha256', 'attemptIdSha256',
  'hostIdSha256', 'taskThreadIdSha256', 'observedSessionId', 'observedCallId', 'responseSha256', 'currentGoalVersion',
  'decisionVersion', 'decisionGoalVersion', 'decisionIntent', 'preObservedAt', 'observedAt'];

export function accessReadIdentity(input) { return safe('invalid_read_request', () => {
  const { expectedAccountSubject, businessInput } = splitGoalMcpRequest(input);
  const request = parseGoalTaskInput('read', businessInput); need(request.view === 'snapshot', 'snapshot_required');
  return { subject: expectedAccountSubject, request, accountSubjectSha256: hookSha256(expectedAccountSubject),
    goalIdSha256: hookSha256(request.goalId), requestSha256: teachingRequestSha256(request) };
}); }

export function createTaskAccess({ params, nonce, accessId, owner, ownerState, readInput, action, issuedAt, expiresAt }) {
  return safe('invalid_access', () => {
    const source = readHostSource(params), read = accessReadIdentity(readInput), c = owner.context;
    need(HASH.test(nonce) && UUID.test(accessId) && HASH.test(owner.contextId) && HASH.test(c.contextSha256), 'invalid_access');
    need(ACTIONS.includes(action), 'invalid_action');
    need(time(expiresAt) - time(issuedAt) === TASK_ACCESS_WINDOW_MS, 'invalid_access_window');
    need(read.accountSubjectSha256 === c.accountSubjectSha256 && read.goalIdSha256 === c.goalIdSha256, 'owner_scope_mismatch');
    need(ownerState.contextId === owner.contextId && UUID.test(ownerState.runId) && UUID.test(ownerState.threadId), 'owner_task_unknown');
    const base = { format: 1, kind: 'host_task_access', accessId, contextId: owner.contextId, creationContextSha256: c.contextSha256,
      action, nonceSha256: hookSha256(nonce), issuedAt, expiresAt, accountSubjectSha256: c.accountSubjectSha256,
      goalIdSha256: c.goalIdSha256, attemptIdSha256: c.attemptIdSha256, hostIdSha256: c.hostIdSha256,
      reservationOperationId: c.operationId, reservationRequestSha256: c.requestSha256,
      sourceThreadIdSha256: hookSha256(source.threadId), observedSessionId: hookSha256(source.sessionId),
      requestSha256: read.requestSha256, ownerRunId: ownerState.runId, taskThreadIdSha256: hookSha256(ownerState.threadId) };
    return Object.freeze({ ...base, accessSha256: hookSha256(base) });
  });
}
export function validateTaskAccess({ access: input, nonce, now }) { return safe('invalid_access', () => {
  const access = plain(input); need(exact(access, [...BASE, 'accessSha256']) && access.format === 1 && access.kind === 'host_task_access', 'invalid_access');
  need(UUID.test(access.accessId) && UUID.test(access.ownerRunId) && UUID.test(access.reservationOperationId) && ACTIONS.includes(access.action), 'invalid_access');
  need(BASE.filter(key => key.endsWith('Sha256') || key === 'contextId' || key === 'observedSessionId').every(key => HASH.test(access[key])), 'invalid_access');
  const { accessSha256, ...base } = access; need(HASH.test(accessSha256) && hookSha256(base) === accessSha256, 'access_changed');
  need(HASH.test(nonce) && hookSha256(nonce) === access.nonceSha256, 'nonce_mismatch');
  need(access.sourceThreadIdSha256 === access.observedSessionId, 'source_mismatch');
  need(time(access.expiresAt) - time(access.issuedAt) === TASK_ACCESS_WINDOW_MS
    && time(now) >= time(access.issuedAt) && time(now) < time(access.expiresAt), 'access_outside_window');
  return access;
}); }
function eventFor(event, phase, access) {
  const value = plain(event); need(value.hook_event_name === phase && toolFromEvent(value) === 'aidesk_goal_task_read', 'invalid_hook');
  need(UUID.test(value.session_id) && hookSha256(value.session_id) === access.observedSessionId
    && typeof value.tool_use_id === 'string' && value.tool_use_id.length > 0 && value.tool_use_id.length <= 512
    && value.tool_use_id.isWellFormed() && !/[\p{Cc}]/u.test(value.tool_use_id), 'hook_source_mismatch');
  const read = accessReadIdentity(value.tool_input);
  need(['accountSubjectSha256', 'goalIdSha256', 'requestSha256'].every(key => read[key] === access[key]), 'read_request_mismatch');
  return { event: value, read, observedCallId: hookSha256(value.tool_use_id) };
}
export function bindTaskAccessPre({ access: input, nonce, event, observedAt }) { return safe('invalid_pre', () => {
  const access = validateTaskAccess({ access: input, nonce, now: observedAt }), call = eventFor(event, 'PreToolUse', access);
  return Object.freeze({ format: 1, kind: 'task_access_pre', accessId: access.accessId, accessSha256: access.accessSha256,
    requestSha256: access.requestSha256, accountSubjectSha256: access.accountSubjectSha256, goalIdSha256: access.goalIdSha256,
    observedSessionId: access.observedSessionId, observedCallId: call.observedCallId, at: observedAt });
}); }
export function createTaskAccessWitness({ access: input, nonce, pre: inputPre, event, observedAt }) { return safe('invalid_read_receipt', () => {
  const access = validateTaskAccess({ access: input, nonce, now: observedAt }), pre = plain(inputPre), call = eventFor(event, 'PostToolUse', access);
  need(exact(pre, PRE) && pre.format === 1 && pre.kind === 'task_access_pre', 'invalid_pre');
  need(['accessId', 'accessSha256', 'requestSha256', 'accountSubjectSha256', 'goalIdSha256', 'observedSessionId'].every(key => pre[key] === access[key])
    && pre.observedCallId === call.observedCallId, 'pre_call_mismatch');
  need(time(pre.at) >= time(access.issuedAt) && time(pre.at) <= time(observedAt), 'pre_outside_window');
  const { businessResult } = readGoalMcpToolResult(call.event.tool_response, call.read.subject);
  need(validGoalTaskResult('read', businessResult, call.read.request), 'invalid_read_receipt');
  need(businessResult.status === 'found', 'task_not_found');
  const snapshot = businessResult.snapshot, reservation = snapshot.reservation, creation = snapshot.creation;
  need(hookSha256(reservation.attemptId) === access.attemptIdSha256 && hookSha256(reservation.hostId) === access.hostIdSha256
    && reservation.operationId === access.reservationOperationId && teachingRequestSha256(reservation) === access.reservationRequestSha256, 'reservation_mismatch');
  need(creation?.status === 'created' && creation.task && hookSha256(creation.task.threadId) === access.taskThreadIdSha256
    && hookSha256(creation.task.hostId) === access.hostIdSha256, 'cloud_task_mismatch');
  return Object.freeze({ format: 1, kind: 'task_access_witness', accessId: access.accessId, accessSha256: access.accessSha256,
    requestSha256: access.requestSha256, accountSubjectSha256: access.accountSubjectSha256, goalIdSha256: access.goalIdSha256,
    attemptIdSha256: access.attemptIdSha256, hostIdSha256: access.hostIdSha256, taskThreadIdSha256: access.taskThreadIdSha256,
    observedSessionId: access.observedSessionId, observedCallId: call.observedCallId, responseSha256: hookSha256(call.event.tool_response),
    currentGoalVersion: snapshot.currentGoalVersion, decisionVersion: snapshot.decision.version,
    decisionGoalVersion: snapshot.decision.goalVersion, decisionIntent: snapshot.decision.intent, preObservedAt: pre.at, observedAt });
}); }

export function authorizeTaskAccess({ access: input, nonce, params, witness: inputWitness, ownerState, action, now }) { return safe('invalid_access_witness', () => {
  const access = validateTaskAccess({ access: input, nonce, now }), source = readHostSource(params), witness = plain(inputWitness);
  need(action === access.action, 'access_action_mismatch');
  need(hookSha256(source.threadId) === access.sourceThreadIdSha256 && hookSha256(source.sessionId) === access.observedSessionId, 'source_mismatch');
  need(exact(witness, WITNESS) && witness.format === 1 && witness.kind === 'task_access_witness', 'invalid_access_witness');
  need(['accessId', 'accessSha256', 'requestSha256', 'accountSubjectSha256', 'goalIdSha256', 'attemptIdSha256', 'hostIdSha256', 'taskThreadIdSha256', 'observedSessionId']
    .every(key => witness[key] === access[key]) && HASH.test(witness.observedCallId) && HASH.test(witness.responseSha256), 'witness_mismatch');
  need(['currentGoalVersion', 'decisionVersion', 'decisionGoalVersion'].every(key => Number.isSafeInteger(witness[key]) && witness[key] >= 1)
    && witness.decisionGoalVersion <= witness.currentGoalVersion && ['active', 'paused', 'ended'].includes(witness.decisionIntent), 'invalid_access_witness');
  need(time(witness.preObservedAt) >= time(access.issuedAt) && time(witness.observedAt) >= time(witness.preObservedAt)
    && time(witness.observedAt) <= time(now), 'witness_outside_window');
  need(ownerState.contextId === access.contextId && ownerState.runId === access.ownerRunId && UUID.test(ownerState.threadId)
    && hookSha256(ownerState.threadId) === access.taskThreadIdSha256, 'owner_task_changed');
  if (action === 'resume') {
    need(witness.decisionIntent === 'active' && witness.decisionGoalVersion === witness.currentGoalVersion, 'decision_not_active');
    need(['completed', 'interrupted', 'failed', 'busy'].includes(ownerState.status) && ownerState.readyForResume === true, 'owner_not_resumable');
    need(ownerState.threadId !== source.threadId, 'cannot_resume_source');
  } else if (action === 'interrupt') {
    need(ownerState.status !== 'unknown' && (['completed', 'interrupted', 'failed', 'busy'].includes(ownerState.status)
      || ['starting', 'running', 'interrupt_requested'].includes(ownerState.status) && ownerState.workerReachable === true), 'owner_control_unknown');
  }
  return Object.freeze(witness);
}); }
