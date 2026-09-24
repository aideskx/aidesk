/** Explicit same-account goal-copy cleanup. No network, authentication reads,
 * linked-file traversal, independent-export deletion or legacy-store access.
 * A verified service tombstone is durable before the first local unlink.
 * Thin byte plans make interruptions recoverable without retaining content. */
import { constants, openSync, closeSync, readFileSync, fstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isUuid, isTimestamp } from './lib/domain-inputs.mjs';
import { parseTeachingJson, teachingRequestSha256 } from './lib/teaching-business-contract.mjs';
import { readGoalMcpToolResult, validGoalAccountSubject, withExpectedGoalAccount } from './lib/goal-mcp-transport.mjs';
import { GOAL_NETWORK_DELETE_CONTRACT, GOAL_NETWORK_DELETE_EXCLUSIONS, parseGoalNetworkDeleteInput, validGoalNetworkDeleteResult, validGoalNetworkDeleteTarget } from './lib/goal-network-delete-contract.mjs';
import { GOAL_DATA_DELETE_CONTRACT, GOAL_DATA_DELETE_EXCLUSIONS, parseGoalDataDeleteInput, validGoalDataDeleteResult } from './lib/goal-data-delete-contract.mjs';
import { withGoalStore, loadGoalOperation, completeGoalOperation, readGoalJson, durableGoalJson, safeGoalDirectory, syncGoalDirectory,
  goalHash, sameGoalValue, localGoalId, localNetworkTarget, networkTargetKey, networkDeletionState, networkDeletionIntent, networkDeletionCancellation, networkOperationTombstone, validGoalNetworkReadObservation, goalDeletionState, goalDeletionIntent, goalOperationTombstone, ownGoalIndex, goalTool, GOAL_PLUGIN_FORMAT, needGoal, GoalPluginError } from './goal-plugin-request.mjs';

