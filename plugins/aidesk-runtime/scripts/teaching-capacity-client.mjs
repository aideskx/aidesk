/** Local full-Skill loading accounting. No network, credentials or authority.
 * Missing responses reserve the wire maximum; they never become measured bytes.
 * The caller persists the mutated ledger before dispatch and after observation.
 * Per-call times are client PreToolUse/PostToolUse hook observations, not wire
 * dispatch/arrival or server processing times. Legacy calls retain absent times.
 */
import { randomUUID } from 'node:crypto';
import { canonicalTeachingJson } from './lib/teaching-business-contract.mjs';
import { CAPACITY_PROFILE, validTeachingSkillCapacityInput, validTeachingSkillCapacityResult,
  assembleTeachingSkillCapacity } from './lib/teaching-skill-capacity-contract.mjs';
export const CAPACITY_CLIENT_LIMITS = Object.freeze({ requests: 40, responseBytes: 524288,
  elapsedMs: 180000, attempts: 2, retries: 2, responseMax: 65536 });
export class CapacityClientError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (yes, code) => { if (!yes) throw new CapacityClientError(code); };
const digest = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const id = x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x);
const integer = (x, max) => Number.isSafeInteger(x) && x >= 0 && x <= max;
const hasCallTiming = c => Object.hasOwn(c, 'startedAt') || Object.hasOwn(c, 'finishedAt');
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const sameScope = (a, b) => a && b && ['subject', 'familyId', 'learnerId'].every(k => a[k] === b[k]);
export const capacityActions = new Set(['skill_begin', 'skill_page', 'skill_complete', 'skill_status']);
export function capacityLedger(context, runId, now) {
  return { format: 1, phaseId: randomUUID(), context: structuredClone(context), runId,
    startedAt: now, status: 'loading', calls: [], attempts: 0, retries: 0, current: null };
}
export function checkCapacityLedger(p) {
  need(p?.format === 1 && id(p.phaseId) && id(p.runId) && p.context && id(p.context.clientContextId)
    && Number.isSafeInteger(p.startedAt) && ['loading', 'complete', 'failed'].includes(p.status)
    && integer(p.attempts, 2) && integer(p.retries, 2) && Array.isArray(p.calls) && p.calls.length <= 40,
  'CAPACITY_ACCOUNTING_CORRUPT');
  let retries = 0, previousStartedAt = p.startedAt;
  const seen = new Map(), keys = new Set(), support = new Map(), calls = new Map();
  for (const c of p.calls) {
    need(c && digest(c.key) && digest(c.requestKey) && !keys.has(c.key)
      && (c.bytes === null || integer(c.bytes, 65536) && c.bytes > 0), 'CAPACITY_ACCOUNTING_CORRUPT');
    if (hasCallTiming(c)) {
      need(Object.hasOwn(c, 'startedAt') && Object.hasOwn(c, 'finishedAt')
        && Number.isSafeInteger(c.startedAt) && c.startedAt >= previousStartedAt
        && (c.bytes === null ? c.finishedAt === null
          : Number.isSafeInteger(c.finishedAt) && c.finishedAt >= c.startedAt), 'CAPACITY_ACCOUNTING_CORRUPT');
      previousStartedAt = c.startedAt;
    }
    if (c.supportKey !== undefined) {
      need(digest(c.supportKey) && c.retryable === true
        && ['unverified', 'verified', 'failed'].includes(c.outcome)
        && (c.outcome !== 'verified' || c.bytes !== null), 'CAPACITY_ACCOUNTING_CORRUPT');
      const previous = support.get(c.supportKey);
      if (!previous || previous.requestKey !== c.requestKey) {
        const accepted = calls.get(c.afterVerified);
        need(c.requestKey === c.key && (!previous ? c.afterVerified === null
          : accepted?.supportKey === c.supportKey && accepted.requestKey === previous.requestKey
            && accepted.outcome === 'verified'), 'CAPACITY_ACCOUNTING_CORRUPT');
      } else need(c.afterVerified === previous.afterVerified, 'CAPACITY_ACCOUNTING_CORRUPT');
      support.set(c.supportKey, c);
    }
    keys.add(c.key); calls.set(c.key, c);
    if (c.retryable) { const n = (seen.get(c.requestKey) ?? 0) + 1; seen.set(c.requestKey, n);
      need(n <= 2, 'CAPACITY_ACCOUNTING_CORRUPT'); if (n > 1) retries++; }
  }
  need(retries === p.retries, 'CAPACITY_ACCOUNTING_CORRUPT');
  return p;
}
export function capacityMetrics(p, now) {
  checkCapacityLedger(p);
  return { phaseId: p.phaseId, status: p.status, requests: p.calls.length,
    measuredResponseBytes: p.calls.reduce((n, c) => n + (c.bytes ?? 0), 0),
    unknownResponses: p.calls.filter(c => c.bytes === null).length,
    reservedResponseBytes: p.calls.filter(c => c.bytes === null).length * CAPACITY_CLIENT_LIMITS.responseMax,
    elapsedMs: Math.max(0, now - p.startedAt), attempts: p.attempts, retries: p.retries };
}
export function capacityDeadline(p, now) {
  checkCapacityLedger(p);
  need(p.status === 'loading' || p.status === 'complete', 'CAPACITY_PHASE_CLOSED');
  if (now < p.startedAt || now - p.startedAt >= CAPACITY_CLIENT_LIMITS.elapsedMs) {
    p.status = 'failed'; throw new CapacityClientError('CAPACITY_TIME_BUDGET');
  }
}
export function reserveCapacityCall(p, { key, requestKey, retryable = false, supportKey }, now) {
  capacityDeadline(p, now); const m = capacityMetrics(p, now);
  need(Number.isSafeInteger(now) && now >= (p.calls.findLast(hasCallTiming)?.startedAt ?? p.startedAt),
    'CAPACITY_ACCOUNTING_CORRUPT');
  need(digest(key) && digest(requestKey) && !p.calls.some(c => c.key === key), 'CAPACITY_CALL_CONFLICT');
  if (m.requests >= 40 || m.measuredResponseBytes + m.reservedResponseBytes + 65536 > 524288) {
    p.status = 'failed'; throw new CapacityClientError(m.requests >= 40 ? 'CAPACITY_CALL_BUDGET' : 'CAPACITY_BYTE_BUDGET');
  }
  let afterVerified = null;
  if (supportKey !== undefined) {
    need(digest(supportKey), 'CAPACITY_CALL_CONFLICT');
    const previous = p.calls.findLast(c => c.supportKey === supportKey);
    const accepted = previous && p.calls.findLast(c => c.supportKey === supportKey
      && c.requestKey === previous.requestKey && c.outcome === 'verified');
    // New signing/call IDs cannot renew an unresolved logical read. Only an
    // actually validated response permits a fresh permission/recovery recheck.
    requestKey = previous && !accepted ? previous.requestKey : key;
    afterVerified = previous && !accepted ? previous.afterVerified : accepted?.key ?? null;
    retryable = true;
  }
  if (retryable && p.calls.some(c => c.retryable && c.requestKey === requestKey)) {
    need(p.calls.filter(c => c.retryable && c.requestKey === requestKey).length < 2 && p.retries < 2, 'CAPACITY_RETRY_BUDGET');
    p.retries++;
  }
  p.calls.push({ key, requestKey, retryable, bytes: null, startedAt: now, finishedAt: null,
    ...(supportKey === undefined ? {} : { supportKey, afterVerified, outcome: 'unverified' }) });
}
export function observeCapacityOutcome(p, key, verified) {
  checkCapacityLedger(p); const c = p.calls.find(c => c.key === key);
  need(c?.supportKey && c.outcome === 'unverified' && typeof verified === 'boolean'
    && (!verified || c.bytes !== null), 'CAPACITY_RESPONSE_UNACCOUNTED');
  c.outcome = verified ? 'verified' : 'failed';
}
export function observeCapacityBytes(p, key, finalJsonRpcUtf8Bytes, now, adoptionPending = false) {
  checkCapacityLedger(p); const c = p.calls.find(c => c.key === key);
  need(c && c.bytes === null, 'CAPACITY_RESPONSE_UNACCOUNTED');
  need(Number.isSafeInteger(finalJsonRpcUtf8Bytes) && finalJsonRpcUtf8Bytes > 0 && finalJsonRpcUtf8Bytes <= 65536,
    'CAPACITY_MEASUREMENT_REQUIRED');
  if (hasCallTiming(c)) need(Number.isSafeInteger(now) && now >= c.startedAt, 'CAPACITY_ACCOUNTING_CORRUPT');
  c.bytes = finalJsonRpcUtf8Bytes;
  // Never infer a missing legacy start from the phase start or response time.
  if (hasCallTiming(c)) c.finishedAt = now;
  if (p.status !== 'loading' && !adoptionPending) return; // A late response refines a closed phase's audit only.
  capacityDeadline(p, now);
  const m = capacityMetrics(p, now);
  if (m.measuredResponseBytes + m.reservedResponseBytes > 524288) {
    p.status = 'failed'; throw new CapacityClientError('CAPACITY_BYTE_BUDGET');
  }
}

