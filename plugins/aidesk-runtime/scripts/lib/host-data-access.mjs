// A fresh authenticated preview permits only local metadata export. These
// bounded authorization records may outlive a goal tombstone; they never grant
// task creation, resume, deletion, or any cloud write.
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, toolFromEvent } from './contract.mjs';
import { readHostSource } from '../domain/host-task-contract.mjs';
import { splitGoalMcpRequest, parseGoalDataDeleteInput, validGoalDataDeleteResult,
  readGoalMcpToolResult, teachingRequestSha256 } from '../domain/host-task-authority.generated.mjs';
import { hostTaskScopeId, withHostTaskScope } from './host-task-scope.mjs';
import { verifyPrivateDirectory, ensurePrivateDirectory, createPrivateDirectoryExclusive,
  readPrivateJson, writePrivateJsonExclusive, replacePrivateJson } from './host-data-binding.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const WINDOW_MS = 120000, TOOL = 'aidesk_goal_data_delete_preview';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const clock = now => now ?? new Date().toISOString();
const equal = (a, b) => sha256(a) === sha256(b);
export class HostDataAccessError extends Error { constructor(kind) { super(`host_data_access:${kind}`); this.kind = kind; } }
const need = (ok, kind) => { if (!ok) throw new HostDataAccessError(kind); };
const bounded = error => /^[a-z_]{1,80}$/u.test(error?.kind ?? '') ? error.kind : 'data_access_unavailable';
async function safe(fn) { try { return await fn(); } catch (error) { throw error instanceof HostDataAccessError ? error : new HostDataAccessError(bounded(error)); } }
async function optional(path) { try { return await readPrivateJson(path); } catch (error) { if (error.kind === 'not_found') return null; throw error; } }
const scopeOf = value => ({ accountSubjectSha256: value.accountSubjectSha256, goalIdSha256: value.goalIdSha256 });
const scoped = value => ({ ...scopeOf(value), scopeId: hostTaskScopeId(value) });
const indexKey = value => sha256({ accountSubjectSha256: value.accountSubjectSha256,
  observedSessionId: value.observedSessionId, requestSha256: value.requestSha256 });
const pointer = access => ({ format: 1, kind: 'data_export_index', ...scoped(access), accessId: access.accessId, accessSha256: access.accessSha256 });
const roots = (dataRoot, scopeId) => {
  need(HASH.test(scopeId), 'invalid_scope_id');
  const root = join(dataRoot, 'host-tasks/scopes', scopeId);
  return { root, accesses: join(root, 'data-exports'), index: join(root, 'data-export-by-read'), calls: join(root, 'data-export-calls') };
};
async function directories(paths, create = false) {
  await verifyPrivateDirectory(paths.root);
  for (const path of [paths.accesses, paths.index, paths.calls]) await (create ? ensurePrivateDirectory : verifyPrivateDirectory)(path);
}
function readIdentity(args) {
  const { expectedAccountSubject, businessInput } = splitGoalMcpRequest(args), input = parseGoalDataDeleteInput('preview', businessInput);
  return { input, expectedAccountSubject, ...scoped({ accountSubjectSha256: sha256(expectedAccountSubject), goalIdSha256: sha256(input.goalId) }),
    requestSha256: teachingRequestSha256(input) };
}
const ACCESS_KEYS = ['format', 'kind', 'accessId', 'scopeId', 'accountSubjectSha256', 'goalIdSha256', 'observedSessionId', 'requestSha256', 'nonceSha256', 'issuedAt', 'expiresAt', 'accessSha256'];
function validatePrepared(value) {
  need(exact(value, ['format', 'kind', 'scopeId', 'accountSubjectSha256', 'goalIdSha256', 'access', 'nonce'])
    && value.format === 1 && value.kind === 'data_export_prepared' && HASH.test(value.nonce), 'invalid_export_access');
  const a = value.access;
  need(exact(a, ACCESS_KEYS) && a.format === 1 && a.kind === 'data_export_access' && UUID.test(a.accessId)
    && ACCESS_KEYS.filter(k => k.endsWith('Sha256') || ['scopeId', 'observedSessionId'].includes(k)).every(k => HASH.test(a[k]))
    && iso(a.issuedAt) && iso(a.expiresAt) && Date.parse(a.expiresAt) - Date.parse(a.issuedAt) === WINDOW_MS, 'invalid_export_access');
  const { accessSha256, ...base } = a;
  need(sha256(base) === accessSha256 && a.nonceSha256 === sha256(value.nonce)
    && equal(scoped(a), scoped(value)) && a.scopeId === hostTaskScopeId(a) && value.scopeId === a.scopeId, 'invalid_export_access');
  return a;
}
function fresh(access, now) { need(iso(now) && Date.parse(now) >= Date.parse(access.issuedAt) && Date.parse(now) < Date.parse(access.expiresAt), 'export_access_expired'); }
async function load(dataRoot, scopeId, accessId, now) {
  need(UUID.test(accessId), 'invalid_access_id'); const paths = roots(dataRoot, scopeId); await directories(paths);
  const directory = join(paths.accesses, accessId); await verifyPrivateDirectory(directory);
  const prepared = (await readPrivateJson(join(directory, 'prepared.json'))).value, access = validatePrepared(prepared);
  need(access.scopeId === scopeId && access.accessId === accessId, 'invalid_export_access'); fresh(access, now);
  need(equal((await readPrivateJson(join(paths.index, `${indexKey(access)}.json`))).value, pointer(access)), 'export_access_superseded');
  return { access, directory, paths };
}
async function unconsumed(directory) { need(await optional(join(directory, 'consumed.json')) === null, 'export_access_consumed'); }
const identityKeys = ['scopeId', 'accountSubjectSha256', 'goalIdSha256', 'requestSha256', 'observedSessionId'];
const matchesIdentity = (a, b) => identityKeys.every(k => a[k] === b[k]);

