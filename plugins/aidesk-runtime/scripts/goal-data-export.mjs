/** Explicit local export, never automatic collection or deletion. Single-goal
 * local source reads use the original account OS lock; output is a new directory.
 * A complete service snapshot does not establish an atomic cross-device backup. */
import { constants, openSync, closeSync, fstatSync, fsyncSync, readFileSync, writeFileSync, lstatSync, readdirSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { isUuid, isTimestamp } from './lib/domain-inputs.mjs';
import { canonicalTeachingJson, parseTeachingJson, teachingRequestSha256 } from './lib/teaching-business-contract.mjs';
import { readGoalMcpToolResult, splitGoalMcpRequest, validGoalAccountSubject, withExpectedGoalAccount } from './lib/goal-mcp-transport.mjs';
import { assembleGoalExport, GOAL_DATA_EXPORT_LIMITS } from './lib/goal-data-export-contract.mjs';
import { parseGoalNetworkInput, validGoalNetworkResult } from './lib/goal-network-contract.mjs';
import { withGoalStore, loadGoalOperation, readGoalJson, goalTool, validGoalNetworkReadObservation, networkOperationTombstone, goalDeletionState, GOAL_PLUGIN_FORMAT, goalHash, needGoal, GoalPluginError } from './goal-plugin-request.mjs';

import { NETWORK_DELETION_DIRECTORIES, validateLocalNetworkDeletionMetadata } from './goal-data-delete.mjs';

const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
function validCopyMetadata(value, collection, row, subject) {
  if (collection === 'calls') return exact(value, ['format', 'tool', 'argumentsSha256', 'sessionSha256', 'toolUseSha256', 'preparedAt'])
    && value.format === GOAL_PLUGIN_FORMAT && value.tool === row.entry.tool
    && value.argumentsSha256 === teachingRequestSha256(withExpectedGoalAccount(row.entry.input, subject))
    && hash(value.sessionSha256) && hash(value.toolUseSha256) && isTimestamp(value.preparedAt);
  return validGoalNetworkReadObservation(value, row);
}

const MAX_LOCAL_FILES = 4096, MAX_LOCAL_BYTES = 33554432;
function directory(path) { const s = lstatSync(path); needGoal(s.isDirectory() && !s.isSymbolicLink(), 'EXPORT_DIRECTORY_INVALID'); return path; }
function bytesAt(path, limit = 32768) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const s = fstatSync(fd); needGoal(s.isFile() && s.size <= limit, 'EXPORT_FILE_INVALID');
    const bytes = readFileSync(fd); needGoal(bytes.length <= limit, 'EXPORT_FILE_LIMIT'); return bytes;
  } finally { closeSync(fd); }
}
function syncDir(path) { if (process.platform === 'win32') return; const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function put(path, bytes) { const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); } syncDir(dirname(path));
  needGoal(bytesAt(path, MAX_LOCAL_BYTES).equals(bytes), 'EXPORT_READBACK_FAILED'); }
function ownGoal(input, goalId) { return input?.goalId === goalId || input?.goalRef?.goalId === goalId; }
function safeCode(error) { return error instanceof GoalPluginError ? error.code : 'LOCAL_COPY_UNAVAILABLE'; }
/** Input pages are exact {input, response} pairs from the authenticated MCP,
 * not a hand-written operation list. The returned metadata is body-free. */
