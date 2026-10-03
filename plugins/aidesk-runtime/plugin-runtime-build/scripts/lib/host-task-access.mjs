import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { ensurePrivateDirectory, verifyPrivateDirectory, createPrivateDirectoryExclusive,
  readPrivateJson, writePrivateJsonExclusive, replacePrivateJson } from './host-data-binding.mjs';
import { sha256, toolFromEvent } from './contract.mjs';
import { loadOwnedTaskIdentity } from './host-task-context.mjs';
import { readTaskRun } from './host-task-runner.mjs';
import { withHostTaskScope } from './host-task-scope.mjs';
import { readHostSource } from '../domain/host-task-contract.mjs';
import { HostTaskAccessError, TASK_ACCESS_WINDOW_MS, accessReadIdentity, createTaskAccess, validateTaskAccess,
  bindTaskAccessPre, createTaskAccessWitness, authorizeTaskAccess } from '../domain/host-task-access-contract.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const need = (ok, kind) => { if (!ok) throw new HostTaskAccessError(kind); };
const equal = (a, b) => sha256(a) === sha256(b);
const clock = now => now ?? new Date().toISOString();
const bounded = error => /^[a-z_]{1,80}$/u.test(error?.kind ?? '') ? error.kind : 'access_io_unavailable';
async function safe(fn) { try { return await fn(); } catch (error) { throw error instanceof HostTaskAccessError ? error : new HostTaskAccessError(bounded(error)); } }
async function optional(path) { try { return await readPrivateJson(path); } catch (error) { if (error.kind === 'not_found') return null; throw error; } }
function layout(dataRoot) {
  need(typeof dataRoot === 'string' && dataRoot === resolve(dataRoot), 'invalid_data_root');
  const root = join(dataRoot, 'host-tasks');
  return { dataRoot, root, accesses: join(root, 'accesses'), index: join(root, 'access-by-read'), calls: join(root, 'access-calls') };
}
async function directories(l, create = false) {
  await verifyPrivateDirectory(l.dataRoot);
  for (const path of [l.root, l.accesses, l.index, l.calls]) await (create ? ensurePrivateDirectory : verifyPrivateDirectory)(path);
}
const indexKey = value => sha256({ accountSubjectSha256: value.accountSubjectSha256,
  observedSessionId: value.observedSessionId, requestSha256: value.requestSha256 });
const pointer = access => ({ format: 1, kind: 'task_access_index', accessId: access.accessId, contextId: access.contextId,
  accessSha256: access.accessSha256, accountSubjectSha256: access.accountSubjectSha256, goalIdSha256: access.goalIdSha256 });
async function load(l, accessId, now) {
  need(UUID.test(accessId), 'invalid_access_id'); await directories(l);
  const directory = join(l.accesses, accessId); await verifyPrivateDirectory(directory);
  const record = (await readPrivateJson(join(directory, 'prepared.json'))).value;
  need(record && Object.keys(record).sort().join(',') === 'access,format,kind,nonce'
    && record.format === 1 && record.kind === 'task_access_prepared', 'invalid_access');
  const access = validateTaskAccess({ access: record.access, nonce: record.nonce, now });
  need(access.accessId === accessId, 'invalid_access');
  const current = (await readPrivateJson(join(l.index, `${indexKey(access)}.json`))).value;
  need(equal(current, pointer(access)), 'access_superseded');
  const owner = await loadOwnedTaskIdentity(l.dataRoot, access.contextId);
  need(owner.context.contextSha256 === access.creationContextSha256, 'owner_context_changed');
  return { access, nonce: record.nonce, directory, owner };
}
async function unconsumed(directory) { need(await optional(join(directory, 'consumed.json')) === null, 'access_consumed'); }
function matchContext(contextId, access) {
  need(typeof contextId === 'string' && HASH.test(contextId), 'invalid_context_id');
  need(contextId === access.contextId, 'access_context_mismatch');
}

// Optional caller context is an assertion about the existing access, never a
// replacement target. Check before CLI discovery; consumption rechecks it below.
export async function assertTaskAccessContext(dataRoot, { accessId, contextId, now } = {}) {
  return safe(async () => {
    need(typeof contextId === 'string' && HASH.test(contextId), 'invalid_context_id');
    const selected = await load(layout(dataRoot), accessId, clock(now));
    matchContext(contextId, selected.access);
  });
}