const FILE_LIMIT = 32768;
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = v => isUuid(v) && v === v.toLowerCase();
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const safeCode = e => e instanceof GoalPluginError ? e.code : 'LOCAL_DELETE_UNAVAILABLE';
function bytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); needGoal(s.isFile() && s.size <= FILE_LIMIT, 'DELETE_FILE_INVALID');
    const raw = readFileSync(fd); needGoal(raw.length <= FILE_LIMIT, 'DELETE_FILE_LIMIT'); return raw;
  } finally { closeSync(fd); }
}
function originalPath(store, location, id) {
  needGoal(['pending', 'staging', 'completed'].includes(location) && uuid(id), 'DELETE_PLAN_INVALID');
  return location === 'completed' ? join(store.completed, id.slice(0, 2), id) : join(store[location], id);
}
function validRelative(name) {
  return /^(?:request|status|receipt)\.json(?:\.[a-f0-9-]{36}\.tmp)?$/u.test(name)
    || /^(?:calls|read-observations)\/[a-f0-9]{64}\.json(?:\.[a-f0-9-]{36}\.tmp)?$/u.test(name);
}
// Only these two fixed owners share the byte-plan/unlink mechanism. This is
// not a caller-configurable deletion framework or an arbitrary path selector.
function selection(value) {
  const network = typeof value !== 'string';
  needGoal(network ? validGoalNetworkDeleteTarget(value) : uuid(value), 'DELETE_SELECTOR_INVALID');
  return { value, network, field: network ? 'target' : 'goalId', key: network ? networkTargetKey(value) : value,
    plans: network ? 'network-delete-plans' : 'delete-plans', markers: network ? 'network-deleted-operations' : 'deleted-operations',
    matches: input => network ? sameGoalValue(localNetworkTarget(input), value) : localGoalId(input) === value };
}
function validPlan(p, store, goalId, id) {
  const selected = selection(goalId);
  return exact(p, ['format', 'subject', selected.field, 'operationId', 'tool', 'requestSha256', 'location', 'files']) && p.format === GOAL_PLUGIN_FORMAT
    && p.subject === store.subject && sameGoalValue(p[selected.field], goalId) && p.operationId === id && uuid(id) && hash(p.requestSha256)
    && ['pending', 'staging', 'completed'].includes(p.location) && Array.isArray(p.files) && p.files.length <= 160
    && new Set(p.files.map(f => f.path)).size === p.files.length
    && p.files.every(f => exact(f, ['path', 'sha256']) && validRelative(f.path) && hash(f.sha256));
}
// Export checks the same retained byte-plan shape without running cleanup.
export { validPlan as validLocalDeletionPlan };
function writeOperationMarker(store, plan) {
  const claim = ownGoalIndex(store, plan.operationId);
  needGoal(claim.tool === plan.tool && claim.requestSha256 === plan.requestSha256, 'DELETE_OWNER_MISMATCH');
  const selected = selection(plan.target ?? plan.goalId);
  const directory = safeGoalDirectory(join(store.path, selected.markers), true), path = join(directory, `${plan.operationId}.json`);
  const marker = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, [selected.field]: selected.value, operationId: plan.operationId, tool: plan.tool,
    requestSha256: plan.requestSha256, planSha256: teachingRequestSha256(plan) };
  const previous = readGoalJson(path, null);
  if (previous !== null) needGoal(sameGoalValue(previous, marker), 'DELETION_MARKER_INVALID');
  else durableGoalJson(path, marker);
}
function planOperation(store, row, goalId, warn) {
  const id = row.entry.input.operationId, selected = selection(goalId);
  needGoal(selected.matches(row.entry.input), 'DELETE_GOAL_MISMATCH');
  const location = dirname(row.path) === store.pending ? 'pending' : dirname(row.path) === store.staging ? 'staging' : 'completed';
  needGoal(row.path === originalPath(store, location, id), 'DELETE_PATH_INVALID');
  const plan = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, [selected.field]: goalId, operationId: id, tool: row.entry.tool,
    requestSha256: row.entry.requestSha256, location, files: [] };
  const stable = new Map();
  const add = (path, raw) => { needGoal(plan.files.length < 160, 'DELETE_OPERATION_FILE_LIMIT'); plan.files.push({ path, sha256: goalHash(raw) }); stable.set(path, raw); };
  // loadGoalOperation already validates the exact request, owner and state.
  add('request.json', bytes(join(row.path, 'request.json')));
  if (readdirSync(row.path).includes('status.json')) add('status.json', bytes(join(row.path, 'status.json')));
  const tool = goalTool(row.entry.tool);
  if (readdirSync(row.path).includes('receipt.json')) {
    try {
      const raw = bytes(join(row.path, 'receipt.json')), receipt = parseTeachingJson(raw.toString('utf8'), FILE_LIMIT);
      const comparable = row.entry.tool === 'aidesk_goal_task_reserve' ? { ...receipt, creationDisposition: 'reconcile_only' } : receipt;
      const validReceipt = tool.contract === 'aidesk-goal-network-v1'
        ? (selected.network && row.entry.input.action === 'read' && exact(receipt, ['format', 'kind', 'operationId', 'requestSha256'])
          && receipt.format === GOAL_PLUGIN_FORMAT && receipt.kind === 'observed_read_without_admission'
          && receipt.operationId === id && receipt.requestSha256 === row.entry.requestSha256) || tool.valid('operation', { contract: tool.contract, status: 'completed', terminal: true, operationId: id, requestSha256: row.entry.requestSha256, receipt },
          { contract: tool.contract, action: 'operation', operationId: id, requestSha256: row.entry.requestSha256 }) : tool.valid(tool.action, receipt, row.entry.input);
      needGoal(validReceipt && (row.state.status !== 'completed'
        || teachingRequestSha256(comparable) === row.state.receiptSha256), 'DELETE_RECEIPT_INVALID');
      add('receipt.json', raw);
    } catch (e) { warn(safeCode(e), id); }
  }
  for (const collection of ['calls', 'read-observations']) {
    if (!readdirSync(row.path).includes(collection)) continue;
    let names;
    try { names = readdirSync(safeGoalDirectory(join(row.path, collection))); } catch (e) { warn(safeCode(e), id); continue; }
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      try {
        const raw = bytes(join(row.path, collection, name)), value = readGoalJson(join(row.path, collection, name));
        if (collection === 'calls') needGoal(exact(value, ['format', 'tool', 'argumentsSha256', 'sessionSha256', 'toolUseSha256', 'preparedAt'])
          && value.format === GOAL_PLUGIN_FORMAT && (value.tool === row.entry.tool || row.entry.tool === 'aidesk_goal_data_delete' && value.tool === 'aidesk_goal_data_delete_cancel')
          && value.argumentsSha256 === teachingRequestSha256(withExpectedGoalAccount(row.entry.input, store.subject))
          && hash(value.sessionSha256) && hash(value.toolUseSha256) && isTimestamp(value.preparedAt), 'DELETE_METADATA_INVALID');
        // Network observations contain metadata only and bind the exact typed read.
        else needGoal(selected.network && validGoalNetworkReadObservation(value, row) && stable.has(`calls/${name}`), 'DELETE_METADATA_INVALID');
        add(`${collection}/${name}`, raw);
      } catch (e) { warn(safeCode(e), id); }
    }
  }
  for (const name of readdirSync(row.path)) {
    if (['calls', 'read-observations'].includes(name)) {
      try { for (const child of readdirSync(safeGoalDirectory(join(row.path, name)))) {
        const rel = `${name}/${child}`;
        if (stable.has(rel)) continue;
        const match = /^([a-f0-9]{64}\.json)\.[a-f0-9-]{36}\.tmp$/u.exec(child), original = match && stable.get(`${name}/${match[1]}`);
        if (original) { try { const raw = bytes(join(row.path, rel)); if (raw.equals(original)) { add(rel, raw); continue; } } catch { /* retain below */ } }
        warn('UNATTRIBUTED_LOCAL_ITEM', id);
      } } catch (e) { warn(safeCode(e), id); }
      continue;
    }
    if (stable.has(name)) continue;
    const match = /^((?:request|status|receipt)\.json)\.[a-f0-9-]{36}\.tmp$/u.exec(name), original = match && stable.get(match[1]);
    if (original) { try { const raw = bytes(join(row.path, name)); if (raw.equals(original)) { add(name, raw); continue; } } catch { /* retain below */ } }
    warn('UNATTRIBUTED_LOCAL_ITEM', id);
  }
  needGoal(validPlan(plan, store, goalId, id), 'DELETE_PLAN_INVALID'); return plan;
}
/** A verified service fact fences replay without authorizing local unlink. */
export function recordLocalGoalDeletion(store, receipt) {
  const goalId = receipt?.goalId;
  needGoal(validGoalDataDeleteResult('preview', { contract: GOAL_DATA_DELETE_CONTRACT, status: 'deleted', goalId, receipt },
    { contract: GOAL_DATA_DELETE_CONTRACT, goalId }), 'DELETE_RECEIPT_INVALID');
  if (!store) return;
  const current = goalDeletionState(store, goalId);
  if (current?.status === 'deleted') needGoal(sameGoalValue(current.receipt, receipt), 'DELETION_RECEIPT_CONFLICT');
  else {
    const dir = safeGoalDirectory(join(store.path, 'goal-tombstones'), true);
    durableGoalJson(join(dir, `${goalId}.json`), { format: GOAL_PLUGIN_FORMAT, subject: store.subject, receipt });
  }
}
/** Service cancellation is a durable terminal fact, never inferred from an
 * error/not_found or local call count. Only its matching intent may be removed. */
