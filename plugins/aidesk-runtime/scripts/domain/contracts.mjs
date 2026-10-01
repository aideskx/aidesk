import { canonical, sha256 } from '../lib/contract.mjs';

export class DomainError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'DomainError'; this.code = code; this.details = details; }
}

const GOAL_STATES = new Set(['draft', 'ready_to_start', 'accepted', 'active', 'paused', 'result_ready', 'ended', 'cancelled']);
const GOAL_TRANSITIONS = {
  draft: new Set(['ready_to_start', 'cancelled']), ready_to_start: new Set(['accepted', 'cancelled']),
  accepted: new Set(['active', 'paused', 'cancelled']), active: new Set(['paused', 'result_ready', 'ended']),
  paused: new Set(['active', 'ended']), result_ready: new Set(['active', 'ended']),
  ended: new Set(), cancelled: new Set(),
};

export function assertEnvelope(input, { write = true } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('invalid_input', '请求必须是对象');
  for (const field of ['contract', ...(write ? ['operationId', 'requestSha256'] : [])]) if (typeof input[field] !== 'string' || !input[field]) throw new DomainError('invalid_input', `${field} 必填`);
  if (write && !/^[a-f0-9]{64}$/u.test(input.requestSha256)) throw new DomainError('invalid_input', 'requestSha256 必须是 SHA-256');
  return input;
}

export function requestDigest(input) {
  const body = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'requestSha256'));
  return sha256(canonical(body));
}

export function verifyRequestDigest(input) {
  assertEnvelope(input); if (input.requestSha256 !== requestDigest(input)) throw new DomainError('source_mismatch', '请求摘要与规范化输入不一致'); return true;
}

export function transitionGoal(current, next) {
  if (!GOAL_STATES.has(current) || !GOAL_STATES.has(next)) throw new DomainError('invalid_input', '未知目标状态');
  if (current === next) return next;
  if (!GOAL_TRANSITIONS[current].has(next)) throw new DomainError('version_conflict', `目标不能从 ${current} 变为 ${next}`);
  return next;
}

export function resultEnvelope(input, status, extra = {}) {
  assertEnvelope(input, { write: false });
  if (!['succeeded', 'recorded', 'rejected', 'failed', 'unknown', 'pending', 'not_found', 'cancelled', 'closed', 'deleted'].includes(status)) throw new DomainError('invalid_input', '未知结果状态');
  return { contract: input.contract, operationId: input.operationId ?? null, requestSha256: input.requestSha256 ?? null, status, recordedAt: new Date().toISOString(), ...extra };
}

export function reconcile(original, result) {
  assertEnvelope(original); assertEnvelope(result, { write: false });
  if (result.operationId !== original.operationId || result.requestSha256 !== original.requestSha256) throw new DomainError('source_mismatch', '回执没有对应同一原号和摘要');
  return result;
}