export function failCapacityPhase(s, reason, now) {
  const p = s.capacityPhase;
  if (p?.status === 'loading') { p.status = 'failed'; p.failedAt ??= now; p.failure ??= reason; }
  // A prior budget failure cannot erase a later real scope transition. Preserve
  // its first failure and any completed load fact; abandonment grants no reuse.
  if (p && reason === 'CAPACITY_CONTEXT_CHANGED') p.scopeAbandoned = true;
}
function capacityHistory(s) {
  const history = s.capacityHistory ?? [];
  need(Array.isArray(history) && history.length <= 16, 'CAPACITY_HISTORY_CORRUPT');
  const seen = new Set();
  for (const h of history) {
    need(h && id(h.phaseId) && !seen.has(h.phaseId) && id(h.runId) && h.context
      && id(h.context.clientContextId) && typeof h.completionPending === 'boolean'
      && ['subject', 'familyId', 'learnerId'].every(k => typeof h.context[k] === 'string' && h.context[k].length > 0)
      && (!h.completionPending || id(h.loadId) && id(h.releaseId) && digest(h.teachingSkillSha256)), 'CAPACITY_HISTORY_CORRUPT');
    seen.add(h.phaseId);
  }
  return history;
}
function pendingCapacityHistory(s) {
  return capacityHistory(s).findLast(h => h.completionPending && sameScope(h.context, s.context));
}
function historicalCapacityRequest(s, input) {
  return capacityHistory(s).find(h => sameScope(h.context, s.context) && input?.familyId === h.context.familyId
    && input.learnerId === h.context.learnerId && input.runId === h.runId && input.loadId === h.loadId
    && input.teachingSkillSha256 === h.teachingSkillSha256);
}
function historyStatusInput(s, h) {
  const input = { familyId: s.context.familyId, learnerId: s.context.learnerId, coreContract: 'aidesk-content-v1',
    profile: CAPACITY_PROFILE, runId: h.runId, loadId: h.loadId, teachingSkillSha256: h.teachingSkillSha256, purpose: 'new' };
  need(validTeachingSkillCapacityInput('status', input), 'CAPACITY_INPUT_INVALID');
  return input;
}
// The live turn is observation of an entry request, not semantic authorization.
// The entry Skill owns interpretation of an explicit new entry after a failure.
export function observeCapacityEntry(s, turnId, now) {
  if (s.capacityPhase?.status === 'failed' && now > (s.capacityPhase.failedAt ?? s.capacityPhase.startedAt))
    s.capacityEntry = { turnId, observedAt: now };
}
export function capacityInput(s, action, args, now, turnId) {
  let p = s.capacityPhase;
  if (p) checkCapacityLedger(p);
  else need(!s.capacityUsed, 'CAPACITY_ACCOUNTING_MISSING');
  const history = pendingCapacityHistory(s);
  if (history) {
    need(action === 'skill_status', 'CAPACITY_COMPLETE_STATUS_REQUIRED');
    // The current verified scope selects the original audit. Model arguments
    // cannot choose another learner, original context, load or package digest.
    return historyStatusInput(s, history);
  }
  if (action === 'skill_begin') {
    need(!s.executionId, 'CAPACITY_EXECUTION_ALREADY_ADOPTED');
    if (p?.status === 'loading' && !same(p.context, s.context)) {
      failCapacityPhase(s, 'CAPACITY_CONTEXT_CHANGED', now); throw new CapacityClientError('CAPACITY_CONTEXT_CHANGED');
    }
    const newRun = p?.status === 'complete' && p.runId !== s.contentRunId;
    const explicitEntry = p?.status === 'failed' && args.restart === true && s.capacityEntry?.turnId === turnId
      && s.capacityEntry.observedAt > (p.failedAt ?? p.startedAt);
    if (!p || newRun || explicitEntry) {
      // A load receipt is not a learning write. Explicitly entering a different
      // learner may abandon its adoption, while its original unknown outcome
      // remains auditable. A new context UUID in the same scope is insufficient.
      const differentEntry = explicitEntry && p.scopeAbandoned === true && !sameScope(p.context, s.context);
      need(!p?.current?.completionPending || differentEntry, 'CAPACITY_COMPLETE_STATUS_REQUIRED');
      need(Array.isArray(s.capacityHistory ?? []) && (s.capacityHistory ?? []).length < 16, 'CAPACITY_HISTORY_LIMIT');
      if (p) s.capacityHistory = [...(s.capacityHistory ?? []), { ...capacityMetrics(p, now), context: p.context,
        startedAt: p.startedAt,
        runId: p.runId, loadId: p.current?.loadId ?? null, releaseId: p.current?.manifest?.releaseId ?? null,
        teachingSkillSha256: p.current?.manifest?.teachingSkillSha256 ?? null,
        manifest: structuredClone(p.current?.manifest ?? null),
        completionPending: p.current?.completionPending === true,
        calls: structuredClone(p.calls), recovery: structuredClone(s.capacityRecovery ?? null),
        failure: p.failure ?? null, entry: explicitEntry ? s.capacityEntry : null,
        adoptionAbandonedForDifferentScope: differentEntry === true }];
      p = s.capacityPhase = capacityLedger(s.context, s.contentRunId, now);
      s.capacityUsed = true; s.capacityEntry = null; s.capacityRecovery = null;
    }
    // A was fully read, but B can become active before the first adoption.
    // Its sole restart belongs to the original phase, including its deadline.
    if (p.status === 'complete' && p.runId === s.contentRunId && args.restart === true) p.status = 'loading';
    capacityDeadline(p, now);
    if (!p.current || args.restart) {
      need(!p.current?.completionPending, 'CAPACITY_COMPLETE_STATUS_REQUIRED');
      need(p.attempts < 2, 'CAPACITY_ATTEMPT_BUDGET');
      if (p.current) {
        p.previousAttempt = { runId: p.runId, loadId: p.current.loadId,
          releaseId: p.current.manifest?.releaseId ?? null, teachingSkillSha256: p.current.manifest?.teachingSkillSha256 ?? null };
        // A completed load receipt permanently binds its run to A. A restart
        // gets a new run as well as load ID, without resetting phase budgets.
        s.contentRunId = randomUUID(); p.runId = s.contentRunId;
      }
      p.attempts++;
      p.current = { loadId: randomUUID(), manifest: null, received: [], completionPending: false, verified: false };
      s.loaded = null;
    }
    return { familyId: s.context.familyId, learnerId: s.context.learnerId, coreContract: 'aidesk-content-v1',
      profile: CAPACITY_PROFILE, runId: s.contentRunId, loadId: p.current.loadId, releaseId: null, purpose: 'new' };
  }
  const returnedScopeAudit = action === 'skill_status' && p?.status === 'failed' && p.scopeAbandoned === true
    && p.current?.completionPending && sameScope(p.context, s.context);
  need(p && (same(p.context, s.context) && p.runId === s.contentRunId || returnedScopeAudit)
    && p.current?.manifest, 'CAPACITY_BEGIN_REQUIRED');
  const c = p.current, m = c.manifest;
  const auditOnly = action === 'skill_status' && p.status === 'failed' && c.completionPending;
  if (!auditOnly) {
    if (p.status !== 'complete') capacityDeadline(p, now);
    else need(action === 'skill_status' && c.verified && c.manifest.status === 'complete', 'CAPACITY_PHASE_CLOSED');
  }
  const input = { familyId: s.context.familyId, learnerId: s.context.learnerId, coreContract: 'aidesk-content-v1',
    profile: CAPACITY_PROFILE, runId: p.runId, loadId: c.loadId, teachingSkillSha256: m.teachingSkillSha256 };
  if (action === 'skill_status') input.purpose = s.executionId ? 'continue' : 'new';
  if (action === 'skill_page') {
    need(!c.completionPending && args.pageIndex <= c.received.length && args.pageIndex < m.pages.length, 'CAPACITY_PAGE_ORDER');
    input.pageIndex = args.pageIndex;
  }
  if (action === 'skill_complete') {
    need(!c.completionPending, 'CAPACITY_COMPLETE_STATUS_REQUIRED');
    need(c.received.length === m.pages.length && c.verified, 'CAPACITY_FULL_BODY_REQUIRED');
  }
  need(validTeachingSkillCapacityInput(action.slice(6), input), 'CAPACITY_INPUT_INVALID');
  return input;
}
export function acceptCapacityResult(s, action, input, value, now, storage) {
  const history = action === 'skill_status' && historicalCapacityRequest(s, input);
  if (history) {
    need(history.completionPending && history.recovery?.phaseId === history.phaseId, 'CAPACITY_RECOVERY_NOT_REQUIRED');
    need(validTeachingSkillCapacityResult('status', value, input, history.manifest ?? undefined), 'CAPACITY_RESULT_INVALID');
    if (value.status === 'not_found') { s.loaded = null; return; }
    need(value.releaseId === history.releaseId && value.teachingSkillSha256 === history.teachingSkillSha256, 'CAPACITY_RESULT_INVALID');
    need(Number.isFinite(Date.parse(value.checkedAt)) && Date.parse(value.checkedAt) <= now
      && now - Date.parse(value.checkedAt) <= 30000, 'CAPACITY_RESULT_STALE');
    if (value.status === 'complete') history.completionPending = false;
    history.recovery.outcome = { status: value.status, loadId: value.loadId, runId: value.runId,
      teachingSkillSha256: value.teachingSkillSha256, completedAt: value.completedAt };
    s.loaded = null; // Auditing an abandoned load never restores its adoption.
    return;
  }
  const p = s.capacityPhase, c = p?.current;
  const returnedScopeAudit = action === 'skill_status' && p?.status === 'failed' && p.scopeAbandoned === true
    && c?.completionPending && sameScope(p.context, s.context);
  need(p && c && (same(p.context, s.context) || returnedScopeAudit)
    && input.runId === p.runId && input.loadId === c.loadId, 'CAPACITY_LATE_RESULT');
  const kind = action.slice(6);
  need(validTeachingSkillCapacityResult(kind, value, input, c.manifest ?? undefined), 'CAPACITY_RESULT_INVALID');
  if (value.status === 'not_found') { s.loaded = null; return; } // Complete remains unknown; no new load ID.
  need(Number.isFinite(Date.parse(value.checkedAt)) && Date.parse(value.checkedAt) <= now
    && now - Date.parse(value.checkedAt) <= 30000, 'CAPACITY_RESULT_STALE');
  if (value.status === 'legacy_available') {
    need(!c.manifest && c.received.length === 0 && !c.verified
      && (!c.legacy || c.legacy.legacyReleaseId === value.legacyReleaseId
        && c.legacy.legacyActiveVersion === value.legacyActiveVersion), 'CAPACITY_LEGACY_CONFLICT');
    c.legacy = value; return;
  }
  if (p.status === 'failed') {
    need(kind === 'status' && c.completionPending && s.capacityRecovery?.phaseId === p.phaseId, 'CAPACITY_PHASE_CLOSED');
    // A separate bounded audit can learn the old load outcome, never adopt it.
    // The learner must explicitly enter again and read the complete new package.
    if (value.status === 'complete') c.completionPending = false;
    s.loaded = null;
    s.capacityRecovery.outcome = { status: value.status, loadId: value.loadId, runId: value.runId,
      teachingSkillSha256: value.teachingSkillSha256, completedAt: value.completedAt };
    return;
  }
  if (kind === 'status' && value.useAllowed !== true) {
    s.loaded = null;
    if (value.status === 'complete') c.completionPending = false;
    c.unavailable = { status: value.status, lifecycle: value.lifecycle, checkedAt: value.checkedAt };
    return;
  }
  if (kind === 'begin') { c.manifest = value; return; }
  if (kind === 'page') {
    need(value.pageIndex <= c.received.length, 'CAPACITY_PAGE_ORDER');
    const old = c.received[value.pageIndex];
    if (old) {
      const { checkedAt: _oldTime, ...previous } = storage.read(c.loadId, value.pageIndex);
      const { checkedAt: _newTime, ...current } = value;
      need(old.sha256 === value.sha256 && same(previous, current), 'CAPACITY_PAGE_CONFLICT');
    }
    else { storage.write(c.loadId, value.pageIndex, value); c.received.push({ pageIndex: value.pageIndex, sha256: value.sha256 }); }
    if (c.received.length === c.manifest.pages.length) {
      assembleTeachingSkillCapacity(c.manifest, c.received.map(x => storage.read(c.loadId, x.pageIndex)));
      c.verified = true;
    }
    return;
  }
  if (value.status === 'complete') {
    need(c.verified && c.received.length === value.pages.length && value.useAllowed === true, 'CAPACITY_FULL_BODY_REQUIRED');
    if (p.status !== 'complete') {
      // Status may reconcile an unknown complete, but cannot replace absent or
      // unobserved local bodies with a server receipt or a cached summary.
      assembleTeachingSkillCapacity(value, c.received.map(x => storage.read(c.loadId, x.pageIndex)));
    }
    s.loaded = { ...value, files: value.files.map(f => ({ ...f })) };
    c.manifest = value; c.completionPending = false; p.status = 'complete'; p.completedAt ??= now;
  } else { need(kind === 'status', 'CAPACITY_COMPLETION_INVALID'); }
}