// Only the MCP owner supplies params and the data root. The returned read input
// is a normal authority request; no nonce, task identity, path or receipt is sent.
export async function prepareTaskAccess(dataRoot, { params, expectedAccountSubject, goalId, contextId, action, now } = {}) {
  return safe(async () => {
    need(HASH.test(contextId), 'invalid_context_id'); readHostSource(params);
    const readInput = { contract: 'aidesk-goal-task-v1', goalId, view: 'snapshot', budgetBytes: 24576, expectedAccountSubject };
    const read = accessReadIdentity(readInput), owner = await loadOwnedTaskIdentity(dataRoot, contextId);
    need(read.accountSubjectSha256 === owner.context.accountSubjectSha256 && read.goalIdSha256 === owner.context.goalIdSha256, 'owner_scope_mismatch');
    return withHostTaskScope(dataRoot, read, async () => {
    const currentOwner = await loadOwnedTaskIdentity(dataRoot, contextId);
    need(currentOwner.context.contextSha256 === owner.context.contextSha256, 'owner_context_changed');
    const ownerState = await readTaskRun(currentOwner.directory);
    const issuedAt = clock(now), nonce = randomBytes(32).toString('hex'), accessId = randomUUID();
    const access = createTaskAccess({ params, nonce, accessId, owner: currentOwner, ownerState, readInput, action,
      issuedAt, expiresAt: new Date(Date.parse(issuedAt) + TASK_ACCESS_WINDOW_MS).toISOString() });
    const l = layout(dataRoot); await directories(l, true);
    const directory = join(l.accesses, accessId); await createPrivateDirectoryExclusive(directory);
    await writePrivateJsonExclusive(join(directory, 'prepared.json'), { format: 1, kind: 'task_access_prepared', access, nonce });
    const file = join(l.index, `${indexKey(access)}.json`), previous = await optional(file);
    if (previous) await replacePrivateJson(file, pointer(access), { expectedSha256: previous.sha256 });
    else await writePrivateJsonExclusive(file, pointer(access));
    await load(l, accessId, issuedAt);
    return { accessId, contextId, action, issuedAt, expiresAt: access.expiresAt,
      tool: 'aidesk_goal_task_read', input: readInput, creationPermission: false };
    });
  });
}

function hookIdentity(event) {
  if (toolFromEvent(event) !== 'aidesk_goal_task_read' || !['PreToolUse', 'PostToolUse'].includes(event?.hook_event_name)
    || event.tool_input?.view !== 'snapshot') return null;
  const read = accessReadIdentity(event.tool_input);
  need(UUID.test(event.session_id) && typeof event.tool_use_id === 'string' && event.tool_use_id.length > 0
    && event.tool_use_id.length <= 512 && event.tool_use_id.isWellFormed() && !/[\p{Cc}]/u.test(event.tool_use_id), 'invalid_hook_source');
  return { ...read, observedSessionId: sha256(event.session_id), observedCallId: sha256(event.tool_use_id) };
}
async function callDirectory(l, id) { const directory = join(l.calls, id.observedSessionId); await ensurePrivateDirectory(directory); return directory; }
function claimFor(id, selected, pre, at) {
  return { format: 1, kind: 'task_read_call', accountSubjectSha256: id.accountSubjectSha256, goalIdSha256: id.goalIdSha256,
    requestSha256: id.requestSha256, observedSessionId: id.observedSessionId, observedCallId: id.observedCallId,
    accessId: selected?.access.accessId ?? null, accessSha256: selected?.access.accessSha256 ?? null,
    preSha256: pre ? sha256(pre) : null, at };
}
function sameCall(record, id) {
  need(record?.format === 1 && record.kind === 'task_read_call'
    && ['accountSubjectSha256', 'goalIdSha256', 'requestSha256', 'observedSessionId', 'observedCallId'].every(key => record[key] === id[key]), 'read_call_conflict');
}