export async function prepareDataExport(dataRoot, { params, expectedAccountSubject, goalId, now } = {}) {
  return safe(async () => {
    const source = readHostSource(params), input = { contract: 'aidesk-goal-data-delete-v5', goalId, expectedAccountSubject };
    const id = readIdentity(input), paths = roots(dataRoot, id.scopeId);
    return withHostTaskScope(dataRoot, id, async () => {
      await directories(paths, true); const issuedAt = clock(now); need(iso(issuedAt), 'invalid_time');
      const nonce = randomBytes(32).toString('hex'), accessId = randomUUID();
      const base = { format: 1, kind: 'data_export_access', accessId, ...scoped(id), observedSessionId: sha256(source.sessionId),
        requestSha256: id.requestSha256, nonceSha256: sha256(nonce), issuedAt, expiresAt: new Date(Date.parse(issuedAt) + WINDOW_MS).toISOString() };
      const access = { ...base, accessSha256: sha256(base) }, directory = join(paths.accesses, accessId);
      await createPrivateDirectoryExclusive(directory);
      await writePrivateJsonExclusive(join(directory, 'prepared.json'), { format: 1, kind: 'data_export_prepared', ...scoped(id), access, nonce });
      const path = join(paths.index, `${indexKey(access)}.json`), old = await optional(path);
      if (old) await replacePrivateJson(path, pointer(access), { expectedSha256: old.sha256 });
      else await writePrivateJsonExclusive(path, pointer(access));
      return { scopeId: id.scopeId, accessId, tool: TOOL, input, issuedAt, expiresAt: access.expiresAt, permission: 'local_metadata_export_only' };
    }, { allowDeleted: true });
  });
}

function preRecord(access, id, at) {
  need(matchesIdentity(access, id) && HASH.test(id.observedCallId), 'export_pre_mismatch'); fresh(access, at);
  const base = { format: 1, kind: 'data_export_pre', ...scoped(access), accessId: access.accessId, accessSha256: access.accessSha256,
    requestSha256: id.requestSha256, observedSessionId: id.observedSessionId, observedCallId: id.observedCallId, at };
  return { ...base, preSha256: sha256(base) };
}
const claimRecord = (id, selected, pre, at) => ({ format: 1, kind: 'data_export_call', ...scoped(id), requestSha256: id.requestSha256,
  observedSessionId: id.observedSessionId, observedCallId: id.observedCallId,
  accessId: selected?.access.accessId ?? null, accessSha256: selected?.access.accessSha256 ?? null, preSha256: pre?.preSha256 ?? null, at });
const callPath = (paths, id) => join(paths.calls, id.observedSessionId, `${id.observedCallId}.json`);
function witnessRecord(access, pre, event, read, observedAt) {
  fresh(access, observedAt); need(Date.parse(observedAt) >= Date.parse(pre.at), 'export_post_mismatch');
  const { businessResult } = readGoalMcpToolResult(event.tool_response, read.expectedAccountSubject);
  need(validGoalDataDeleteResult('preview', businessResult, read.input)
    && ['ready', 'deleted'].includes(businessResult.status), 'export_authority_unverified');
  const base = { format: 1, kind: 'data_export_witness', ...scoped(access), accessId: access.accessId, accessSha256: access.accessSha256,
    requestSha256: access.requestSha256, observedSessionId: pre.observedSessionId, observedCallId: pre.observedCallId,
    preSha256: pre.preSha256, responseSha256: sha256(event.tool_response), status: businessResult.status,
    snapshotSha256: businessResult.status === 'ready' ? businessResult.snapshot : businessResult.receipt.snapshot,
    observedAt, expiresAt: access.expiresAt };
  return { ...base, witnessSha256: sha256(base) };
}