export function capacityRecoveryRequired(s, input) {
  const history = historicalCapacityRequest(s, input);
  return history ? history.completionPending : s.capacityPhase?.status === 'failed' && s.capacityPhase.current?.completionPending === true;
}
export function reserveCapacityRecovery(s, key, now, input) {
  const p = s.capacityPhase;
  const history = historicalCapacityRequest(s, input);
  need(history ? history.completionPending : p?.status === 'failed' && p.current?.completionPending, 'CAPACITY_RECOVERY_NOT_REQUIRED');
  const phaseId = history ? history.phaseId : p.phaseId;
  let r = history ? history.recovery : s.capacityRecovery;
  if (!r) {
    r = { phaseId, startedAt: now, calls: [], outcome: null };
    if (history) history.recovery = r; else s.capacityRecovery = r;
  }
  need(r && Number.isSafeInteger(r.startedAt) && Array.isArray(r.calls) && r.calls.length <= 2
    && r.phaseId === phaseId && new Set(r.calls.map(c => c.key)).size === r.calls.length
    && r.calls.every(c => digest(c.key) && (c.bytes === null || integer(c.bytes, 65536) && c.bytes > 0)), 'CAPACITY_RECOVERY_CORRUPT');
  need(now >= r.startedAt && now - r.startedAt < 30000 && r.calls.length < 2, 'CAPACITY_RECOVERY_BUDGET');
  need(digest(key) && !r.calls.some(c => c.key === key), 'CAPACITY_CALL_CONFLICT');
  r.calls.push({ key, bytes: null });
}
function capacityRecoveryCall(s, key) {
  const entries = [s.capacityRecovery?.phaseId === s.capacityPhase?.phaseId ? s.capacityRecovery : null,
    ...capacityHistory(s).map(h => h.recovery)].filter(Boolean);
  const matching = entries.filter(r => r.calls?.some(c => c.key === key));
  need(matching.length <= 1, 'CAPACITY_RECOVERY_CORRUPT');
  return matching[0];
}
export function hasCapacityRecoveryCall(s, key) {
  return capacityRecoveryCall(s, key)?.calls.some(c => c.key === key && c.bytes === null) === true;
}
export function observeCapacityRecovery(s, key, bytes, now) {
  const r = capacityRecoveryCall(s, key), c = r?.calls?.find(c => c.key === key);
  need(c && c.bytes === null && integer(bytes, 65536) && bytes > 0,
    'CAPACITY_RECOVERY_MEASUREMENT');
  c.bytes = bytes;
  need(now >= r.startedAt && now - r.startedAt < 30000, 'CAPACITY_RECOVERY_BUDGET');
}
