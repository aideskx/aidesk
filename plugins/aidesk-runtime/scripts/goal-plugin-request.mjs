/** Mechanical request preparation for the same Plugin; no network or host-history reads.
 * Hooks use the host's PLUGIN_DATA; recovery CLI uses only the explicit root
 * observed in that Hook's context. Pure prepare never opens a data directory.
 * Originals in goal-plugin-v1 are
 * candidate recovery data, not a second memory, account grant or remote backup.
 * Retain them for review before the first candidate / 2026-09-28, whichever is
 * earlier. Explicit goal deletion uses same-account intent/tombstone metadata;
 * it does not define long-term retention or delete other stores and exports.
 * IO follows the existing Plugin outbox: private directories, no-follow files,
 * exclusive originals, fsync, atomic replacement and a same-process OS lock.
 * The old teaching-plugin-v1 directory is never opened or changed here.
 */
import { constants, lstatSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync,
  fsyncSync, renameSync, readdirSync, fstatSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { withGoalFileLock, GoalFileLockError } from './goal-file-lock.mjs';
import { isUuid, isTimestamp } from './lib/domain-inputs.mjs';
import { canonicalTeachingJson, parseTeachingJson, teachingRequestSha256 } from './lib/teaching-business-contract.mjs';
import { GOAL_DRAFT_CONTRACT, goalDraftToolAction, parseGoalDraftInput, validGoalDraftResult } from './lib/goal-draft-contract.mjs';
import { GOAL_SERVICE_CONTRACT, GOAL_PLATFORM_SERVICE_CONTRACT, goalServiceToolAction, parseGoalServiceInput, validGoalServiceResult } from './lib/goal-service-contract.mjs';
import { GOAL_TASK_CONTRACT, goalTaskToolAction, parseGoalTaskInput, validGoalTaskResult } from './lib/goal-task-contract.mjs';
import { GOAL_NETWORK_CONTRACT, goalNetworkToolAction, parseGoalNetworkInput, validGoalNetworkResult, goalNetworkIsWrite, goalNetworkMetadata } from './lib/goal-network-contract.mjs';
import { GOAL_NETWORK_SCOPE_CONTRACT, goalNetworkScopeToolAction, parseGoalNetworkScopeInput, validGoalNetworkScopeResult, goalNetworkScopeIsWrite } from './lib/goal-network-scope-contract.mjs';
import { GOAL_DATA_DELETE_CONTRACT, goalDataDeleteToolAction, parseGoalDataDeleteInput, validGoalDataDeleteResult } from './lib/goal-data-delete-contract.mjs';
import { GOAL_NETWORK_DELETE_CONTRACT, goalNetworkDeleteToolAction, parseGoalNetworkDeleteInput, validGoalNetworkDeleteResult, validGoalNetworkDeleteTarget } from './lib/goal-network-delete-contract.mjs';
import { validGoalAccountSubject, withExpectedGoalAccount } from './lib/goal-mcp-transport.mjs';

export const GOAL_PLUGIN_FORMAT = 'aidesk-goal-plugin-v1';
export const GOAL_PLUGIN_LIMITS = Object.freeze({ inputBytes: 131072, fileBytes: 32768, pending: 128, callsPerOperation: 64, list: 16 });
export class GoalPluginError extends Error { constructor(code) { super(code); this.code = code; } }
export const needGoal = (condition, code) => { if (!condition) throw new GoalPluginError(code); };
export const goalHash = value => createHash('sha256').update(value).digest('hex');
export const sameGoalValue = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const uuid = value => isUuid(value) && value === value.toLowerCase();
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export const opaqueGoalId = value => typeof value === 'string' && value.isWellFormed() && value.trim().length > 0
  && Buffer.byteLength(value) <= 512 && !/[\p{Cc}\p{Cf}]/u.test(value);

export function goalTool(name) {
  const draft = goalDraftToolAction(name), service = goalServiceToolAction(name), task = goalTaskToolAction(name), network = goalNetworkToolAction(name);
  const deletion = goalDataDeleteToolAction(name), scope = goalNetworkScopeToolAction(name), networkDeletion = goalNetworkDeleteToolAction(name);
  if (networkDeletion) return { action: networkDeletion, contract: GOAL_NETWORK_DELETE_CONTRACT, parse: parseGoalNetworkDeleteInput, valid: validGoalNetworkDeleteResult,
    write: networkDeletion === 'delete', operationTool: 'aidesk_goal_network_delete_operation' };
  if (scope) return { action: scope, contract: GOAL_NETWORK_SCOPE_CONTRACT, parse: parseGoalNetworkScopeInput, valid: validGoalNetworkScopeResult,
    write: goalNetworkScopeIsWrite(scope), operationTool: 'aidesk_goal_network_scope_operation' };
  if (deletion) return { action: deletion, contract: GOAL_DATA_DELETE_CONTRACT, parse: parseGoalDataDeleteInput, valid: validGoalDataDeleteResult,
    write: deletion === 'delete', operationTool: 'aidesk_goal_data_delete_operation' };
  if (draft) return { action: draft, contract: GOAL_DRAFT_CONTRACT, parse: parseGoalDraftInput, valid: validGoalDraftResult,
    write: draft === 'save', operationTool: 'aidesk_goal_draft_operation' };
  if (service) return { action: service, contract: GOAL_SERVICE_CONTRACT, parse: parseGoalServiceInput, valid: validGoalServiceResult,
    write: service === 'cooperate', operationTool: 'aidesk_goal_service_operation' };
  if (task) return { action: task, contract: GOAL_TASK_CONTRACT, parse: parseGoalTaskInput, valid: validGoalTaskResult,
    write: task === 'reserve' || task === 'record', operationTool: 'aidesk_goal_task_operation' };
  if (network) return { action: network, contract: GOAL_NETWORK_CONTRACT, parse: parseGoalNetworkInput, valid: validGoalNetworkResult,
    write: network !== 'operation' && network !== 'discover', operationTool: 'aidesk_goal_network_operation' };
  throw new GoalPluginError('UNSUPPORTED_TOOL');
}
// Static write is an upper bound for thin claims; full requests use their exact view.
export const isGoalWrite = (tool, input) => tool.contract === GOAL_NETWORK_CONTRACT ? goalNetworkIsWrite(tool.action, input) : tool.write;
export const goalMayRepeatRead = (tool, input) => tool.contract === GOAL_NETWORK_CONTRACT && tool.action === 'read' && input.view !== 'adoption';
function networkOperationInput(operationId, requestSha256) {
  return { contract: GOAL_NETWORK_CONTRACT, action: 'operation', operationId, requestSha256 };
}
function validNetworkCore(value, input) {
  const query = networkOperationInput(input.operationId, teachingRequestSha256(input));
  return validGoalNetworkResult('operation', { contract: GOAL_NETWORK_CONTRACT, status: 'completed', terminal: true,
    operationId: query.operationId, requestSha256: query.requestSha256, receipt: value }, query)
    && sameGoalValue(value.request, goalNetworkMetadata(input));
}
function validScopeCore(value, input) {
  return validGoalNetworkScopeResult(input.action, { contract: GOAL_NETWORK_SCOPE_CONTRACT, status: 'recorded', receipt: value }, input)
    && sameGoalValue(value.request, input);
}
export function safeGoalDirectory(path, create = false) {
  if (create) {
    try { mkdirSync(path, { mode: 0o700 }); syncDirectory(dirname(path)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const info = lstatSync(path);
  needGoal(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_DIRECTORY'); return path;
}
const safeDirectory = safeGoalDirectory;
function optionalDirectory(path) {
  try { return safeDirectory(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function hostDataDirectory(path, create) {
  try {
    if (optionalDirectory(path)) return true;
    if (!create) return false;
    // The host supplies this exact leaf, but may not have created it yet.
    // Never recursively create host-owned ancestors or follow a parent link.
    let parent;
    try { parent = lstatSync(dirname(path)); }
    catch (error) { if (error.code === 'ENOENT') throw new GoalPluginError('PLUGIN_DATA_PARENT_MISSING'); throw error; }
    needGoal(parent.isDirectory() && !parent.isSymbolicLink(), 'PLUGIN_DATA_PARENT_UNSAFE');
    safeDirectory(path, true);
    return true;
  } catch (error) {
    if (error instanceof GoalPluginError) {
      if (error.code === 'UNSAFE_DIRECTORY') throw new GoalPluginError('PLUGIN_DATA_UNSAFE');
      throw error;
    }
    const code = { EACCES: 'PLUGIN_DATA_PERMISSION_DENIED', EPERM: 'PLUGIN_DATA_PERMISSION_DENIED',
      EROFS: 'PLUGIN_DATA_READ_ONLY', ENOTDIR: 'PLUGIN_DATA_PARENT_UNSAFE', ENOENT: 'PLUGIN_DATA_UNAVAILABLE' }[error.code];
    throw new GoalPluginError(code ?? 'PLUGIN_DATA_IO_UNVERIFIED');
  }
}
export function syncGoalDirectory(path) {
  // Node cannot fsync a directory on Windows (EPERM). Keep the same boundary
  // as goal-file-lock: regular-file fsync, exclusive publication and the OS
  // lock remain mandatory; this is process recovery, not power-loss proof.
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
const syncDirectory = syncGoalDirectory;
export function readGoalJson(path, fallback) {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = fstatSync(fd); needGoal(info.isFile() && info.size <= GOAL_PLUGIN_LIMITS.fileBytes, 'INVALID_LOCAL_FILE');
      const raw = readFileSync(fd); needGoal(raw.length <= GOAL_PLUGIN_LIMITS.fileBytes, 'FILE_LIMIT');
      return parseTeachingJson(new TextDecoder('utf-8', { fatal: true }).decode(raw), GOAL_PLUGIN_LIMITS.fileBytes);
    } finally { closeSync(fd); }
  } catch (error) { if (error.code === 'ENOENT' && arguments.length > 1) return fallback; throw error; }
}
export function durableGoalJson(path, value, exclusive = false) {
  const raw = canonicalTeachingJson(value) + '\n'; needGoal(Buffer.byteLength(raw) <= GOAL_PLUGIN_LIMITS.fileBytes, 'FILE_LIMIT');
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) {
    try { needGoal(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'INVALID_LOCAL_FILE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    renameSync(temporary, path);
  }
  syncDirectory(dirname(path));
}
function publishOriginal(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  durableGoalJson(temporary, value, true);
  // A crash during writing cannot leave a truncated request.json. Only the
  // fully fsynced file receives the original's stable name.
  linkSync(temporary, path); syncDirectory(dirname(path));
  unlinkSync(temporary); syncDirectory(dirname(path));
}
async function lockedGoalDirectory(path, run) {
  // Default loader accepts only the artifact shipped in this Plugin. No event,
  // environment variable or CLI argument can select a different native binary.
  // Resolve the already-validated directory, including the OS /var -> /private
  // alias. This preserves the observed recovery root and never guesses a root.
  try { return await withGoalFileLock(join(realpathSync(path), '.lock'), run); }
  catch (error) {
    if (error instanceof GoalFileLockError) throw new GoalPluginError(error.code === 'GOAL_LOCK_BUSY' ? 'BUSY' : error.code);
    throw error;
  }
}
// Subject is an expected-account routing guard, never identity evidence. The
// transport contract performs the exact public subject validation before use.
export async function withGoalStore({ dataRoot = process.env.PLUGIN_DATA, subject, create = false }, run) {
  needGoal(validGoalAccountSubject(subject), 'SUBJECT_REQUIRED');
  needGoal(typeof dataRoot === 'string' && isAbsolute(dataRoot), 'PLUGIN_DATA_REQUIRED');
  // Normalize trailing separators before lstat so they cannot hide a leaf link.
  dataRoot = resolve(dataRoot);
  if (!hostDataDirectory(dataRoot, create)) return run(null);
  const namespace = join(dataRoot, 'goal-plugin-v1');
  if (!create && !optionalDirectory(namespace)) return run(null);
  safeDirectory(namespace, create);
  const path = join(namespace, goalHash(subject));
  if (!create && !optionalDirectory(path)) return run(null);
  safeDirectory(path, create);
  const store = { path, subject, dataRoot: resolve(dataRoot), indices: safeDirectory(join(namespace, 'owners'), create),
    pending: safeDirectory(join(path, 'pending'), create), staging: safeDirectory(join(path, 'staging'), create), completed: safeDirectory(join(path, 'completed'), create) };
  return lockedGoalDirectory(path, () => run(store));
}
const serviceContract = value => [GOAL_SERVICE_CONTRACT, GOAL_PLATFORM_SERVICE_CONTRACT].includes(value);
function checkIndex(store, operationId, tool, requestSha256, contract) {
  let saved;
  try { saved = ownGoalIndex(store, operationId); }
  catch (error) { if (error instanceof GoalPluginError) throw new GoalPluginError('ORIGINAL_OWNER_OR_CONTENT_CONFLICT'); throw error; }
  needGoal(saved.tool === tool && saved.requestSha256 === requestSha256
    && (contract === undefined || saved.contract === undefined || saved.contract === contract), 'ORIGINAL_OWNER_OR_CONTENT_CONFLICT');
}
export function ownGoalIndex(store, operationId) {
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID');
  const claim = readGoalJson(join(store.indices, `${operationId}.json`), null);
  const keys = ['format', 'subject', 'tool', 'requestSha256'];
  needGoal(claim && (exact(claim, keys) || exact(claim, [...keys, 'contract'])
      && claim.tool === 'aidesk_goal_service_cooperate' && serviceContract(claim.contract))
    && claim.format === GOAL_PLUGIN_FORMAT && claim.subject === store.subject && hash(claim.requestSha256), 'ORIGINAL_NOT_FOUND');
  needGoal(goalTool(claim.tool).write, 'ORIGINAL_INVALID'); return claim;
}
const ownIndex = ownGoalIndex;

export const localGoalId = input => input?.goalId ?? input?.goalRef?.goalId ?? null;
/** A source post never selects independent responses or adopted goal copies. */
export function localNetworkTarget(input) {
  if (input?.contract !== GOAL_NETWORK_CONTRACT) return null;
  const kind = input.action === 'publish' ? 'post' : input.action === 'respond' ? 'response'
    : input.action === 'read' ? input.view : input.action === 'withdraw' ? input.target : null;
  if (!['post', 'response'].includes(kind)) return null;
  const target = { kind, cohortId: input.cohortId, postId: input.postId,
    ...(kind === 'response' ? { sourceVersion: input.version, responseId: input.responseId } : {}) };
  needGoal(validGoalNetworkDeleteTarget(target), 'NETWORK_TARGET_INVALID'); return target;
}
export function networkTargetKey(target) {
  needGoal(validGoalNetworkDeleteTarget(target), 'NETWORK_TARGET_INVALID'); return teachingRequestSha256(target);
}
function deletionDirectory(store, name, create = false) {
  const path = join(store.path, name);
  return create ? safeDirectory(path, true) : optionalDirectory(path);
}
export function goalDeletionIntent(store, goalId) {
  if (!store || goalId === null) return null;
  needGoal(uuid(goalId), 'GOAL_ID_INVALID');
  const dir = deletionDirectory(store, 'delete-intents'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${goalId}.json`), null); if (value === null) return null;
  needGoal(exact(value, ['format', 'subject', 'input', 'requestSha256']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
    && sameGoalValue(parseGoalDataDeleteInput('delete', value.input), value.input) && value.input.goalId === goalId
    && teachingRequestSha256(value.input) === value.requestSha256, 'DELETION_INTENT_INVALID');
  return value;
}
/** Thin local intent is a conservative write fence, never proof of deletion. */
export function goalDeletionState(store, goalId) {
  if (!store || goalId === null) return null;
  needGoal(uuid(goalId), 'GOAL_ID_INVALID');
  for (const name of ['goal-tombstones', 'delete-intents']) {
    const dir = deletionDirectory(store, name);
    if (!dir) continue;
    const value = readGoalJson(join(dir, `${goalId}.json`), null);
    if (value === null) continue;
    if (name === 'goal-tombstones') {
      needGoal(exact(value, ['format', 'subject', 'receipt']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
        && validGoalDataDeleteResult('preview', { contract: GOAL_DATA_DELETE_CONTRACT, status: 'deleted', goalId, receipt: value.receipt },
          { contract: GOAL_DATA_DELETE_CONTRACT, goalId }), 'DELETION_MARKER_INVALID');
      return { status: 'deleted', ...value };
    }
    return { status: 'delete_pending', ...goalDeletionIntent(store, goalId) };
  }
  return null;
}
export function assertGoalWritable(store, input) {
  const state = goalDeletionState(store, localGoalId(input));
  needGoal(!state, state?.status === 'deleted' ? 'GOAL_DELETED' : 'GOAL_DELETE_PENDING');
  const network = networkDeletionState(store, localNetworkTarget(input));
  needGoal(!network, network?.status === 'deleted' ? 'NETWORK_CONTENT_DELETED' : 'NETWORK_DELETE_PENDING');
}
function validateGoalDeletionIntent(store, input) {
  const parsed = parseGoalDataDeleteInput('delete', input), current = goalDeletionState(store, parsed.goalId);
  needGoal(!goalDeletionCancellation(store, parsed.operationId), 'DELETE_OPERATION_CANCELLED');
  if (current?.status === 'deleted') throw new GoalPluginError('GOAL_DELETED');
  const value = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, input: parsed, requestSha256: teachingRequestSha256(parsed) };
  if (current) needGoal(sameGoalValue({ format: current.format, subject: current.subject, input: current.input, requestSha256: current.requestSha256 }, value), 'GOAL_DELETE_PENDING');
  return { value, current };
}
export function stageGoalDeletionIntent(store, input) {
  const { value, current } = validateGoalDeletionIntent(store, input);
  if (!current) durableGoalJson(join(deletionDirectory(store, 'delete-intents', true), `${value.input.goalId}.json`), value);
}
export function goalDeletionCancellation(store, operationId) {
  if (!store) return null;
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID');
  const dir = deletionDirectory(store, 'delete-cancellations'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${operationId}.json`), null); if (value === null) return null;
  const input = { contract: GOAL_DATA_DELETE_CONTRACT, operationId, requestSha256: value.receipt?.requestSha256 };
  needGoal(exact(value, ['format', 'subject', 'receipt']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
    && value.receipt?.status === 'cancelled' && validGoalDataDeleteResult('operation', { ...input, status: 'completed', terminal: true, receipt: value.receipt }, input), 'DELETION_CANCELLATION_INVALID');
  return value.receipt;
}
export function goalOperationTombstone(store, operationId) {
  if (!store) return null;
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID');
  const dir = deletionDirectory(store, 'deleted-operations'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${operationId}.json`), null); if (value === null) return null;
  needGoal(exact(value, ['format', 'subject', 'goalId', 'operationId', 'tool', 'requestSha256', 'planSha256']) && value.format === GOAL_PLUGIN_FORMAT
    && value.subject === store.subject && value.operationId === operationId && uuid(value.goalId) && hash(value.requestSha256) && hash(value.planSha256), 'DELETION_MARKER_INVALID');
  checkIndex(store, operationId, value.tool, value.requestSha256);
  const deletion = goalDeletionState(store, value.goalId); needGoal(deletion?.status === 'deleted', 'DELETION_MARKER_INVALID');
  return { ...value, receipt: deletion.receipt };
}
export function networkDeletionIntent(store, target) {
  if (!store || target === null) return null;
  const key = networkTargetKey(target), dir = deletionDirectory(store, 'network-delete-intents'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${key}.json`), null); if (value === null) return null;
  needGoal(exact(value, ['format', 'subject', 'input', 'requestSha256']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
    && sameGoalValue(parseGoalNetworkDeleteInput('delete', value.input), value.input) && sameGoalValue(value.input.target, target)
    && teachingRequestSha256(value.input) === value.requestSha256, 'DELETION_INTENT_INVALID'); return value;
}
export function networkDeletionState(store, target) {
  if (!store || target === null) return null;
  const key = networkTargetKey(target), dir = deletionDirectory(store, 'network-tombstones');
  const value = dir ? readGoalJson(join(dir, `${key}.json`), null) : null;
  if (value !== null) {
    needGoal(exact(value, ['format', 'subject', 'receipt']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
      && validGoalNetworkDeleteResult('preview', { contract: GOAL_NETWORK_DELETE_CONTRACT, status: 'deleted', target, receipt: value.receipt },
        { contract: GOAL_NETWORK_DELETE_CONTRACT, target }), 'DELETION_MARKER_INVALID');
    return { status: 'deleted', ...value };
  }
  const intent = networkDeletionIntent(store, target); return intent ? { status: 'delete_pending', ...intent } : null;
}
function validateNetworkDeletionIntent(store, input) {
  const parsed = parseGoalNetworkDeleteInput('delete', input), current = networkDeletionState(store, parsed.target);
  needGoal(!networkDeletionCancellation(store, parsed.operationId), 'DELETE_OPERATION_CANCELLED');
  needGoal(current?.status !== 'deleted', 'NETWORK_CONTENT_DELETED');
  const value = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, input: parsed, requestSha256: teachingRequestSha256(parsed) };
  if (current) needGoal(sameGoalValue({ format: current.format, subject: current.subject, input: current.input, requestSha256: current.requestSha256 }, value), 'NETWORK_DELETE_PENDING');
  return { value, current };
}
export function stageNetworkDeletionIntent(store, input) {
  const { value, current } = validateNetworkDeletionIntent(store, input);
  if (!current) durableGoalJson(join(deletionDirectory(store, 'network-delete-intents', true), `${networkTargetKey(value.input.target)}.json`), value);
}
export function networkDeletionCancellation(store, operationId) {
  if (!store) return null;
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID');
  const dir = deletionDirectory(store, 'network-delete-cancellations'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${operationId}.json`), null); if (value === null) return null;
  const input = { contract: GOAL_NETWORK_DELETE_CONTRACT, operationId, requestSha256: value.receipt?.requestSha256 };
  needGoal(exact(value, ['format', 'subject', 'receipt']) && value.format === GOAL_PLUGIN_FORMAT && value.subject === store.subject
    && value.receipt?.status === 'cancelled' && validGoalNetworkDeleteResult('operation', { ...input, status: 'completed', terminal: true, receipt: value.receipt }, input), 'DELETION_CANCELLATION_INVALID');
  return value.receipt;
}
export function networkOperationTombstone(store, operationId) {
  if (!store) return null;
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID');
  const dir = deletionDirectory(store, 'network-deleted-operations'); if (!dir) return null;
  const value = readGoalJson(join(dir, `${operationId}.json`), null); if (value === null) return null;
  needGoal(exact(value, ['format', 'subject', 'target', 'operationId', 'tool', 'requestSha256', 'planSha256']) && value.format === GOAL_PLUGIN_FORMAT
    && value.subject === store.subject && value.operationId === operationId && validGoalNetworkDeleteTarget(value.target)
    && hash(value.requestSha256) && hash(value.planSha256), 'DELETION_MARKER_INVALID');
  checkIndex(store, operationId, value.tool, value.requestSha256);
  const deletion = networkDeletionState(store, value.target); needGoal(deletion?.status === 'deleted', 'DELETION_MARKER_INVALID');
  return { ...value, receipt: deletion.receipt };
}
const deletionToolPrefix = contract => contract === GOAL_NETWORK_DELETE_CONTRACT ? 'aidesk_goal_network_delete' : 'aidesk_goal_data_delete';
const deletionContract = contract => [GOAL_DATA_DELETE_CONTRACT, GOAL_NETWORK_DELETE_CONTRACT].includes(contract);
function stageDeletion(store, input, validateOnly = false) {
  return input.contract === GOAL_NETWORK_DELETE_CONTRACT
    ? (validateOnly ? validateNetworkDeletionIntent : stageNetworkDeletionIntent)(store, input)
    : (validateOnly ? validateGoalDeletionIntent : stageGoalDeletionIntent)(store, input);
}
function claimIndex(store, operationId, tool, requestSha256, contract) {
  const path = join(store.indices, `${operationId}.json`);
  if (readGoalJson(path, null) !== null) { checkIndex(store, operationId, tool, requestSha256, contract); return; }
  const value = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, tool, requestSha256,
    ...(tool === 'aidesk_goal_service_cooperate' ? { contract } : {}) };
  const temporary = `${path}.${randomUUID()}.tmp`; durableGoalJson(temporary, value, true);
  try {
    try { linkSync(temporary, path); syncDirectory(store.indices); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    // Atomic publication makes competing accounts observe all or none of the
    // immutable claim. A claim without a request is a recoverable prewrite stop;
    // it is never deleted to let another account reuse the original number.
    checkIndex(store, operationId, tool, requestSha256, contract);
  } finally { unlinkSync(temporary); syncDirectory(store.indices); }
}
function entryAt(path, subject, operationId) {
  const entry = readGoalJson(join(path, 'request.json'));
  needGoal(exact(entry, ['format', 'subject', 'tool', 'input', 'requestSha256', 'preparedAt'])
    && entry.format === GOAL_PLUGIN_FORMAT && entry.subject === subject && hash(entry.requestSha256) && isTimestamp(entry.preparedAt), 'ORIGINAL_INVALID');
  const tool = goalTool(entry.tool);
  needGoal(isGoalWrite(tool, entry.input) && entry.input?.operationId === operationId && sameGoalValue(tool.parse(tool.action, entry.input), entry.input)
    && teachingRequestSha256(entry.input) === entry.requestSha256, 'ORIGINAL_INVALID');
  const state = readGoalJson(join(path, 'status.json'), { status: 'prepared', updatedAt: entry.preparedAt, receiptSha256: null });
  needGoal(exact(state, ['status', 'updatedAt', 'receiptSha256']) && ['prepared', 'dispatched_unknown', 'completed'].includes(state.status)
    && isTimestamp(state.updatedAt) && (state.status === 'completed' ? hash(state.receiptSha256) : state.receiptSha256 === null), 'STATE_INVALID');
  return { path, entry, state };
}
export function loadGoalOperation(store, operationId) {
  needGoal(uuid(operationId), 'OPERATION_ID_INVALID'); needGoal(store, 'ORIGINAL_NOT_FOUND');
  const pending = optionalDirectory(join(store.pending, operationId));
  const staging = optionalDirectory(join(store.staging, operationId));
  const shard = optionalDirectory(join(store.completed, operationId.slice(0, 2)));
  const completed = shard && optionalDirectory(join(shard, operationId));
  needGoal([pending, staging, completed].filter(Boolean).length <= 1, 'DUPLICATE_LOCAL_ORIGINAL');
  needGoal(pending || staging || completed, 'ORIGINAL_NOT_FOUND');
  if (staging) needGoal(readGoalJson(join(staging, 'request.json'), null) !== null, 'ORIGINAL_NOT_READY');
  const row = entryAt(pending || staging || completed, store.subject, operationId);
  checkIndex(store, operationId, row.entry.tool, row.entry.requestSha256, row.entry.input.contract);
  needGoal(!completed || row.state.status === 'completed', 'STATE_INVALID'); return row;
}
// A service operation read can use an immutable thin claim, but cannot choose a
// version from today's policy or from the tool name. No directory is created.
export function assertGoalServiceOperation(store, input) {
  if (!store) return;
  let row;
  try { row = loadGoalOperation(store, input.operationId); }
  catch (error) { if (!(error instanceof GoalPluginError && ['ORIGINAL_NOT_FOUND', 'ORIGINAL_NOT_READY'].includes(error.code))) throw error; }
  let original = row?.entry;
  if (!original) {
    if (readGoalJson(join(store.indices, `${input.operationId}.json`), null) === null) return;
    original = ownGoalIndex(store, input.operationId);
  }
  const contract = original.input?.contract ?? original.contract;
  needGoal(serviceContract(contract), 'ORIGINAL_CONTRACT_UNKNOWN');
  needGoal(original.tool === 'aidesk_goal_service_cooperate' && original.requestSha256 === input.requestSha256
    && contract === input.contract, 'ORIGINAL_MISMATCH');
}
function cancelledOriginal(store, operationId, claim, input = null) {
  const receipt = claim.tool === 'aidesk_goal_network_delete' ? networkDeletionCancellation(store, operationId) : goalDeletionCancellation(store, operationId); if (!receipt) return false;
  needGoal(claim.tool === deletionToolPrefix(receipt.contract) && claim.requestSha256 === receipt.requestSha256
    && (!input || goalTool(claim.tool).valid('cancel', receipt, input)), 'DELETION_CANCELLATION_INVALID');
  return true;
}
function pendingRows(store) {
  if (!store) return [];
  const rows = readdirSync(store.pending).map(id => {
    needGoal(uuid(id), 'PENDING_INVALID'); safeDirectory(join(store.pending, id));
    const row = entryAt(join(store.pending, id), store.subject, id);
    checkIndex(store, id, row.entry.tool, row.entry.requestSha256, row.entry.input.contract);
    return cancelledOriginal(store, id, row.entry, row.entry.input) ? null : row;
  }).filter(Boolean);
  // Cancelled originals remain recoverable, but the verified terminal fact
  // releases capacity as well as the intent; raw directory counts do not.
  needGoal(rows.length <= GOAL_PLUGIN_LIMITS.pending, 'PENDING_LIMIT'); return rows;
}
function stagingRows(store) {
  if (!store) return [];
  const rows = readdirSync(store.staging).map(operationId => {
    needGoal(uuid(operationId), 'STAGING_INVALID'); const path = safeDirectory(join(store.staging, operationId));
    const claim = ownIndex(store, operationId);
    const entry = readGoalJson(join(path, 'request.json'), null) === null ? null : entryAt(path, store.subject, operationId).entry;
    if (entry) checkIndex(store, operationId, entry.tool, entry.requestSha256, entry.input.contract);
    return cancelledOriginal(store, operationId, claim, entry?.input) ? null : { operationId, tool: claim.tool,
      requestSha256: claim.requestSha256, status: 'prewrite_incomplete', preparedAt: null };
  }).filter(Boolean);
  needGoal(rows.length <= GOAL_PLUGIN_LIMITS.pending, 'STAGING_LIMIT'); return rows;
}
export function markGoalUnknown(row, now) {
  if (row.state.status === 'completed') return;
  const state = { status: 'dispatched_unknown', updatedAt: new Date(now).toISOString(), receiptSha256: null };
  durableGoalJson(join(row.path, 'status.json'), state); row.state = state;
}
export function completeGoalOperation(store, row, receipt, now) {
  assertGoalWritable(store, row.entry.input);
  const tool = goalTool(row.entry.tool);
  if (tool.contract === GOAL_NETWORK_SCOPE_CONTRACT) {
    // Both a write reply and an operation query recover the same immutable
    // core; neither one asserts that historical membership is still active.
    if (!validScopeCore(receipt, row.entry.input)) {
      needGoal(tool.valid(tool.action, receipt, row.entry.input), 'RECEIPT_INVALID');
      receipt = receipt.receipt;
    }
    needGoal(validScopeCore(receipt, row.entry.input), 'RECEIPT_INVALID');
  } else if (tool.contract === GOAL_NETWORK_CONTRACT) {
    // An operation envelope has no body. Validate its core against the actual
    // original's full digest and exact metadata projection, never as a read.
    if (validNetworkCore(receipt, row.entry.input)) { /* Already a core. */ }
    else {
      needGoal(tool.valid(tool.action, receipt, row.entry.input) && (tool.action !== 'read' || receipt.status === 'found'), 'RECEIPT_INVALID');
      receipt = receipt.receipt ?? { format: GOAL_PLUGIN_FORMAT, kind: 'observed_read_without_admission',
        operationId: row.entry.input.operationId, requestSha256: row.entry.requestSha256 };
    }
  } else needGoal(tool.valid(tool.action, receipt, row.entry.input), 'RECEIPT_INVALID');
  // Only the task reservation's one-time delivery disposition can vary when
  // querying the same committed fact. This comparison is never returned as a
  // receipt or creation permission. All other fields remain byte-equivalent.
  const comparable = value => tool.contract === GOAL_TASK_CONTRACT && tool.action === 'reserve'
    ? { ...value, creationDisposition: 'reconcile_only' } : value;
  const receiptSha256 = teachingRequestSha256(comparable(receipt));
  if (tool.contract === GOAL_TASK_CONTRACT || tool.contract === GOAL_NETWORK_CONTRACT || tool.contract === GOAL_NETWORK_SCOPE_CONTRACT) {
    const path = join(row.path, 'receipt.json'), first = readGoalJson(path, null);
    if (first !== null) needGoal((tool.contract === GOAL_NETWORK_CONTRACT || tool.contract === GOAL_NETWORK_SCOPE_CONTRACT && validScopeCore(first, row.entry.input) || tool.valid(tool.action, first, row.entry.input))
      && sameGoalValue(comparable(first), comparable(receipt)), 'RECEIPT_CONFLICT');
    // Keep the first observed receipt intact, including fresh when actually
    // observed. A late Post or operation query never overwrites this evidence.
    else publishOriginal(path, receipt);
  }
  if (row.state.status === 'completed') needGoal(row.state.receiptSha256 === receiptSha256, 'RECEIPT_CONFLICT');
  else {
    row.state = { status: 'completed', updatedAt: new Date(now).toISOString(), receiptSha256 };
    durableGoalJson(join(row.path, 'status.json'), row.state);
  }
  // Move the whole directory, retaining the exact original bytes and call
  // metadata. A crash after terminal status remains recoverable from pending.
  if ([store.pending, store.staging].includes(dirname(row.path))) {
    const sourceParent = dirname(row.path);
    const shard = safeDirectory(join(store.completed, row.entry.input.operationId.slice(0, 2)), true);
    const target = join(shard, row.entry.input.operationId); needGoal(!optionalDirectory(target), 'DUPLICATE_LOCAL_ORIGINAL');
    syncDirectory(store.completed); renameSync(row.path, target); syncDirectory(shard); syncDirectory(sourceParent); row.path = target;
  }
  return row.state;
}
/** Evidence of this actual Post only; never a cached body or renewed grant. */
export function validGoalNetworkReadObservation(value, row) {
  if (!goalMayRepeatRead(goalTool(row.entry.tool), row.entry.input) || !exact(value, ['observation', 'observedAt']) || !isTimestamp(value.observedAt)) return false;
  const o = value.observation, item = o?.item, p = row.entry.input;
  return exact(o, ['format', 'kind', 'operationId', 'requestSha256', 'resultSha256', 'item', 'admissionObserved'])
    && o.format === GOAL_PLUGIN_FORMAT && o.kind === 'observed_network_read' && o.operationId === p.operationId && o.requestSha256 === row.entry.requestSha256
    && hash(o.resultSha256) && typeof o.admissionObserved === 'boolean'
    && exact(item, ['kind', 'id', 'cohortId', 'postId', 'version', 'contentSha256', 'sourceStatus']) && item.kind === p.view
    && item.cohortId === p.cohortId && item.postId === p.postId && item.version === p.version && item.id === (p.view === 'post' ? p.postId : p.responseId)
    && hash(item.contentSha256) && ['available', 'withdrawn', 'unavailable'].includes(item.sourceStatus);
}
export function recordGoalNetworkReadObservation(row, result, call, now) {
  const tool = goalTool(row.entry.tool);
  needGoal(goalMayRepeatRead(tool, row.entry.input) && tool.valid('read', result, row.entry.input) && result.status === 'found', 'RESULT_INVALID');
  matchGoalCall(row, call);
  const path = safeDirectory(join(row.path, 'read-observations'), true);
  const id = goalHash(canonicalTeachingJson({ sessionId: call.sessionId, toolUseId: call.toolUseId }));
  const item = result.item;
  const value = { format: GOAL_PLUGIN_FORMAT, kind: 'observed_network_read', operationId: row.entry.input.operationId,
    requestSha256: row.entry.requestSha256, resultSha256: teachingRequestSha256(result),
    item: { kind: item.kind, id: item.id, cohortId: item.cohortId, postId: item.postId, version: item.version,
      contentSha256: item.contentSha256, sourceStatus: item.sourceStatus }, admissionObserved: result.receipt !== null };
  const file = join(path, `${id}.json`), previous = readGoalJson(file, null);
  if (previous !== null) needGoal(exact(previous, ['observation', 'observedAt']) && isTimestamp(previous.observedAt)
    && sameGoalValue(previous.observation, value), 'READ_OBSERVATION_CONFLICT');
  else publishOriginal(file, { observation: value, observedAt: new Date(now).toISOString() });
}
export function reserveGoalCall(row, { sessionId, toolUseId, tool, input, now }) {
  needGoal(opaqueGoalId(sessionId) && opaqueGoalId(toolUseId), 'CALL_ID_REQUIRED');
  const calls = safeDirectory(join(row.path, 'calls'), true);
  const callId = goalHash(canonicalTeachingJson({ sessionId, toolUseId }));
  const value = { format: GOAL_PLUGIN_FORMAT, tool, argumentsSha256: teachingRequestSha256(input),
    sessionSha256: goalHash(sessionId), toolUseSha256: goalHash(toolUseId), preparedAt: new Date(now).toISOString() };
  const path = join(calls, `${callId}.json`), previous = readGoalJson(path, null);
  if (previous !== null) {
    matchGoalCall(row, { sessionId, toolUseId, tool, input });
    return previous;
  }
  // Only write observations consume this finite candidate allowance. Original-
  // number queries remain available regardless of how often they say not_found.
  needGoal(readdirSync(calls).length < GOAL_PLUGIN_LIMITS.callsPerOperation, 'CALL_LIMIT');
  durableGoalJson(path, value, true); return value;
}
export function matchGoalCall(row, { sessionId, toolUseId, tool, input }) {
  needGoal(opaqueGoalId(sessionId) && opaqueGoalId(toolUseId), 'CALL_ID_REQUIRED');
  const calls = safeDirectory(join(row.path, 'calls'));
  const saved = readGoalJson(join(calls, `${goalHash(canonicalTeachingJson({ sessionId, toolUseId }))}.json`));
  needGoal(exact(saved, ['format', 'tool', 'argumentsSha256', 'sessionSha256', 'toolUseSha256', 'preparedAt']) && saved.format === GOAL_PLUGIN_FORMAT
    && saved.tool === tool && saved.argumentsSha256 === teachingRequestSha256(input) && saved.sessionSha256 === goalHash(sessionId)
    && saved.toolUseSha256 === goalHash(toolUseId) && isTimestamp(saved.preparedAt), 'CALL_MISMATCH');
}

export async function prepareGoalRequest({ tool: name, subject, semanticInput }) {
  const tool = goalTool(name); needGoal(tool.write, 'WRITE_TOOL_REQUIRED');
  const semantic = typeof semanticInput === 'string' ? parseTeachingJson(semanticInput, GOAL_PLUGIN_LIMITS.fileBytes) : structuredClone(semanticInput);
  needGoal(object(semantic) && !Object.hasOwn(semantic, 'operationId') && !Object.hasOwn(semantic, 'expectedAccountSubject'), 'SEMANTIC_INPUT_INVALID');
  const contract = name === 'aidesk_goal_service_cooperate' && Object.hasOwn(semantic, 'contract') ? semantic.contract : tool.contract;
  needGoal(name === 'aidesk_goal_service_cooperate' ? serviceContract(contract) : contract === tool.contract, 'SEMANTIC_INPUT_INVALID');
  if (Object.hasOwn(semantic, 'contract')) needGoal(semantic.contract === contract, 'SEMANTIC_INPUT_INVALID');
  if (name === 'aidesk_goal_draft_save' && !Object.hasOwn(semantic, 'goalId')) {
    needGoal(semantic.expectedVersion === 0, 'EXISTING_GOAL_ID_REQUIRED'); semantic.goalId = randomUUID();
  }
  if (name === 'aidesk_goal_task_reserve' && !Object.hasOwn(semantic, 'attemptId')) semantic.attemptId = randomUUID();
  if (name === 'aidesk_goal_task_record' && object(semantic.event) && semantic.event.kind === 'report'
    && !Object.hasOwn(semantic.event, 'reportId')) semantic.event.reportId = randomUUID();
  if (name === 'aidesk_goal_network_publish' && !Object.hasOwn(semantic, 'postId')) {
    needGoal(semantic.expectedVersion === 0, 'EXISTING_POST_ID_REQUIRED'); semantic.postId = randomUUID();
  }
  if (name === 'aidesk_goal_network_respond' && !Object.hasOwn(semantic, 'responseId')) semantic.responseId = randomUUID();
  if (name === 'aidesk_goal_network_scope_invite' && !Object.hasOwn(semantic, 'cohortId')) semantic.cohortId = randomUUID();
  if (name === 'aidesk_goal_network_scope_request' && !Object.hasOwn(semantic, 'requestId')) semantic.requestId = randomUUID();
  if (name === 'aidesk_goal_network_adopt' && !Object.hasOwn(semantic, 'adoptionId')) semantic.adoptionId = randomUUID();
  needGoal(isGoalWrite(tool, semantic), 'WRITE_TOOL_REQUIRED');
  // Only recovery and explicit new entity identifiers are generated. Host/task/source identifiers and
  // remote sequence/version values must come from actual observed inputs.
  const input = tool.parse(tool.action, { ...semantic, contract, operationId: randomUUID() });
  return { tool: name, input: withExpectedGoalAccount(input, subject), requestSha256: teachingRequestSha256(input), status: 'generated' };
}
/** Called under the account lock by PreToolUse, where the host provides the
 * actual Plugin directory. It does not infer that a helper ran or a user agreed. */
export function stageGoalRequest(store, { tool: name, input, now = Date.now() }) {
  needGoal(store, 'PLUGIN_DATA_REQUIRED'); const tool = goalTool(name); needGoal(tool.write, 'WRITE_TOOL_REQUIRED');
  const businessInput = tool.parse(tool.action, input); needGoal(isGoalWrite(tool, businessInput), 'WRITE_TOOL_REQUIRED');
  if (!deletionContract(tool.contract)) assertGoalWritable(store, businessInput);
  const requestSha256 = teachingRequestSha256(businessInput);
  let existing;
  try { existing = loadGoalOperation(store, businessInput.operationId); }
  catch (error) { if (!(error instanceof GoalPluginError && ['ORIGINAL_NOT_FOUND', 'ORIGINAL_NOT_READY'].includes(error.code))) throw error; }
  if (existing) {
    needGoal(existing.entry.tool === name && sameGoalValue(existing.entry.input, businessInput), 'ORIGINAL_MISMATCH');
    if (dirname(existing.path) !== store.staging) {
      if (deletionContract(tool.contract)) stageDeletion(store, businessInput);
      return existing;
    }
  }
  const stagedPath = join(store.staging, businessInput.operationId); optionalDirectory(stagedPath);
  const stagedRows = stagingRows(store);
  needGoal(pendingRows(store).length + stagedRows.length - (stagedRows.some(row => row.operationId === businessInput.operationId) ? 1 : 0) < GOAL_PLUGIN_LIMITS.pending, 'PENDING_LIMIT');
  // A rejected competing deletion must not publish an unattributable owner
  // claim. This read-only check precedes the claim; persistence follows it.
  if (deletionContract(tool.contract)) stageDeletion(store, businessInput, true);
  claimIndex(store, businessInput.operationId, name, requestSha256, businessInput.contract);
  // First establish the immutable original-number ownership. A conflicting
  // request must not leave a deletion fence on an unrelated/new goal.
  if (deletionContract(tool.contract)) stageDeletion(store, businessInput);
  safeDirectory(stagedPath, true);
  const entry = { format: GOAL_PLUGIN_FORMAT, subject: store.subject, tool: name, input: businessInput,
    requestSha256, preparedAt: new Date(now).toISOString() };
  if (!existing) publishOriginal(join(stagedPath, 'request.json'), entry);
  const path = join(store.pending, businessInput.operationId);
  needGoal(!optionalDirectory(path), 'DUPLICATE_LOCAL_ORIGINAL');
  renameSync(stagedPath, path); syncDirectory(store.pending); syncDirectory(store.staging);
  return entryAt(path, store.subject, businessInput.operationId);
}
export async function recoverGoalRequest({ operationId, subject, dataRoot, retry = false, cancel = false }) {
  return withGoalStore({ dataRoot, subject }, store => {
    const cancellation = goalDeletionCancellation(store, operationId) ?? networkDeletionCancellation(store, operationId);
    if (cancellation) {
      needGoal(!retry && !cancel, 'DELETE_OPERATION_CANCELLED');
      return { tool: deletionToolPrefix(cancellation.contract) + '_operation', input: withExpectedGoalAccount({ contract: cancellation.contract,
        operationId, requestSha256: cancellation.requestSha256 }, subject), status: 'cancelled', requestSha256: cancellation.requestSha256 };
    }
    const deleted = goalOperationTombstone(store, operationId) ?? networkOperationTombstone(store, operationId);
    if (deleted) {
      needGoal(!retry && !cancel, 'GOAL_DELETED');
      return { tool: deletionToolPrefix(deleted.receipt.contract) + '_operation', input: withExpectedGoalAccount({ contract: deleted.receipt.contract,
        operationId: deleted.receipt.operationId, requestSha256: deleted.receipt.requestSha256 }, subject),
      status: 'deleted', originalOperation: { operationId, tool: deleted.tool, requestSha256: deleted.requestSha256 } };
    }
    let row;
    try { row = loadGoalOperation(store, operationId); }
    catch (error) {
      if (retry || !store || !(error instanceof GoalPluginError && ['ORIGINAL_NOT_FOUND', 'ORIGINAL_NOT_READY'].includes(error.code))) throw error;
      const claim = ownIndex(store, operationId);
      row = { entry: { tool: claim.tool, requestSha256: claim.requestSha256, contract: claim.contract }, state: { status: 'prewrite_incomplete' } };
      if (cancel && ['aidesk_goal_data_delete', 'aidesk_goal_network_delete'].includes(claim.tool)) {
        const network = claim.tool === 'aidesk_goal_network_delete';
        const dir = deletionDirectory(store, network ? 'network-delete-intents' : 'delete-intents');
        for (const name of dir ? readdirSync(dir) : []) {
          if (!name.endsWith('.json') || !(network ? hash : uuid)(name.slice(0, -5))) continue;
          const target = network ? readGoalJson(join(dir, name)).input?.target : name.slice(0, -5);
          if (network) needGoal(networkTargetKey(target) === name.slice(0, -5), 'DELETION_INTENT_INVALID');
          const intent = network ? networkDeletionIntent(store, target) : goalDeletionIntent(store, target);
          if (intent.input.operationId === operationId && intent.requestSha256 === claim.requestSha256) row.entry.input = intent.input;
        }
      }
    }
    const { entry, state } = row, tool = goalTool(entry.tool);
    const deletion = goalDeletionState(store, localGoalId(entry.input)) ?? networkDeletionState(store, localNetworkTarget(entry.input));
    if (deletion?.status === 'deleted') {
      needGoal(!retry && !cancel, 'GOAL_DELETED');
      return { tool: deletionToolPrefix(deletion.receipt.contract) + '_operation', input: withExpectedGoalAccount({ contract: deletion.receipt.contract,
        operationId: deletion.receipt.operationId, requestSha256: deletion.receipt.requestSha256 }, subject),
      status: 'deleted', originalOperation: { operationId, tool: entry.tool, requestSha256: entry.requestSha256 } };
    }
    if (cancel) {
      needGoal(deletionContract(tool.contract) && entry.input, 'DELETE_ORIGINAL_REQUIRED');
      return { tool: deletionToolPrefix(tool.contract) + '_cancel', input: withExpectedGoalAccount(tool.parse('cancel', entry.input), subject),
        requestSha256: entry.requestSha256, status: state.status };
    }
    if (retry) {
      needGoal(entry.input, 'ORIGINAL_NOT_READY');
      if (deletionContract(tool.contract)) stageDeletion(store, entry.input);
      else assertGoalWritable(store, entry.input);
      needGoal(state.status !== 'completed' || goalMayRepeatRead(tool, entry.input), 'ALREADY_COMPLETED');
      return { tool: entry.tool, input: withExpectedGoalAccount(entry.input, subject), requestSha256: entry.requestSha256, status: state.status };
    }
    // The immutable request is authoritative; a new thin service claim also
    // records the version before request publication. Old unversioned thin
    // claims cannot prove v1: the existing Hook already accepted both versions.
    const contract = entry.tool === 'aidesk_goal_service_cooperate' ? entry.input?.contract ?? entry.contract : tool.contract;
    needGoal(entry.tool !== 'aidesk_goal_service_cooperate' || serviceContract(contract), 'ORIGINAL_CONTRACT_UNKNOWN');
    return { tool: tool.operationTool, input: withExpectedGoalAccount(tool.parse('operation', { contract, ...([GOAL_NETWORK_CONTRACT, GOAL_NETWORK_SCOPE_CONTRACT].includes(tool.contract) ? { action: 'operation' } : {}), operationId, requestSha256: entry.requestSha256 }), subject),
      requestSha256: entry.requestSha256, status: state.status,
      ...(localNetworkTarget(entry.input) ? { ifNotFound: { tool: 'aidesk_goal_network_delete_preview', input: withExpectedGoalAccount({ contract: GOAL_NETWORK_DELETE_CONTRACT, target: localNetworkTarget(entry.input) }, subject) } } : {}),
      ...(localGoalId(entry.input) ? { ifNotFound: { tool: 'aidesk_goal_data_delete_preview', input: withExpectedGoalAccount({ contract: GOAL_DATA_DELETE_CONTRACT, goalId: localGoalId(entry.input) }, subject) } } : {}) };
  });
}
export async function pendingGoalRequests({ subject, dataRoot, afterOperationId = null, limit = GOAL_PLUGIN_LIMITS.list }) {
  needGoal(afterOperationId === null || uuid(afterOperationId), 'CURSOR_INVALID');
  needGoal(Number.isSafeInteger(limit) && limit >= 1 && limit <= GOAL_PLUGIN_LIMITS.list, 'LIMIT_INVALID');
  return withGoalStore({ dataRoot, subject }, store => {
    const rows = pendingRows(store).filter(row => row.state.status !== 'completed').map(({ entry, state }) => ({ operationId: entry.input.operationId,
      tool: entry.tool, requestSha256: entry.requestSha256, status: state.status, preparedAt: entry.preparedAt }));
    // Interrupted prewrites expose metadata only, never a dispatch claim.
    rows.push(...stagingRows(store));
    const remaining = rows.filter(row => !afterOperationId || row.operationId > afterOperationId).sort((a, b) => a.operationId.localeCompare(b.operationId));
    const items = remaining.slice(0, limit);
    return { items, nextAfterOperationId: remaining.length > limit ? items.at(-1).operationId : null };
  });
}

export async function readGoalStdin(stream = process.stdin) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream) { bytes += chunk.length; needGoal(bytes <= GOAL_PLUGIN_LIMITS.inputBytes, 'INPUT_LIMIT'); chunks.push(chunk); }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
// Business input is always validated and hashed before the account guard.
async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  needGoal(['prepare', 'operation', 'retry', 'pending', 'cancel'].includes(command) && args.length % 2 === 0, 'USAGE');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; needGoal(['--subject', '--tool', '--operation-id', '--after-operation-id', '--limit', '--data-root'].includes(key) && !Object.hasOwn(options, key), 'USAGE'); options[key] = args[i + 1];
  }
  const allowed = command === 'prepare' ? ['--subject', '--tool'] : command === 'pending' ? ['--subject', '--after-operation-id', '--limit', '--data-root'] : ['--subject', '--operation-id', '--data-root'];
  needGoal(Object.keys(options).every(key => allowed.includes(key)), 'USAGE');
  const subject = options['--subject'], dataRoot = options['--data-root']; let result;
  if (command !== 'prepare') needGoal(typeof dataRoot === 'string', 'RECOVERY_DIRECTORY_REQUIRED');
  if (command === 'prepare') result = await prepareGoalRequest({ tool: options['--tool'], subject, semanticInput: await readGoalStdin() });
  else if (command === 'pending') result = await pendingGoalRequests({ subject, dataRoot, afterOperationId: options['--after-operation-id'] ?? null,
    limit: options['--limit'] === undefined ? GOAL_PLUGIN_LIMITS.list : Number(options['--limit']) });
  else result = await recoverGoalRequest({ subject, dataRoot, operationId: options['--operation-id'], retry: command === 'retry', cancel: command === 'cancel' });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof GoalPluginError ? error.code : 'REQUEST_UNAVAILABLE',
    advice: 'prepare 只生成参数，不保存或派发；仅明确尚未发 MCP 且没有可用输出时可重新生成。拿到输出或已调用 MCP 后保留原号。恢复使用 Hook 实际提供的 --data-root，不猜目录、不换号。' })); process.exitCode = 1;
});