// Ordinary preview reads remain usable. Even an unprepared Pre records a
// bounded claim so a later preparation can never bind its old Post.
export async function observeDataExportHook(dataRoot, event, { observedAt = new Date().toISOString() } = {}) {
  if (toolFromEvent(event) !== TOOL || !['PreToolUse', 'PostToolUse'].includes(event?.hook_event_name)) return { status: 'not_applicable' };
  try {
    const read = readIdentity(event.tool_input);
    need(UUID.test(event.session_id) && typeof event.tool_use_id === 'string' && event.tool_use_id.length > 0
      && event.tool_use_id.length <= 512 && event.tool_use_id.isWellFormed() && !/[\p{Cc}]/u.test(event.tool_use_id) && iso(observedAt), 'invalid_export_source');
    const id = { ...read, observedSessionId: sha256(event.session_id), observedCallId: sha256(event.tool_use_id) }, paths = roots(dataRoot, id.scopeId);
    return await withHostTaskScope(dataRoot, id, async () => {
      await directories(paths, true); await ensurePrivateDirectory(join(paths.calls, id.observedSessionId));
      const index = await optional(join(paths.index, `${indexKey(id)}.json`));
      const selected = index ? await load(dataRoot, id.scopeId, index.value.accessId, observedAt) : null;
      if (selected) { need(matchesIdentity(selected.access, id), 'export_pre_mismatch'); await unconsumed(selected.directory); }
      const path = callPath(paths, id), old = await optional(path);
      if (event.hook_event_name === 'PreToolUse') {
        const at = old?.value.at ?? observedAt, pre = selected ? preRecord(selected.access, id, at) : null, claim = claimRecord(id, selected, pre, at);
        if (old) {
          need(equal(old.value, claim), 'export_pre_not_fresh');
          if (selected) need(equal((await readPrivateJson(join(selected.directory, 'pre.json'))).value, pre), 'export_pre_not_fresh');
        } else {
          await writePrivateJsonExclusive(path, claim);
          if (selected) await writePrivateJsonExclusive(join(selected.directory, 'pre.json'), pre);
        }
        return selected ? { status: 'pre_bound', scopeId: id.scopeId, accessId: selected.access.accessId } : { status: 'not_applicable' };
      }
      if (!selected) return { status: 'not_applicable' };
      need(old, 'export_pre_missing');
      const pre = (await readPrivateJson(join(selected.directory, 'pre.json'))).value;
      need(equal(preRecord(selected.access, id, pre.at), pre) && equal(old.value, claimRecord(id, selected, pre, pre.at)), 'export_pre_not_fresh');
      const file = join(selected.directory, 'witness.json'), previous = await optional(file);
      const witness = witnessRecord(selected.access, pre, event, read, previous?.value.observedAt ?? observedAt);
      if (previous) need(equal(previous.value, witness), 'export_witness_conflict');
      else await writePrivateJsonExclusive(file, witness);
      return { status: 'export_witness_saved', scopeId: id.scopeId, accessId: selected.access.accessId, expiresAt: selected.access.expiresAt };
    }, { allowDeleted: true });
  } catch (error) { return { status: 'rejected', error: bounded(error) }; }
}

function validateWitness(value, access, pre) {
  const keys = ['format', 'kind', ...identityKeys, 'accessId', 'accessSha256', 'observedCallId', 'preSha256', 'responseSha256', 'status', 'snapshotSha256', 'observedAt', 'expiresAt', 'witnessSha256'];
  need(exact(value, keys) && value.format === 1 && value.kind === 'data_export_witness' && matchesIdentity(value, access)
    && value.accessId === access.accessId && value.accessSha256 === access.accessSha256 && value.observedCallId === pre.observedCallId
    && value.preSha256 === pre.preSha256 && ['ready', 'deleted'].includes(value.status)
    && ['responseSha256', 'snapshotSha256', 'witnessSha256'].every(k => HASH.test(value[k]))
    && iso(value.observedAt) && Date.parse(value.observedAt) >= Date.parse(pre.at) && value.expiresAt === access.expiresAt, 'invalid_export_witness');
  fresh(access, value.observedAt); const { witnessSha256, ...base } = value; need(sha256(base) === witnessSha256, 'invalid_export_witness');
}
export async function consumeDataExport(dataRoot, { params, scopeId, accessId, now } = {}) {
  return safe(async () => {
    const source = readHostSource(params), initial = await load(dataRoot, scopeId, accessId, clock(now));
    need(initial.access.observedSessionId === sha256(source.sessionId), 'export_source_mismatch');
    return withHostTaskScope(dataRoot, initial.access, async () => {
      const selected = await load(dataRoot, scopeId, accessId, clock(now)), { access, directory, paths } = selected;
      need(access.accessSha256 === initial.access.accessSha256, 'export_access_changed'); await unconsumed(directory);
      const pre = (await readPrivateJson(join(directory, 'pre.json'))).value;
      need(equal(preRecord(access, pre, pre.at), pre), 'invalid_export_pre');
      need(equal((await readPrivateJson(callPath(paths, pre))).value, claimRecord(pre, selected, pre, pre.at)), 'export_pre_not_fresh');
      const witness = (await readPrivateJson(join(directory, 'witness.json'))).value; validateWitness(witness, access, pre);
      const consumedAt = clock(now); fresh(access, consumedAt); need(Date.parse(consumedAt) >= Date.parse(witness.observedAt), 'export_clock_regressed');
      await writePrivateJsonExclusive(join(directory, 'consumed.json'), { format: 1, kind: 'data_export_consumed', ...scoped(access),
        accessId, accessSha256: access.accessSha256, witnessSha256: witness.witnessSha256, observedSessionId: access.observedSessionId, action: 'export', consumedAt });
      return scopeOf(access);
    }, { allowDeleted: true });
  });
}