// Invoke solely with actual Hook input. Failed observation never denies the
// authority read. Unprepared Pre tombstones prevent retroactive nonce binding.
export async function observeTaskAccessHook(dataRoot, event, { observedAt } = {}) {
  try {
    const id = hookIdentity(event); if (!id) return { status: 'not_applicable' };
    return await withHostTaskScope(dataRoot, id, async () => {
    const l = layout(dataRoot), at = clock(observedAt); await directories(l, true);
    const calls = await callDirectory(l, id), file = join(calls, `${id.observedCallId}.json`);
    if (event.hook_event_name === 'PreToolUse') {
      let selected = null, pre = null;
      const index = await optional(join(l.index, `${indexKey(id)}.json`));
      if (index) {
        try {
          selected = await load(l, index.value.accessId, at); await unconsumed(selected.directory);
          pre = bindTaskAccessPre({ ...selected, event, observedAt: at });
        } catch (error) {
          if (!['access_outside_window', 'access_consumed'].includes(error?.kind)) throw error;
          selected = null; pre = null;
        }
      }
      const proposed = claimFor(id, selected, pre, at), previous = await optional(file);
      if (previous) {
        sameCall(previous.value, id);
        if (!selected) return { status: 'not_applicable' };
        need(previous.value.accessId === selected.access.accessId && previous.value.accessSha256 === selected.access.accessSha256, 'pre_not_fresh');
        const original = await optional(join(selected.directory, 'pre.json')); need(original, 'pre_not_previously_bound');
        const replay = bindTaskAccessPre({ ...selected, event, observedAt: original.value.at });
        need(equal(original.value, replay) && previous.value.preSha256 === sha256(replay), 'pre_replay_mismatch');
      } else {
        await writePrivateJsonExclusive(file, proposed);
        if (selected) await writePrivateJsonExclusive(join(selected.directory, 'pre.json'), pre);
      }
      return selected ? { status: 'pre_bound', accessId: selected.access.accessId } : { status: 'not_applicable' };
    }
    const stored = await optional(file); need(stored, 'pre_missing'); sameCall(stored.value, id);
    if (stored.value.accessId === null) return { status: 'not_applicable' };
    const selected = await load(l, stored.value.accessId, at); await unconsumed(selected.directory);
    need(stored.value.accessSha256 === selected.access.accessSha256, 'pre_not_fresh');
    const pre = (await readPrivateJson(join(selected.directory, 'pre.json'))).value;
    need(sha256(pre) === stored.value.preSha256, 'pre_call_conflict');
    const fileWitness = join(selected.directory, 'witness.json'), previous = await optional(fileWitness);
    const witness = createTaskAccessWitness({ ...selected, pre, event, observedAt: previous?.value.observedAt ?? at });
    if (previous) need(equal(previous.value, witness), 'witness_replay_mismatch');
    else await writePrivateJsonExclusive(fileWitness, witness);
    return { status: 'witness_saved', accessId: selected.access.accessId };
    });
  } catch (error) { return { status: 'rejected', error: bounded(error) }; }
}

// Consumes one access BEFORE an effect. A failed or unknown following resume
// cannot reuse it. A caller must reconcile the exact local run, never create a
// replacement task. Cloud read facts and actual owner state stay separate.
export async function consumeTaskAccess(dataRoot, { params, accessId, action, contextId, now } = {}) {
  return safe(async () => {
    if (contextId !== undefined) need(typeof contextId === 'string' && HASH.test(contextId), 'invalid_context_id');
    const l = layout(dataRoot), initial = await load(l, accessId, clock(now));
    if (contextId !== undefined) matchContext(contextId, initial.access);
    return withHostTaskScope(dataRoot, initial.access, async () => {
    const selected = await load(l, accessId, clock(now));
    if (contextId !== undefined) matchContext(contextId, selected.access);
    await unconsumed(selected.directory);
    const pre = (await readPrivateJson(join(selected.directory, 'pre.json'))).value;
    const witness = (await readPrivateJson(join(selected.directory, 'witness.json'))).value;
    const call = (await readPrivateJson(join(l.calls, pre.observedSessionId, `${pre.observedCallId}.json`))).value;
    need(call.accessId === accessId && call.accessSha256 === selected.access.accessSha256 && call.preSha256 === sha256(pre)
      && pre.at === witness.preObservedAt && pre.observedCallId === witness.observedCallId, 'pre_witness_mismatch');
    const ownerState = await readTaskRun(selected.owner.directory);
    const checkedAt = clock(now);
    authorizeTaskAccess({ ...selected, params, witness, ownerState, action, now: checkedAt });
    await load(l, accessId, checkedAt);
    const consumedAt = clock(now);
    validateTaskAccess({ ...selected, now: consumedAt });
    const intent = { format: 1, kind: 'task_access_consumed', accessId, accessSha256: selected.access.accessSha256,
      contextId: selected.access.contextId, action, accountSubjectSha256: selected.access.accountSubjectSha256,
      goalIdSha256: selected.access.goalIdSha256, witnessSha256: sha256(witness), ownerRunId: ownerState.runId,
      taskThreadIdSha256: sha256(ownerState.threadId), at: consumedAt, automaticRetry: false };
    await writePrivateJsonExclusive(join(selected.directory, 'consumed.json'), intent);
    return { contextId: selected.access.contextId, contextSha256: selected.access.creationContextSha256,
      directory: selected.owner.directory, taskThreadId: ownerState.threadId, ownerState, witness,
      accessId, action, creationPermission: false, automaticRetry: false };
    });
  });
}