export async function exportGoalData({ subject, goalId, dataRoot, output, pages }) {
  needGoal(validGoalAccountSubject(subject) && isUuid(goalId) && goalId === goalId.toLowerCase(), 'EXPORT_SELECTOR_INVALID');
  needGoal(Array.isArray(pages) && pages.length > 0 && pages.length <= 4096, 'EXPORT_PAGES_INVALID');
  const checked = pages.map(page => {
    needGoal(page && Object.keys(page).length === 2 && page.input && page.response, 'EXPORT_PAGES_INVALID');
    const { businessResult } = readGoalMcpToolResult(page.response, subject);
    needGoal(page.input.goalId === goalId, 'EXPORT_SELECTOR_MISMATCH'); return { input: page.input, result: businessResult };
  });
  const assembled = assembleGoalExport(checked);
  needGoal((dataRoot === undefined || dataRoot === null || typeof dataRoot === 'string' && isAbsolute(dataRoot)) && typeof output === 'string' && isAbsolute(output), 'EXPORT_PATH_REQUIRED');
  dataRoot = dataRoot == null ? null : resolve(dataRoot); output = resolve(output);
  // Existing ancestors only; a new leaf prevents overwrite, following links
  // or accidental copies into the recovery store itself (including /var alias).
  const outputParent = realpathSync(directory(dirname(output)));
  output = join(outputParent, relative(dirname(output), output));
  if (dataRoot !== null) {
    let sourceRoot;
    try { sourceRoot = realpathSync(dataRoot); } catch (e) { if (e.code !== 'ENOENT') throw e; sourceRoot = dataRoot; }
    needGoal(output !== sourceRoot && !output.startsWith(sourceRoot + sep) && !sourceRoot.startsWith(output + sep), 'EXPORT_PATH_OVERLAP');
  }
  const warnings = [], files = [], operations = []; let totalBytes = 0, scanned = 0;
  const warn = (code, operationId = null) => { if (!warnings.some(w => w.code === code && w.operationId === operationId)) warnings.push({ code, operationId }); };
  const payload = [];
  const include = (source, target, operationId) => {
    needGoal(payload.length < MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT'); const bytes = bytesAt(source); totalBytes += bytes.length;
    needGoal(totalBytes <= MAX_LOCAL_BYTES, 'EXPORT_LOCAL_LIMIT'); payload.push({ target, bytes }); files.push({ path: target, bytes: bytes.length, sha256: goalHash(bytes), operationId });
  };
  const expected = new Map(assembled.document.records.filter(r => r.localOperation).map(r => [r.localOperation.operationId, r.localOperation]));
  if (dataRoot === null) { warn('LOCAL_ROOT_NOT_PROVIDED'); for (const [id] of expected) operations.push({ operationId: id, status: 'not_inspected' }); return finishExport(); }
  return withGoalStore({ dataRoot, subject }, store => {
      if (!store) { warn('LOCAL_NAMESPACE_NOT_FOUND'); for (const [id] of expected) operations.push({ operationId: id, status: 'missing' }); return finishExport(); }
      needGoal(!goalDeletionState(store, goalId), 'GOAL_DELETE_PENDING_OR_DELETED');
      try {
      const discovered = new Set();
      for (const name of readdirSync(store.path)) if (!['pending', 'staging', 'completed', '.lock', 'delete-intents', 'goal-tombstones', 'deleted-operations', 'delete-plans', 'delete-cancellations', ...NETWORK_DELETION_DIRECTORIES].includes(name)) warn('UNATTRIBUTED_LOCAL_ITEM');
      try { validateLocalNetworkDeletionMetadata(store, MAX_LOCAL_FILES); } catch (error) { warn(safeCode(error)); }
      // Examine only this subject's bounded namespace. Titles never determine
      // ownership. A corrupt/unowned directory cannot silently count as absent.
      function idsAt(path, shards = false) {
        directory(path);
        for (const name of readdirSync(path).sort()) {
          if (++scanned > MAX_LOCAL_FILES) { warn('LOCAL_SCAN_LIMIT'); return; }
          if (shards) { if (!/^[a-f0-9]{2}$/u.test(name)) { warn('UNATTRIBUTED_LOCAL_ITEM'); continue; } idsAt(join(path, name)); }
          else if (isUuid(name) && name === name.toLowerCase()) discovered.add(name);
          else warn('UNATTRIBUTED_LOCAL_ITEM');
        }
      }
      idsAt(store.pending); idsAt(store.staging); idsAt(store.completed, true);
      for (const id of new Set([...expected.keys(), ...discovered])) {
        const op = expected.get(id); let row;
        try {
          row = loadGoalOperation(store, id);
          if (!ownGoal(row.entry.input, goalId)) { if (op) warn('ORIGINAL_GOAL_MISMATCH', id); continue; }
          if (!op) warn('LOCAL_OPERATION_NOT_IN_SERVICE_SNAPSHOT', id);
          else needGoal(row.entry.tool === op.tool && row.entry.requestSha256 === op.requestSha256, 'ORIGINAL_SERVICE_MISMATCH');
          const state = row.state.status;
          operations.push({ operationId: id, tool: row.entry.tool, requestSha256: row.entry.requestSha256, status: state, serviceMatched: !!op });
          if (state !== 'completed') warn('LOCAL_OUTCOME_NOT_CONFIRMED', id);
          // Stable receipt bytes must match the completed marker; hash alone
          // does not claim they are a remote backup or current grant.
          if (state === 'completed' && ['aidesk-goal-task-v1', 'aidesk-goal-network-v1'].includes(row.entry.input.contract)) {
            const receipt = parseTeachingJson(bytesAt(join(row.path, 'receipt.json')).toString('utf8'), 32768);
            if (row.entry.input.contract === 'aidesk-goal-task-v1') { const tool = goalTool(row.entry.tool); needGoal(tool.valid(tool.action, receipt, row.entry.input), 'RECEIPT_INVALID'); }
            const comparable = row.entry.tool === 'aidesk_goal_task_reserve' ? { ...receipt, creationDisposition: 'reconcile_only' } : receipt;
            needGoal(goalHash(canonicalTeachingJson(comparable)) === row.state.receiptSha256, 'RECEIPT_HASH_MISMATCH');
          }
          include(join(store.indices, `${id}.json`), `local/${id}/owner.json`, id);
          const stable = new Set(['request.json', 'status.json', 'receipt.json']);
          function copyDir(path, prefix, depth = 0) {
            directory(path);
            for (const name of readdirSync(path).sort()) {
              if (++scanned > MAX_LOCAL_FILES) { warn('LOCAL_SCAN_LIMIT', id); return; }
              const src = join(path, name), target = `${prefix}/${name}`, stat = lstatSync(src);
              if (depth === 0 && ['calls', 'read-observations'].includes(name)) { copyDir(src, target, 1); continue; }
              if (stat.isSymbolicLink() || !stat.isFile()) { warn('UNATTRIBUTED_LOCAL_ITEM', id); continue; }
              if (depth === 0 && stable.has(name)) {
                if (name === 'receipt.json' && !['aidesk-goal-task-v1', 'aidesk-goal-network-v1'].includes(row.entry.input.contract)) {
                  warn('UNEXPECTED_LOCAL_RECEIPT', id);
                  try { const v = readGoalJson(src), tool = goalTool(row.entry.tool);
                    if (!tool.valid(tool.action, v, row.entry.input) || row.state.status === 'completed' && teachingRequestSha256(v) !== row.state.receiptSha256) warn('RECEIPT_INVALID', id);
                  } catch { warn('RECEIPT_INVALID', id); }
                }
                include(src, target, id); continue;
              }
              if (depth === 1 && /^[a-f0-9]{64}\.json$/u.test(name)) {
                try { if (!validCopyMetadata(readGoalJson(src), path.split(sep).at(-1), row, subject)) warn('LOCAL_METADATA_INVALID', id); }
                catch { warn('LOCAL_METADATA_INVALID', id); }
                include(src, target, id); continue;
              }
              // Crash leftovers are copied only when their bytes exactly match
              // a validated stable file in this same operation. Unknown .tmp
              // may contain other/private data; retain it and report the gap.
              const match = /^(request|status|receipt)\.json\.[a-f0-9-]{36}\.tmp$/u.exec(name);
              if (depth === 0 && match) {
                try { const bytes = bytesAt(src); if (bytes.equals(bytesAt(join(path, `${match[1]}.json`)))) { include(src, target, id); continue; } } catch { /* incomplete below */ }
              }
              warn('UNATTRIBUTED_LOCAL_ITEM', id);
            }
          }
          copyDir(row.path, `local/${id}`);
        } catch (error) { warn(safeCode(error), id); if (op) operations.push({ operationId: id, status: 'unavailable' }); }
      }
      // Global owner-index crash leftovers cannot be reliably attributed to a
      // goal. Bound the scan and never copy other subjects' index contents.
      let indexCount = 0;
      for (const name of readdirSync(store.indices)) {
        if (++indexCount > MAX_LOCAL_FILES) { warn('OWNER_INDEX_SCAN_LIMIT'); break; }
        if (name.endsWith('.tmp')) warn('UNATTRIBUTED_OWNER_TEMPORARY');
        else if (/^[a-f0-9-]{36}\.json$/u.test(name)) {
          // Only inspect the thin ownership index, never another account's
          // original/body. A claim with no attributable request is incomplete.
          try { const claim = readGoalJson(join(store.indices, name));
            if (claim?.subject === subject && !discovered.has(name.slice(0, -5)) && !networkOperationTombstone(store, name.slice(0, -5))) warn('UNATTRIBUTED_OWNER_CLAIM', name.slice(0, -5));
          } catch { warn('UNATTRIBUTED_OWNER_INDEX'); }
        } else warn('UNATTRIBUTED_OWNER_INDEX');
      }
      } catch (error) { warn(safeCode(error)); }
      // Keep the original account lock until all output bytes are durable.
      // Deletion cannot commit its local tombstone between capture and output.
      return finishExport();
  });
  function finishExport() {
  // No source writes; file-lock marker is the existing owner mechanism.
  mkdirSync(output, { mode: 0o700 }); syncDir(outputParent);
  put(join(output, 'service.json'), assembled.bytes);
  for (const item of payload) {
    const parts = item.target.split('/'); let parent = output;
    for (const part of parts.slice(0, -1)) { parent = join(parent, part); try { mkdirSync(parent, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; directory(parent); } }
    put(join(output, item.target), item.bytes);
  }
  const manifest = { format: 'aidesk-goal-local-export-v1', subject, goalId, snapshot: assembled.snapshot,
    service: { path: 'service.json', bytes: assembled.bytes.length, sha256: goalHash(assembled.bytes), scopeComplete: true },
    local: { scope: 'this_subject_goal_plugin_v1_only', complete: warnings.length === 0, operations, files, warnings },
    exclusions: assembled.document.exclusions, originalDataUnchanged: true, atomicAcrossServiceAndLocal: false, deletionPerformed: false };
  put(join(output, 'manifest.json'), Buffer.from(canonicalTeachingJson(manifest) + '\n'));
  return { output, goalId, snapshot: assembled.snapshot, localComplete: warnings.length === 0, warningCount: warnings.length,
    fileCount: payload.length + 2, manifestSha256: goalHash(bytesAt(join(output, 'manifest.json'), MAX_LOCAL_BYTES)) };
  }
}

/** A bounded selection of already observed own-network versions. This is not
 * account inventory, an all-revision archive, or a fresh service snapshot.
 * No Hook store, operation original, or unselected directory item is read/copied.
 * Inputs include the original MCP account precondition and matching responses;
 * local validation cannot turn those observations into a server attestation. */
export async function exportGoalNetworkData(options) {
  needGoal(exact(options, ['subject', 'output', 'selections']), 'EXPORT_NETWORK_OPTIONS_INVALID');
  const { subject, selections } = options;
  needGoal(validGoalAccountSubject(subject), 'EXPORT_SELECTOR_INVALID');
  needGoal(Array.isArray(selections) && selections.length > 0 && selections.length <= 16, 'EXPORT_NETWORK_SELECTIONS_INVALID');
  const selected = new Set();
  function observation(pair, action) {
    needGoal(exact(pair, ['input', 'response']), 'EXPORT_NETWORK_OBSERVATION_INVALID');
    const { expectedAccountSubject, businessInput } = splitGoalMcpRequest(pair.input);
    needGoal(expectedAccountSubject === subject, 'EXPORT_NETWORK_ACCOUNT_MISMATCH');
    const input = parseGoalNetworkInput(action, businessInput);
    const { businessResult: result, account } = readGoalMcpToolResult(pair.response, subject);
    needGoal(validGoalNetworkResult(action, result, input), 'EXPORT_NETWORK_RESULT_INVALID');
    return { input, result, account };
  }
  const records = selections.map(selection => {
    needGoal(exact(selection, ['discovery', 'read']), 'EXPORT_NETWORK_SELECTION_INVALID');
    const discovery = observation(selection.discovery, 'discover'), read = observation(selection.read, 'read');
    needGoal(['own_posts', 'own_responses'].includes(discovery.input.view), 'EXPORT_NETWORK_OWN_DIRECTORY_REQUIRED');
    const kind = discovery.input.view === 'own_posts' ? 'post' : 'response';
    needGoal(read.input.view === kind && read.result.status === 'found' && read.result.receipt === null, 'EXPORT_NETWORK_OWN_FULL_READ_REQUIRED');
    const item = read.result.item, row = discovery.result.items.find(v => v.cohortId === item.cohortId && v.id === item.id);
    needGoal(row && row.postId === item.postId && row.version === item.version && row.createdAt === item.createdAt
      && row.sourceStatus === item.sourceStatus
      && row.preview === Array.from(kind === 'post' ? item.title : item.text).slice(0, 96).join(''), 'EXPORT_NETWORK_SELECTION_MISMATCH');
    const key = `${kind}/${item.cohortId}/${item.id}`;
    needGoal(!selected.has(key), 'EXPORT_NETWORK_SELECTION_DUPLICATE'); selected.add(key);
    return { directory: { view: discovery.input.view, item: row, accountCheckedAt: discovery.account.checkedAt },
      read: { input: read.input, item, accountCheckedAt: read.account.checkedAt } };
  });
  const format = 'aidesk-goal-network-selected-export-v1', scope = 'selected_own_network_versions';
  const bytes = Buffer.from(canonicalTeachingJson({ format, subject, scope, records }) + '\n');
  needGoal(bytes.length <= MAX_LOCAL_BYTES, 'EXPORT_LOCAL_LIMIT');
  needGoal(typeof options.output === 'string' && isAbsolute(options.output), 'EXPORT_PATH_REQUIRED');
  const requested = resolve(options.output), parent = realpathSync(directory(dirname(requested)));
  const output = join(parent, relative(dirname(requested), requested));
  const manifest = { format, subject, scope,
    file: { path: 'network.json', bytes: bytes.length, sha256: goalHash(bytes) }, recordCount: records.length,
    selectedVersions: records.map(({ directory: d, read: r }) => ({ kind: r.item.kind, cohortId: r.item.cohortId, id: r.item.id,
      postId: r.item.postId, version: r.item.version, contentSha256: r.item.contentSha256, status: d.item.status, sourceStatus: r.item.sourceStatus })),
    completeAccount: false, completeRevisionHistory: false, atomicSnapshot: false, hookStoreInspected: false,
    originalDataUnchanged: true, deletionPerformed: false };
  mkdirSync(output, { mode: 0o700 }); syncDir(parent);
  put(join(output, 'network.json'), bytes);
  put(join(output, 'manifest.json'), Buffer.from(canonicalTeachingJson(manifest) + '\n'));
  return { output, recordCount: records.length, fileCount: 2,
    manifestSha256: goalHash(bytesAt(join(output, 'manifest.json'), MAX_LOCAL_BYTES)) };
}
async function main() {
  const [command, ...args] = process.argv.slice(2), options = {};
  const network = command === 'export-network';
  needGoal(network ? args.length === 4 : command === 'export' && [6, 8].includes(args.length), 'EXPORT_USAGE');
  const allowed = network ? ['--subject', '--output'] : ['--subject', '--goal-id', '--data-root', '--output'];
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; needGoal(allowed.includes(key) && !Object.hasOwn(options, key), 'EXPORT_USAGE'); options[key] = args[i + 1]; }
  needGoal((network ? allowed : ['--subject', '--goal-id', '--output']).every(k => Object.hasOwn(options, k)), 'EXPORT_USAGE');
  const chunks = []; let size = 0;
  for await (const bytes of process.stdin) { size += bytes.length; needGoal(size <= GOAL_DATA_EXPORT_LIMITS.documentBytes * 4, 'EXPORT_INPUT_LIMIT'); chunks.push(bytes); }
  const input = parseTeachingJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), GOAL_DATA_EXPORT_LIMITS.documentBytes * 4);
  const result = network ? await exportGoalNetworkData({ subject: options['--subject'], output: options['--output'], selections: input })
    : await exportGoalData({ subject: options['--subject'], goalId: options['--goal-id'], dataRoot: options['--data-root'], output: options['--output'], pages: input });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: safeCode(error), advice: '导出未完成。保留源原件及已生成的部分目录，勿覆盖或删除；重新核对本人账号、选定记录及完整结果。' })); process.exitCode = 1;
});