// Rights owner projection. Private nonces, paths, inputs and raw receipts are
// never returned. These records are retained read authorization, not task state.
export async function exportDataExportEvidence(dataRoot, scope) {
  return safe(async () => {
    await verifyPrivateDirectory(dataRoot); const paths = roots(dataRoot, hostTaskScopeId(scope));
    let total = 0;
    const entries = async path => {
      try { await verifyPrivateDirectory(path); } catch (error) { if (error.kind === 'not_found') return []; throw error; }
      const rows = await readdir(path, { withFileTypes: true }); total += rows.length;
      need(rows.length <= 4096 && total <= 16384, 'data_export_inventory_limit'); return rows.sort((a, b) => a.name.localeCompare(b.name));
    };
    const accesses = [], indices = [], readClaims = [];
    for (const entry of await entries(paths.accesses)) {
      need(entry.isDirectory() && UUID.test(entry.name), 'invalid_export_metadata'); const directory = join(paths.accesses, entry.name);
      const record = await optional(join(directory, 'prepared.json')); if (!record) continue;
      const access = validatePrepared(record.value); need(access.accessId === entry.name && equal(scoped(access), scoped(scope)), 'invalid_export_metadata');
      const state = {};
      for (const name of ['pre', 'witness', 'consumed']) { const value = await optional(join(directory, `${name}.json`)); state[name] = value ? { sha256: value.sha256 } : null; }
      const projection = Object.fromEntries(Object.entries(access).filter(([key]) => key !== 'nonceSha256')); accesses.push({ ...projection, ...state });
    }
    for (const entry of await entries(paths.index)) {
      need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name), 'invalid_export_metadata');
      const record = await readPrivateJson(join(paths.index, entry.name)), v = record.value;
      need(exact(v, ['format', 'kind', 'accountSubjectSha256', 'goalIdSha256', 'scopeId', 'accessId', 'accessSha256'])
        && v.format === 1 && v.kind === 'data_export_index' && UUID.test(v.accessId) && HASH.test(v.accessSha256)
        && equal(scoped(v), scoped(scope)) && v.scopeId === hostTaskScopeId(scope), 'invalid_export_metadata');
      indices.push({ ...v, fileSha256: record.sha256 });
    }
    for (const session of await entries(paths.calls)) {
      need(session.isDirectory() && HASH.test(session.name), 'invalid_export_metadata');
      for (const entry of await entries(join(paths.calls, session.name))) {
        need(entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name), 'invalid_export_metadata');
        const record = await readPrivateJson(join(paths.calls, session.name, entry.name)), v = record.value;
        need(exact(v, ['format', 'kind', 'accountSubjectSha256', 'goalIdSha256', 'scopeId', 'requestSha256', 'observedSessionId', 'observedCallId', 'accessId', 'accessSha256', 'preSha256', 'at'])
          && v.format === 1 && v.kind === 'data_export_call' && equal(scoped(v), scoped(scope)) && v.scopeId === hostTaskScopeId(scope)
          && [v.requestSha256, v.observedSessionId, v.observedCallId].every(value => HASH.test(value))
          && v.observedSessionId === session.name && `${v.observedCallId}.json` === entry.name && iso(v.at)
          && (v.accessId === null && v.accessSha256 === null && v.preSha256 === null
            || UUID.test(v.accessId) && HASH.test(v.accessSha256) && HASH.test(v.preSha256)), 'invalid_export_metadata');
        readClaims.push({ ...v, fileSha256: record.sha256 });
      }
    }
    return { accesses, indices, readClaims, retention: 'hash_only_data_export_authorization' };
  });
}