export function recordLocalGoalCancellation(store, receipt) {
  const input = { contract: GOAL_DATA_DELETE_CONTRACT, operationId: receipt?.operationId, requestSha256: receipt?.requestSha256 };
  needGoal(receipt?.status === 'cancelled' && validGoalDataDeleteResult('operation', { ...input, status: 'completed', terminal: true, receipt }, input), 'DELETE_RECEIPT_INVALID');
  if (!store) return { status: 'cancelled', intentReleased: false, localRootObserved: false };
  const dir = safeGoalDirectory(join(store.path, 'delete-cancellations'), true), path = join(dir, `${receipt.operationId}.json`);
  const value = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, receipt }, previous = readGoalJson(path, null);
  if (previous !== null) needGoal(sameGoalValue(previous, value), 'DELETION_CANCELLATION_INVALID');
  else durableGoalJson(path, value);
  const state = goalDeletionState(store, receipt.goalId), intent = goalDeletionIntent(store, receipt.goalId);
  const release = state?.status !== 'deleted' && intent?.input.operationId === receipt.operationId && intent.requestSha256 === receipt.requestSha256;
  if (release) { const intentPath = join(store.path, 'delete-intents', `${receipt.goalId}.json`); unlinkSync(intentPath); syncGoalDirectory(dirname(intentPath)); }
  return { status: 'cancelled', intentReleased: !!release, localRootObserved: true };
}
export const NETWORK_DELETION_DIRECTORIES = Object.freeze(['network-delete-intents', 'network-tombstones',
  'network-deleted-operations', 'network-delete-plans', 'network-delete-cancellations']);
export function recordLocalNetworkDeletion(store, receipt) {
  const target = receipt?.target;
  needGoal(validGoalNetworkDeleteResult('preview', { contract: GOAL_NETWORK_DELETE_CONTRACT, status: 'deleted', target, receipt },
    { contract: GOAL_NETWORK_DELETE_CONTRACT, target }), 'DELETE_RECEIPT_INVALID');
  if (!store) return;
  const current = networkDeletionState(store, target);
  if (current?.status === 'deleted') needGoal(sameGoalValue(current.receipt, receipt), 'DELETION_RECEIPT_CONFLICT');
  else durableGoalJson(join(safeGoalDirectory(join(store.path, 'network-tombstones'), true), `${networkTargetKey(target)}.json`),
    { format: GOAL_PLUGIN_FORMAT, subject: store.subject, receipt });
  // Keep the deletion's own body-free original as a completed recovery record,
  // including confirmation first observed through preview/cancel/operation.
  let row;
  try { row = loadGoalOperation(store, receipt.operationId); }
  catch (error) { if (!(error instanceof GoalPluginError && ['ORIGINAL_NOT_FOUND', 'ORIGINAL_NOT_READY'].includes(error.code))) throw error; }
  if (row) {
    needGoal(row.entry.tool === 'aidesk_goal_network_delete' && validGoalNetworkDeleteResult('delete', receipt, row.entry.input), 'DELETE_ORIGINAL_MISMATCH');
    completeGoalOperation(store, row, receipt, Date.now());
  }
}
export function recordLocalNetworkCancellation(store, receipt) {
  const input = { contract: GOAL_NETWORK_DELETE_CONTRACT, operationId: receipt?.operationId, requestSha256: receipt?.requestSha256 };
  needGoal(receipt?.status === 'cancelled' && validGoalNetworkDeleteResult('operation', { ...input, status: 'completed', terminal: true, receipt }, input), 'DELETE_RECEIPT_INVALID');
  if (!store) return { status: 'cancelled', intentReleased: false, localRootObserved: false };
  const dir = safeGoalDirectory(join(store.path, 'network-delete-cancellations'), true), path = join(dir, `${receipt.operationId}.json`);
  const value = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, receipt }, previous = readGoalJson(path, null);
  if (previous !== null) needGoal(sameGoalValue(previous, value), 'DELETION_CANCELLATION_INVALID');
  else durableGoalJson(path, value);
  const state = networkDeletionState(store, receipt.target), intent = networkDeletionIntent(store, receipt.target);
  const release = state?.status !== 'deleted' && intent?.input.operationId === receipt.operationId && intent.requestSha256 === receipt.requestSha256;
  if (release) { const path = join(store.path, 'network-delete-intents', `${networkTargetKey(receipt.target)}.json`); unlinkSync(path); syncGoalDirectory(dirname(path)); }
  return { status: 'cancelled', intentReleased: !!release, localRootObserved: true };
}
/** Recognize only validated thin network metadata; never copy or erase it. */
export function validateLocalNetworkDeletionMetadata(store, limit = Infinity) {
  let count = 0;
  const checked = () => needGoal(++count <= limit, 'LOCAL_SCAN_LIMIT');
  for (const name of NETWORK_DELETION_DIRECTORIES) {
    if (!readdirSync(store.path).includes(name)) continue;
    const dir = safeGoalDirectory(join(store.path, name));
    for (const file of readdirSync(dir)) {
      checked();
      if (name === 'network-delete-plans') {
        needGoal(hash(file), 'DELETE_PLAN_INVALID');
        const path = safeGoalDirectory(join(dir, file));
        for (const child of readdirSync(path)) {
          checked(); needGoal(child.endsWith('.json') && uuid(child.slice(0, -5)), 'DELETE_PLAN_INVALID');
          const plan = readGoalJson(join(path, child));
          needGoal(validPlan(plan, store, plan.target, child.slice(0, -5)) && networkTargetKey(plan.target) === file
            && networkDeletionState(store, plan.target)?.status === 'deleted', 'DELETE_PLAN_INVALID');
        }
        continue;
      }
      const keyedByTarget = ['network-delete-intents', 'network-tombstones'].includes(name);
      needGoal(file.endsWith('.json') && (keyedByTarget ? hash : uuid)(file.slice(0, -5)), 'DELETION_MARKER_INVALID');
      const value = readGoalJson(join(dir, file));
      if (keyedByTarget) {
        const target = name === 'network-delete-intents' ? value.input?.target : value.receipt?.target;
        needGoal(networkTargetKey(target) === file.slice(0, -5), 'DELETION_MARKER_INVALID');
        if (name === 'network-delete-intents') networkDeletionIntent(store, target); else networkDeletionState(store, target);
      } else if (name === 'network-delete-cancellations') networkDeletionCancellation(store, file.slice(0, -5));
      else {
        const marker = networkOperationTombstone(store, file.slice(0, -5));
        const plan = readGoalJson(join(store.path, 'network-delete-plans', networkTargetKey(marker.target), file));
        needGoal(validPlan(plan, store, marker.target, marker.operationId) && teachingRequestSha256(plan) === marker.planSha256, 'DELETE_PLAN_INVALID');
      }
    }
  }
}
/** Caller holds the same account OS lock used by every write and Post. */
export function completeLocalGoalDeletion(store, receipt, options = {}) {
  recordLocalGoalDeletion(store, receipt); return completeLocalDeletion(store, receipt.goalId, options);
}
export function completeLocalNetworkDeletion(store, receipt, options = {}) {
  recordLocalNetworkDeletion(store, receipt); return { serviceDeleted: true, ...completeLocalDeletion(store, receipt.target, options) };
}
function completeLocalDeletion(store, goalId, { beforeUnlink } = {}) {
  const selected = selection(goalId), warnings = [], operations = []; let removedFiles = 0;
  const warn = (code, operationId = null) => { if (!warnings.some(w => w.code === code && w.operationId === operationId)) warnings.push({ code, operationId }); };
  if (!store) return { [selected.field]: goalId, complete: false, removedFiles, operations, warnings: [{ code: 'LOCAL_NAMESPACE_NOT_FOUND', operationId: null }] };
  const plans = safeGoalDirectory(join(safeGoalDirectory(join(store.path, selected.plans), true), selected.key), true);
  const discovered = new Set(), resume = new Set();
  // Enumerate the finite local name set completely. Unlike export, deletion
  // must not permanently exclude originals above a fixed inventory ceiling.
  // Each operation still has a bounded, fsynced byte plan and can resume after
  // process interruption; the explicit cleanup CLI has no Hook time budget.
  function discover(path, shards = false) {
    safeGoalDirectory(path);
    for (const name of readdirSync(path).sort()) {
      if (shards) { if (!/^[a-f0-9]{2}$/u.test(name)) warn('UNATTRIBUTED_LOCAL_ITEM'); else discover(join(path, name)); }
      else if (uuid(name)) discovered.add(name); else warn('UNATTRIBUTED_LOCAL_ITEM');
    }
  }
  try { discover(store.pending); discover(store.staging); discover(store.completed, true); }
  catch (e) { warn(safeCode(e)); }
  for (const name of readdirSync(plans)) {
    if (/^[a-f0-9-]{36}\.json$/u.test(name) && uuid(name.slice(0, -5))) resume.add(name.slice(0, -5));
    else warn('UNATTRIBUTED_DELETE_PLAN');
  }
  for (const id of new Set([...resume, ...discovered])) {
    try {
      let plan = readGoalJson(join(plans, `${id}.json`), null);
      if (plan !== null) needGoal(validPlan(plan, store, goalId, id), 'DELETE_PLAN_INVALID');
      else {
        const row = loadGoalOperation(store, id); if (!selected.matches(row.entry.input)) continue;
        plan = planOperation(store, row, goalId, warn);
        // Atomic publication before any unlink leaves no content in recovery metadata.
        durableGoalJson(join(plans, `${id}.json`), plan);
      }
      const base = originalPath(store, plan.location, id);
      if (plan.location === 'completed') safeGoalDirectory(join(store.completed, id.slice(0, 2)));
      try { safeGoalDirectory(base); } catch (e) { if (e.code !== 'ENOENT') throw e; writeOperationMarker(store, plan); operations.push({ operationId: id, status: 'cleared' }); continue; }
      // Whenever an original still exists, independently recheck attribution
      // rather than trusting a resume plan in isolation.
      if (readGoalJson(join(base, 'request.json'), null) !== null) {
        const row = loadGoalOperation(store, id);
        needGoal(selected.matches(row.entry.input) && row.entry.requestSha256 === plan.requestSha256 && row.entry.tool === plan.tool, 'DELETE_GOAL_MISMATCH');
      }
      writeOperationMarker(store, plan);
      for (const file of plan.files) {
        const path = join(base, file.path);
        try {
          if (file.path.includes('/')) safeGoalDirectory(dirname(path));
          const raw = bytes(path); needGoal(goalHash(raw) === file.sha256, 'DELETE_FILE_CHANGED');
          beforeUnlink?.({ operationId: id, relativePath: file.path, removedFiles });
          unlinkSync(path); syncGoalDirectory(dirname(path)); removedFiles++;
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
      for (const collection of ['calls', 'read-observations']) {
        try { const directory = safeGoalDirectory(join(base, collection)); if (readdirSync(directory).length === 0) { rmdirSync(directory); syncGoalDirectory(base); } }
        catch (e) { if (e.code !== 'ENOENT') warn(safeCode(e), id); }
      }
      if (readdirSync(base).length === 0) { rmdirSync(base); syncGoalDirectory(dirname(base)); operations.push({ operationId: id, status: 'cleared' }); }
      else { warn('UNATTRIBUTED_LOCAL_ITEM', id); operations.push({ operationId: id, status: 'partially_cleared' }); }
    } catch (e) { warn(safeCode(e), id); operations.push({ operationId: id, status: 'not_cleared' }); }
  }
  // Thin global indices remain immutable. Missing body attribution and unknown
  // owner temporaries are retained; account-wide scans never open other bodies.
  try { for (const name of readdirSync(store.indices)) {
    if (!/^[a-f0-9-]{36}\.json$/u.test(name) || !uuid(name.slice(0, -5))) { warn('UNATTRIBUTED_OWNER_INDEX'); continue; }
    const id = name.slice(0, -5), claim = readGoalJson(join(store.indices, name));
    if (claim?.subject === store.subject && !discovered.has(id) && !resume.has(id)) {
      const marker = goalOperationTombstone(store, id) ?? networkOperationTombstone(store, id);
      const owner = marker && selection(marker.target ?? marker.goalId);
      const plan = marker && readGoalJson(join(store.path, owner.plans, owner.key, `${id}.json`), null);
      if (!marker || !validPlan(plan, store, owner.value, id) || teachingRequestSha256(plan) !== marker.planSha256) warn('UNATTRIBUTED_OWNER_CLAIM', id);
    }
  } } catch (e) { warn(safeCode(e)); }
  for (const name of readdirSync(store.path)) if (!['pending', 'staging', 'completed', '.lock', 'delete-intents', 'goal-tombstones', 'deleted-operations', 'delete-plans', 'delete-cancellations', ...NETWORK_DELETION_DIRECTORIES].includes(name)) warn('UNATTRIBUTED_LOCAL_ITEM');
  try { validateLocalNetworkDeletionMetadata(store); } catch (e) { warn(safeCode(e)); }
  return { [selected.field]: goalId, complete: warnings.length === 0, removedFiles, operations, warnings };
}
/** The input/result pair is a genuine, same-subject MCP observation supplied by
 * the caller. This helper verifies transport and business shape; no HTTP calls. */
export async function deleteGoalData({ subject, dataRoot, input, response }) {
  needGoal(validGoalAccountSubject(subject), 'SUBJECT_REQUIRED');
  const action = Object.hasOwn(input ?? {}, 'expectedSnapshot') ? 'delete' : Object.hasOwn(input ?? {}, 'requestSha256') ? 'operation' : 'preview';
  const parsed = parseGoalDataDeleteInput(action, input), { businessResult } = readGoalMcpToolResult(response, subject);
  needGoal(validGoalDataDeleteResult(action, businessResult, parsed), 'DELETE_RESULT_INVALID');
  const receipt = action === 'delete' ? businessResult : businessResult.receipt;
  needGoal(receipt?.status === 'deleted', 'DELETE_NOT_CONFIRMED');
  if (dataRoot === null || dataRoot === undefined) return { goalId: receipt.goalId, complete: false, removedFiles: 0, operations: [],
    warnings: [{ code: 'LOCAL_ROOT_NOT_PROVIDED', operationId: null }], exclusions: GOAL_DATA_DELETE_EXCLUSIONS };
  needGoal(typeof dataRoot === 'string' && isAbsolute(dataRoot), 'PLUGIN_DATA_REQUIRED');
  return withGoalStore({ subject, dataRoot }, store => ({ ...completeLocalGoalDeletion(store, receipt), exclusions: GOAL_DATA_DELETE_EXCLUSIONS }));
}
export async function deleteNetworkData({ subject, dataRoot, input, response }) {
  needGoal(validGoalAccountSubject(subject), 'SUBJECT_REQUIRED');
  const action = Object.hasOwn(input ?? {}, 'expectedSnapshot') ? 'delete' : Object.hasOwn(input ?? {}, 'requestSha256') ? 'operation' : 'preview';
  const parsed = parseGoalNetworkDeleteInput(action, input), { businessResult } = readGoalMcpToolResult(response, subject);
  needGoal(validGoalNetworkDeleteResult(action, businessResult, parsed), 'DELETE_RESULT_INVALID');
  const receipt = action === 'delete' ? businessResult : businessResult.receipt;
  needGoal(receipt?.status === 'deleted', 'DELETE_NOT_CONFIRMED');
  if (dataRoot === null || dataRoot === undefined) return { serviceDeleted: true, target: receipt.target, complete: false, removedFiles: 0, operations: [],
    warnings: [{ code: 'LOCAL_ROOT_NOT_PROVIDED', operationId: null }], exclusions: GOAL_NETWORK_DELETE_EXCLUSIONS };
  needGoal(typeof dataRoot === 'string' && isAbsolute(dataRoot), 'PLUGIN_DATA_REQUIRED');
  return withGoalStore({ subject, dataRoot }, store => ({ ...completeLocalNetworkDeletion(store, receipt), exclusions: GOAL_NETWORK_DELETE_EXCLUSIONS }));
}
async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  needGoal(['cleanup', 'cleanup-network'].includes(command) && [2, 4].includes(args.length), 'DELETE_USAGE');
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; needGoal(['--subject', '--data-root'].includes(key) && !Object.hasOwn(options, key), 'DELETE_USAGE'); options[key] = args[i + 1]; }
  const chunks = []; let length = 0;
  for await (const chunk of process.stdin) { length += chunk.length; needGoal(length <= 32768, 'DELETE_INPUT_LIMIT'); chunks.push(chunk); }
  const pair = parseTeachingJson(Buffer.concat(chunks).toString('utf8'), 32768);
  needGoal(exact(pair, ['input', 'response']), 'DELETE_INPUT_INVALID');
  console.log(JSON.stringify(await (command === 'cleanup-network' ? deleteNetworkData : deleteGoalData)({ subject: options['--subject'], dataRoot: options['--data-root'], ...pair })));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: safeCode(error), advice: '本机清理未完成；已确认服务删除不会撤销。保留墓碑、薄计划与未知副本，沿同一删除回执和实际恢复根继续清理，不重发目标工作。' })); process.exitCode = 1;
});
