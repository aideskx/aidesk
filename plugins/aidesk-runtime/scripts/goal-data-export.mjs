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
import { assembleGoalExport, assembleGoalRelationshipExport, assembleGoalCommentExport, assembleGoalNotificationExport, assembleGoalReportExport, isErasedGoalReportExport, GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT, parseGoalDataExportInput, GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT, GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT, GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT, GOAL_DATA_EXPORT_V5_CONTRACT, GOAL_DATA_EXPORT_LIMITS } from './lib/goal-data-export-contract.mjs';
import { parseGoalNetworkInput, validGoalNetworkResult } from './lib/goal-network-contract.mjs';
import { assembleGoalNetworkReportExport, GOAL_NETWORK_REPORT_EXPORT_LIMITS, validGoalNetworkReportResult } from './lib/goal-network-report-contract.mjs';
import { withGoalStore, loadGoalOperation, ownGoalIndex, readGoalJson, goalTool, validGoalNetworkReadObservation, goalOperationTombstone, networkOperationTombstone, goalDeletionState, networkDeletionState, interactionOperationErasure, communityReportOperationErasure, notificationOperationErasure, commentOperationErasure, commentGoalDeletionState, localNetworkTarget, sameGoalValue, GOAL_PLUGIN_FORMAT, goalHash, needGoal, GoalPluginError } from './goal-plugin-request.mjs';

import { NETWORK_DELETION_DIRECTORIES, validateLocalNetworkDeletionMetadata, validLocalDeletionPlan } from './goal-data-delete.mjs';

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
// Shared byte-for-byte original copying. Consumers determine their exact scope
// and validate any stable receipt before this bounded traversal.
function copyOriginalFiles({ store, row, subject, include, warn, scan,
  receiptContracts = ['aidesk-goal-task-v1', 'aidesk-goal-network-v1', 'aidesk-goal-finalization-v1', 'aidesk-goal-community-v1', 'aidesk-goal-community-interaction-v1', 'aidesk-goal-community-comment-v1', 'aidesk-goal-community-notification-v1', 'aidesk-goal-community-report-v1'] }) {
  const id = row.entry.input.operationId;
  include(join(store.indices, `${id}.json`), `local/${id}/owner.json`, id);
  const stable = new Set(['request.json', 'status.json', 'receipt.json']);
  function copyDir(path, prefix, depth = 0) {
    directory(path);
    for (const name of readdirSync(path).sort()) {
      if (!scan()) { warn('LOCAL_SCAN_LIMIT', id); return; }
      const src = join(path, name), target = `${prefix}/${name}`, stat = lstatSync(src);
      if (depth === 0 && ['calls', 'read-observations'].includes(name)) { copyDir(src, target, 1); continue; }
      if (stat.isSymbolicLink() || !stat.isFile()) { warn('UNATTRIBUTED_LOCAL_ITEM', id); continue; }
      if (depth === 0 && stable.has(name)) {
        if (name === 'receipt.json' && !receiptContracts.includes(row.entry.input.contract)) {
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
}
/** Input pages are exact {input, response} pairs from the authenticated MCP,
 * not a hand-written operation list. The returned metadata is body-free. */
export const exportGoalData = options => exportScopedData({ ...options, target: undefined, kind: 'goal' });
export const exportGoalRelationships = options => exportScopedData({ ...options, goalId: undefined, kind: 'relationships' });
export const exportGoalComments = options => exportScopedData({ ...options, goalId: undefined, kind: 'comments' });
export const exportGoalCommunityReport = options => exportScopedData({ ...options, goalId: undefined, kind: 'communityReport' });
export const exportGoalNotifications = options => exportScopedData({ ...options, goalId: undefined, kind: 'notifications' });
async function exportScopedData({ subject, goalId, target, dataRoot, output, pages, kind }) {
  const communityReport = kind === 'communityReport', relationships = kind === 'relationships', comments = kind === 'comments', notifications = kind === 'notifications', networkScope = communityReport || relationships || comments || notifications;
  const scopeContract = communityReport ? GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT : notifications ? GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT : comments ? GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT : GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT;
  needGoal(validGoalAccountSubject(subject) && (networkScope || isUuid(goalId) && goalId === goalId.toLowerCase()), 'EXPORT_SELECTOR_INVALID');
  if (networkScope) parseGoalDataExportInput('read', { contract: scopeContract,
    target, snapshot: null, offset: 0, chunkBytes: 8192 });
  const selector = networkScope ? { target } : { goalId };
  needGoal(Array.isArray(pages) && pages.length > 0 && pages.length <= 4096, 'EXPORT_PAGES_INVALID');
  const checked = pages.map(page => {
    needGoal(page && Object.keys(page).length === 2 && page.input && page.response, 'EXPORT_PAGES_INVALID');
    const { businessResult } = readGoalMcpToolResult(page.response, subject);
    needGoal(networkScope ? page.input.contract === scopeContract && sameGoalValue(page.input.target, target) : page.input.goalId === goalId, 'EXPORT_SELECTOR_MISMATCH'); return { input: page.input, result: businessResult };
  });
  const assembled = communityReport ? assembleGoalReportExport(checked) : notifications ? assembleGoalNotificationExport(checked) : comments ? assembleGoalCommentExport(checked) : relationships ? assembleGoalRelationshipExport(checked) : assembleGoalExport(checked);
  const erasedReport = communityReport && isErasedGoalReportExport(assembled.document);
  const boundPublicId = !networkScope && assembled.document.contract === GOAL_DATA_EXPORT_V5_CONTRACT
    ? assembled.document.records.find(r => r.kind === 'community_binding')?.data.public_id : null;
  const owns = input => networkScope ? sameGoalValue(localNetworkTarget(input), target) : ownGoal(input, goalId)
    || !!boundPublicId && input?.contract === 'aidesk-goal-community-comment-v1' && input.source?.publicId === boundPublicId;
  const serviceErasedComments = new Set(assembled.document.records.filter(r => r.kind === 'community_comment_operation' && r.data.erased_at !== null).map(r => r.data.operation_id));
  const serviceErasedCommentTargets = new Set(assembled.document.records
    .filter(r => ['community_comment', 'community_comment_operation'].includes(r.kind) && r.data.erased_at !== null)
    .map(r => canonicalTeachingJson({ kind: 'community_comment', publicId: r.data.public_id, commentId: r.data.comment_id })));
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
  const expected = new Map(), collisions = new Set();
  for (const record of assembled.document.records) if (record.localOperation) {
    const original = record.localOperation;
    // Remote RPC owners use (tool, operationId), while this installed helper's
    // historical thin index has a single operationId namespace. Keep the full
    // service document; never overwrite or guess which local original is which.
    if (expected.has(original.operationId)) { collisions.add(original.operationId); warn('LOCAL_OPERATION_ID_COLLISION', original.operationId); }
    expected.set(original.operationId, original);
  }
  if (dataRoot === null) { warn('LOCAL_ROOT_NOT_PROVIDED'); for (const [id] of expected) operations.push({ operationId: id, status: 'not_inspected' }); return finishExport(); }
  return withGoalStore({ dataRoot, subject }, store => {
      if (!store) { warn('LOCAL_NAMESPACE_NOT_FOUND'); for (const [id] of expected) operations.push({ operationId: id, status: 'missing' }); return finishExport(); }
      if (erasedReport) {
        // A newly read scrubbed case is still exportable. Never inventory or
        // copy its old reason/request/receipt, even if cleanup is incomplete.
        let claim = null;
        try {
          const indexed = readGoalJson(join(store.indices, `${target.reportId}.json`), null);
          if (indexed?.subject === subject) {
            claim = ownGoalIndex(store, target.reportId);
            const original = assembled.document.records.find(r => r.kind === 'community_report_operation');
            if (claim.tool !== 'aidesk_goal_community_report_submit' || claim.requestSha256 !== original?.data.request_sha256)
              warn('ORIGINAL_SERVICE_MISMATCH', target.reportId);
          }
          {
            for (const path of [join(store.pending, target.reportId), join(store.staging, target.reportId), join(store.completed, target.reportId.slice(0, 2), target.reportId)]) {
              try { directory(path); warn(claim?.tool === 'aidesk_goal_community_report_submit' ? 'REPORT_ERASED_LOCAL_ORIGINAL_REQUIRES_CLEANUP' : 'UNATTRIBUTED_LOCAL_ITEM', target.reportId); }
              catch (error) { if (error.code !== 'ENOENT') warn(safeCode(error), target.reportId); }
            }
          }
        } catch (error) { warn(safeCode(error), target.reportId); }
        operations.push({ operationId: target.reportId, status: 'erased_service_only' });
        return finishExport();
      }
      needGoal(!(networkScope ? networkDeletionState(store, target) : goalDeletionState(store, goalId)), 'GOAL_DELETE_PENDING_OR_DELETED');
      // An observed erased original invalidates a previously captured snapshot
      // even before exact-target cleanup has a receipt. Check thin own markers
      // under the same lock, outside warning-only inventory handling, before
      // copying any bytes or creating output. Never treat this as unlink authority.
      const erasedPath = join(store.path, 'interaction-erased-operations');
      let erasedNames = [];
      try { erasedNames = readdirSync(directory(erasedPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      needGoal(erasedNames.length <= MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT');
      for (const name of erasedNames) {
        needGoal(/^[a-f0-9-]{36}\.json$/u.test(name) && isUuid(name.slice(0, -5)), 'ERASURE_MARKER_INVALID');
        const id = name.slice(0, -5), erased = interactionOperationErasure(store, id);
        needGoal(erased, 'ERASURE_MARKER_INVALID');
        const sameScope = networkScope ? sameGoalValue(erased.target, target)
          : erased.target.kind === 'goal' && erased.target.goalId === goalId;
        const original = expected.get(id);
        needGoal(!sameScope && !(original?.tool === `aidesk_goal_community_interaction_${erased.action}`
          && original.requestSha256 === erased.requestSha256), 'INTERACTION_ORIGINAL_ERASED');
      }
      const reportErasedPath = join(store.path, 'community-report-erased-operations');
      let reportErasedNames = [];
      try { reportErasedNames = readdirSync(directory(reportErasedPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      needGoal(reportErasedNames.length <= MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT');
      for (const name of reportErasedNames) {
        needGoal(/^[a-f0-9-]{36}\.json$/u.test(name) && isUuid(name.slice(0, -5)), 'ERASURE_MARKER_INVALID');
        const id = name.slice(0, -5), erased = communityReportOperationErasure(store, id);
        needGoal(erased, 'ERASURE_MARKER_INVALID');
        const original = expected.get(id);
        needGoal(!(communityReport && sameGoalValue(erased.target, target))
          && !(original?.tool === 'aidesk_goal_community_report_submit' && original.requestSha256 === erased.requestSha256), 'COMMUNITY_REPORT_ORIGINAL_ERASED');
      }
      const notificationErasedPath = join(store.path, 'notification-erased-operations');
      let notificationErasedNames = [];
      try { notificationErasedNames = readdirSync(directory(notificationErasedPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      needGoal(notificationErasedNames.length <= MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT');
      for (const name of notificationErasedNames) {
        needGoal(/^[a-f0-9-]{36}\.json$/u.test(name) && isUuid(name.slice(0, -5)), 'ERASURE_MARKER_INVALID');
        const id = name.slice(0, -5), erased = notificationOperationErasure(store, id);
        needGoal(erased, 'ERASURE_MARKER_INVALID');
        const original = expected.get(id);
        needGoal(!(notifications && sameGoalValue(erased.target, target))
          && !(original?.tool === `aidesk_goal_community_notification_${erased.action}` && original.requestSha256 === erased.requestSha256),
        'NOTIFICATION_ORIGINAL_ERASED');
      }
      const commentErasedPath = join(store.path, 'comment-erased-operations');
      let commentErasedNames = [];
      try { commentErasedNames = readdirSync(directory(commentErasedPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      needGoal(commentErasedNames.length <= MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT');
      for (const name of commentErasedNames) {
        needGoal(/^[a-f0-9-]{36}\.json$/u.test(name) && isUuid(name.slice(0, -5)), 'ERASURE_MARKER_INVALID');
        const id = name.slice(0, -5), erased = commentOperationErasure(store, id);
        needGoal(erased, 'ERASURE_MARKER_INVALID');
        const staleComment = assembled.document.records.some(record =>
          record.localOperation?.tool === 'aidesk_goal_community_comment_create' && record.localOperation.operationId === id
            && record.localOperation.requestSha256 === erased.requestSha256
          || ['community_comment', 'community_comment_operation'].includes(record.kind) && record.data.erased_at === null
            && record.data.public_id === erased.target.publicId && record.data.comment_id === erased.target.commentId);
        // RPCs have separate operation namespaces. Another tool's identical
        // UUID is neither this erased comment nor a stale comment original.
        needGoal(!(comments && sameGoalValue(erased.target, target)) && !staleComment, 'COMMENT_ORIGINAL_ERASED');
      }
      // A complete goal export may contain erased thin rows. It may not use a
      // stale live service snapshot to resurrect a locally confirmed deletion.
      for (const record of assembled.document.records) {
        if (!['community_comment', 'community_comment_operation'].includes(record.kind) || record.data.erased_at !== null) continue;
        const itemTarget = { kind: 'community_comment', publicId: record.data.public_id, commentId: record.data.comment_id };
        needGoal(!networkDeletionState(store, itemTarget), 'COMMENT_DELETE_PENDING_OR_DELETED');
        if (record.localOperation) needGoal(!networkOperationTombstone(store, record.localOperation.operationId)
          && !goalOperationTombstone(store, record.localOperation.operationId), 'COMMENT_ORIGINAL_ERASED');
      }
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
        if (collisions.has(id)) { operations.push({ operationId: id, status: 'ambiguous' }); continue; }
        const op = expected.get(id); let row;
        try {
          row = loadGoalOperation(store, id);
          if (!owns(row.entry.input)) { if (op) warn('ORIGINAL_GOAL_MISMATCH', id); continue; }
          if (row.entry.input.contract === 'aidesk-goal-community-report-v1'
            && (communityReportOperationErasure(store, id) || networkOperationTombstone(store, id)
              || networkDeletionState(store, localNetworkTarget(row.entry.input)))) {
            warn('REPORT_ERASED_LOCAL_ORIGINAL_REQUIRES_CLEANUP', id);
            operations.push({ operationId: id, status: 'erased_local_copy_omitted' }); continue;
          }
          if (row.entry.input.contract === 'aidesk-goal-community-notification-v1'
            && (notificationOperationErasure(store, id) || networkOperationTombstone(store, id)
              || networkDeletionState(store, localNetworkTarget(row.entry.input)))) {
            warn('NOTIFICATION_ERASED_LOCAL_ORIGINAL_REQUIRES_CLEANUP', id);
            operations.push({ operationId: id, status: 'erased_local_copy_omitted' }); continue;
          }
          if (row.entry.input.contract === 'aidesk-goal-community-comment-v1'
            && (serviceErasedComments.has(id) || serviceErasedCommentTargets.has(canonicalTeachingJson(localNetworkTarget(row.entry.input)))
              || commentOperationErasure(store, id) || networkOperationTombstone(store, id)
              || goalOperationTombstone(store, id) || networkDeletionState(store, localNetworkTarget(row.entry.input)) || commentGoalDeletionState(store, row.entry.input))) {
            warn('COMMENT_ERASED_LOCAL_ORIGINAL_REQUIRES_CLEANUP', id);
            operations.push({ operationId: id, status: 'erased_local_copy_omitted' }); continue;
          }
          if (!op) warn('LOCAL_OPERATION_NOT_IN_SERVICE_SNAPSHOT', id);
          else needGoal(row.entry.tool === op.tool && row.entry.requestSha256 === op.requestSha256, 'ORIGINAL_SERVICE_MISMATCH');
          const state = row.state.status;
          operations.push({ operationId: id, tool: row.entry.tool, requestSha256: row.entry.requestSha256, status: state, serviceMatched: !!op });
          if (state !== 'completed') warn('LOCAL_OUTCOME_NOT_CONFIRMED', id);
          // Stable receipt bytes must match the completed marker; hash alone
          // does not claim they are a remote backup or current grant.
          if (state === 'completed' && ['aidesk-goal-task-v1', 'aidesk-goal-network-v1', 'aidesk-goal-finalization-v1', 'aidesk-goal-community-v1', 'aidesk-goal-community-interaction-v1', 'aidesk-goal-community-comment-v1', 'aidesk-goal-community-notification-v1', 'aidesk-goal-community-report-v1'].includes(row.entry.input.contract)) {
            const receipt = parseTeachingJson(bytesAt(join(row.path, 'receipt.json')).toString('utf8'), 32768);
            if (['aidesk-goal-task-v1', 'aidesk-goal-finalization-v1', 'aidesk-goal-community-notification-v1', 'aidesk-goal-community-report-v1'].includes(row.entry.input.contract)) { const tool = goalTool(row.entry.tool); needGoal(tool.valid(tool.action, receipt, row.entry.input), 'RECEIPT_INVALID'); }
            if (row.entry.input.contract === 'aidesk-goal-community-notification-v1'
            && (notificationOperationErasure(store, id) || networkOperationTombstone(store, id)
              || networkDeletionState(store, localNetworkTarget(row.entry.input)))) {
            warn('NOTIFICATION_ERASED_LOCAL_ORIGINAL_REQUIRES_CLEANUP', id);
            operations.push({ operationId: id, status: 'erased_local_copy_omitted' }); continue;
          }
          if (row.entry.input.contract === 'aidesk-goal-community-comment-v1') needGoal(goalTool(row.entry.tool).valid('cancel', receipt, row.entry.input), 'RECEIPT_INVALID');
            if (['aidesk-goal-community-v1', 'aidesk-goal-community-interaction-v1'].includes(row.entry.input.contract)) {
              const tool = goalTool(row.entry.tool);
              needGoal(tool.valid(tool.action, { contract: row.entry.input.contract, status: 'recorded', receipt }, row.entry.input), 'RECEIPT_INVALID');
            }
            if (op && ['aidesk-goal-community-notification-v1', 'aidesk-goal-community-report-v1'].includes(row.entry.input.contract)) {
              const serviceRecord = assembled.document.records.find(record => record.localOperation?.tool === row.entry.tool
                && record.localOperation.operationId === id && record.localOperation.requestSha256 === row.entry.requestSha256);
              needGoal(serviceRecord && sameGoalValue(receipt, serviceRecord.data.receipt), 'ORIGINAL_SERVICE_MISMATCH');
            }
            const comparable = row.entry.tool === 'aidesk_goal_task_reserve' ? { ...receipt, creationDisposition: 'reconcile_only' } : receipt;
            needGoal(goalHash(canonicalTeachingJson(comparable)) === row.state.receiptSha256, 'RECEIPT_HASH_MISMATCH');
          }
          copyOriginalFiles({ store, row, subject, include, warn, scan: () => ++scanned <= MAX_LOCAL_FILES });
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
          // original/body. A missing request needs an existing validated goal
          // or network deletion marker; unexplained claims remain incomplete.
          try { const claim = readGoalJson(join(store.indices, name)), id = name.slice(0, -5);
            if (claim?.subject === subject && !discovered.has(id)) {
              const marker = goalOperationTombstone(store, id);
              if (marker) {
                const plans = directory(join(directory(join(store.path, 'delete-plans')), marker.goalId));
                const plan = readGoalJson(join(plans, name), null);
                needGoal(validLocalDeletionPlan(plan, store, marker.goalId, id) && plan.tool === marker.tool
                  && plan.requestSha256 === marker.requestSha256 && teachingRequestSha256(plan) === marker.planSha256, 'DELETE_PLAN_INVALID');
              } else if (!networkOperationTombstone(store, id)) warn('UNATTRIBUTED_OWNER_CLAIM', id);
            }
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
  const manifest = { format: communityReport ? 'aidesk-goal-community-report-local-export-v1' : notifications ? 'aidesk-goal-notification-local-export-v1' : comments ? 'aidesk-goal-comment-local-export-v1' : relationships ? 'aidesk-goal-relationship-local-export-v1' : 'aidesk-goal-local-export-v1', subject, ...selector, snapshot: assembled.snapshot,
    service: { path: 'service.json', bytes: assembled.bytes.length, sha256: goalHash(assembled.bytes), scopeComplete: true },
    local: { scope: communityReport ? 'this_subject_exact_community_report' : notifications ? 'this_subject_exact_notification_scope' : comments ? 'this_subject_community_comment' : relationships ? 'this_subject_community_relationship_generation' : 'this_subject_goal_plugin_v1_only', complete: warnings.length === 0, operations, files, warnings },
    exclusions: assembled.document.exclusions, originalDataUnchanged: true, atomicAcrossServiceAndLocal: false, deletionPerformed: false };
  put(join(output, 'manifest.json'), Buffer.from(canonicalTeachingJson(manifest) + '\n'));
  return { output, ...selector, snapshot: assembled.snapshot, localComplete: warnings.length === 0, warningCount: warnings.length,
    fileCount: payload.length + 2, manifestSha256: goalHash(bytesAt(join(output, 'manifest.json'), MAX_LOCAL_BYTES)) };
  }
}

/** Complete own report snapshot, with optional inventory of report_submit
 * originals only. Thin owner claims route reads; no other subject's original,
 * unrelated goal/network body, or operator review is opened. */
export async function exportGoalNetworkReports({ subject, dataRoot, output, pages }) {
  needGoal(validGoalAccountSubject(subject), 'EXPORT_SELECTOR_INVALID');
  needGoal(Array.isArray(pages) && pages.length > 0 && pages.length <= 4096, 'EXPORT_PAGES_INVALID');
  const checked = pages.map(page => {
    needGoal(exact(page, ['input', 'response']), 'EXPORT_PAGES_INVALID');
    const { expectedAccountSubject, businessInput } = splitGoalMcpRequest(page.input);
    needGoal(expectedAccountSubject === subject, 'EXPORT_REPORT_ACCOUNT_MISMATCH');
    const { businessResult } = readGoalMcpToolResult(page.response, subject);
    return { input: businessInput, result: businessResult };
  });
  const assembled = assembleGoalNetworkReportExport(checked);
  needGoal((dataRoot == null || typeof dataRoot === 'string' && isAbsolute(dataRoot))
    && typeof output === 'string' && isAbsolute(output), 'EXPORT_PATH_REQUIRED');
  dataRoot = dataRoot == null ? null : resolve(dataRoot); output = resolve(output);
  const outputParent = realpathSync(directory(dirname(output)));
  output = join(outputParent, relative(dirname(output), output));
  if (dataRoot !== null) {
    let sourceRoot;
    try { sourceRoot = realpathSync(dataRoot); } catch (e) { if (e.code !== 'ENOENT') throw e; sourceRoot = dataRoot; }
    needGoal(output !== sourceRoot && !output.startsWith(sourceRoot + sep) && !sourceRoot.startsWith(output + sep), 'EXPORT_PATH_OVERLAP');
  }
  const expected = new Map(assembled.document.operations.map(op => [op.operationId, op]));
  const warnings = [], operations = [], files = [], payload = []; let scanned = 0, totalBytes = 0;
  const scan = () => ++scanned <= MAX_LOCAL_FILES;
  const warn = (code, operationId = null) => {
    if (!warnings.some(w => w.code === code && w.operationId === operationId)) warnings.push({ code, operationId });
  };
  const include = (source, target, operationId) => {
    needGoal(payload.length < MAX_LOCAL_FILES, 'EXPORT_LOCAL_LIMIT');
    const bytes = bytesAt(source); totalBytes += bytes.length; needGoal(totalBytes <= MAX_LOCAL_BYTES, 'EXPORT_LOCAL_LIMIT');
    payload.push({ target, bytes }); files.push({ path: target, bytes: bytes.length, sha256: goalHash(bytes), operationId });
  };
  if (dataRoot === null) {
    warn('LOCAL_ROOT_NOT_PROVIDED'); for (const [operationId] of expected) operations.push({ operationId, status: 'not_inspected' });
    return finish();
  }
  return withGoalStore({ dataRoot, subject }, store => {
    if (!store) {
      warn('LOCAL_NAMESPACE_NOT_FOUND'); for (const [operationId] of expected) operations.push({ operationId, status: 'missing' });
      return finish();
    }
    try {
      const discovered = new Set(), candidates = new Set(expected.keys());
      for (const name of readdirSync(store.path))
        if (!['pending', 'staging', 'completed', '.lock', 'delete-intents', 'goal-tombstones', 'deleted-operations', 'delete-plans', 'delete-cancellations', ...NETWORK_DELETION_DIRECTORIES].includes(name)) warn('UNATTRIBUTED_LOCAL_ITEM');
      function idsAt(path, shards = false) {
        directory(path);
        for (const name of readdirSync(path).sort()) {
          if (!scan()) { warn('LOCAL_SCAN_LIMIT'); return; }
          if (shards) { if (!/^[a-f0-9]{2}$/u.test(name)) { warn('UNATTRIBUTED_LOCAL_ITEM'); continue; } idsAt(join(path, name)); }
          else if (isUuid(name) && name === name.toLowerCase()) discovered.add(name);
          else warn('UNATTRIBUTED_LOCAL_ITEM');
        }
      }
      idsAt(store.pending); idsAt(store.staging); idsAt(store.completed, true);
      // Inspect only immutable thin routing claims before opening originals.
      // Report originals have no goal/network deletion coverage; even an old
      // tombstone cannot stand in for a missing report original.
      for (const id of discovered) {
        try { if (ownGoalIndex(store, id).tool === 'aidesk_goal_network_report_submit') candidates.add(id); }
        catch { warn('UNATTRIBUTED_OWNER_CLAIM', id); }
      }
      for (const name of readdirSync(store.indices).sort()) {
        if (!scan()) { warn('OWNER_INDEX_SCAN_LIMIT'); break; }
        if (name.endsWith('.tmp')) { warn('UNATTRIBUTED_OWNER_TEMPORARY'); continue; }
        if (!/^[a-f0-9-]{36}\.json$/u.test(name)) { warn('UNATTRIBUTED_OWNER_INDEX'); continue; }
        try {
          const id = name.slice(0, -5), claim = readGoalJson(join(store.indices, name));
          needGoal(claim?.format === GOAL_PLUGIN_FORMAT && validGoalAccountSubject(claim.subject)
            && typeof claim.tool === 'string' && hash(claim.requestSha256), 'OWNER_INDEX_INVALID');
          if (claim.subject !== subject || claim.tool !== 'aidesk_goal_network_report_submit') continue;
          ownGoalIndex(store, id); candidates.add(id);
        } catch { warn('UNATTRIBUTED_OWNER_INDEX'); }
      }
      for (const id of candidates) {
        const op = expected.get(id);
        try {
          needGoal(ownGoalIndex(store, id).tool === 'aidesk_goal_network_report_submit', 'ORIGINAL_SERVICE_MISMATCH');
          const row = loadGoalOperation(store, id);
          needGoal(row.entry.tool === 'aidesk_goal_network_report_submit', 'ORIGINAL_SERVICE_MISMATCH');
          if (op) needGoal(row.entry.requestSha256 === op.requestSha256, 'ORIGINAL_SERVICE_MISMATCH');
          else warn('LOCAL_OPERATION_NOT_IN_SERVICE_SNAPSHOT', id);
          operations.push({ operationId: id, tool: row.entry.tool, requestSha256: row.entry.requestSha256,
            status: row.state.status, serviceMatched: !!op });
          if (row.state.status !== 'completed') warn('LOCAL_OUTCOME_NOT_CONFIRMED', id);
          if (row.state.status === 'completed') {
            const receipt = readGoalJson(join(row.path, 'receipt.json'));
            needGoal(validGoalNetworkReportResult('report', { contract: row.entry.input.contract, status: 'recorded', receipt }, row.entry.input), 'RECEIPT_INVALID');
            needGoal(teachingRequestSha256(receipt) === row.state.receiptSha256, 'RECEIPT_HASH_MISMATCH');
            if (op) needGoal(canonicalTeachingJson(receipt) === canonicalTeachingJson(op), 'ORIGINAL_SERVICE_MISMATCH');
          }
          copyOriginalFiles({ store, row, subject, include, warn, scan, receiptContracts: ['aidesk-goal-network-report-v1'] });
        } catch (error) { warn(safeCode(error), id); if (!operations.some(v => v.operationId === id)) operations.push({ operationId: id, status: 'unavailable' }); }
      }
    } catch (error) { warn(safeCode(error)); }
    return finish();
  });
  function finish() {
    // Hold the existing account lock through durable output publication.
    mkdirSync(output, { mode: 0o700 }); syncDir(outputParent);
    put(join(output, 'service.json'), assembled.bytes);
    for (const item of payload) {
      let parent = output;
      for (const part of item.target.split('/').slice(0, -1)) {
        parent = join(parent, part);
        try { mkdirSync(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; directory(parent); }
      }
      put(join(output, item.target), item.bytes);
    }
    const manifest = { format: 'aidesk-goal-network-report-local-export-v1', subject, snapshot: assembled.snapshot,
      service: { path: 'service.json', bytes: assembled.bytes.length, sha256: goalHash(assembled.bytes), scopeComplete: true },
      local: { scope: 'this_subject_report_submit_originals_only', complete: warnings.length === 0, operations, files, warnings },
      originalDataUnchanged: true, atomicAcrossServiceAndLocal: false, deletionPerformed: false };
    put(join(output, 'manifest.json'), Buffer.from(canonicalTeachingJson(manifest) + '\n'));
    return { output, snapshot: assembled.snapshot, reportCount: assembled.document.reports.length,
      localComplete: warnings.length === 0, warningCount: warnings.length, fileCount: payload.length + 2,
      manifestSha256: goalHash(bytesAt(join(output, 'manifest.json'), MAX_LOCAL_BYTES)) };
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
  const communityReport = command === 'export-community-report', network = command === 'export-network', reports = command === 'export-reports', relationships = command === 'export-relationships', comments = command === 'export-comments', notifications = command === 'export-notification', settings = command === 'export-notification-settings';
  needGoal(communityReport || notifications || settings ? [6, 8].includes(args.length) : relationships || comments ? [8, 10].includes(args.length) : network ? args.length === 4 : reports ? [4, 6].includes(args.length) : command === 'export' && [6, 8].includes(args.length), 'EXPORT_USAGE');
  const allowed = communityReport ? ['--subject', '--report-id', '--data-root', '--output'] : notifications ? ['--subject', '--notification-id', '--data-root', '--output'] : settings ? ['--subject', '--generation', '--data-root', '--output'] : comments ? ['--subject', '--public-id', '--comment-id', '--data-root', '--output'] : relationships ? ['--subject', '--public-id', '--generation', '--data-root', '--output'] : network ? ['--subject', '--output'] : reports ? ['--subject', '--data-root', '--output'] : ['--subject', '--goal-id', '--data-root', '--output'];
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; needGoal(allowed.includes(key) && !Object.hasOwn(options, key), 'EXPORT_USAGE'); options[key] = args[i + 1]; }
  needGoal((communityReport ? ['--subject', '--report-id', '--output'] : notifications ? ['--subject', '--notification-id', '--output'] : settings ? ['--subject', '--generation', '--output'] : comments ? ['--subject', '--public-id', '--comment-id', '--output'] : relationships ? ['--subject', '--public-id', '--generation', '--output'] : network || reports ? ['--subject', '--output'] : ['--subject', '--goal-id', '--output']).every(k => Object.hasOwn(options, k)), 'EXPORT_USAGE');
  const inputLimit = (reports ? GOAL_NETWORK_REPORT_EXPORT_LIMITS : GOAL_DATA_EXPORT_LIMITS).documentBytes * 4;
  const chunks = []; let size = 0;
  for await (const bytes of process.stdin) { size += bytes.length; needGoal(size <= inputLimit, 'EXPORT_INPUT_LIMIT'); chunks.push(bytes); }
  const input = parseTeachingJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), inputLimit);
  const result = communityReport ? await exportGoalCommunityReport({ subject: options['--subject'], target: { kind: 'community_report', reportId: options['--report-id'] }, dataRoot: options['--data-root'], output: options['--output'], pages: input })
    : notifications || settings ? await exportGoalNotifications({ subject: options['--subject'], target: notifications ? { kind: 'community_notification', notificationId: options['--notification-id'] } : { kind: 'community_notification_settings', generation: /^[1-9][0-9]*$/u.test(options['--generation']) ? Number(options['--generation']) : null }, dataRoot: options['--data-root'], output: options['--output'], pages: input })
    : comments ? await exportGoalComments({ subject: options['--subject'], target: { kind: 'community_comment', publicId: options['--public-id'], commentId: options['--comment-id'] }, dataRoot: options['--data-root'], output: options['--output'], pages: input })
    : relationships ? await exportGoalRelationships({ subject: options['--subject'], target: { kind: 'community_relationships', publicId: options['--public-id'], generation: Number(options['--generation']) }, dataRoot: options['--data-root'], output: options['--output'], pages: input })
    : reports ? await exportGoalNetworkReports({ subject: options['--subject'], dataRoot: options['--data-root'], output: options['--output'], pages: input })
    : network ? await exportGoalNetworkData({ subject: options['--subject'], output: options['--output'], selections: input })
    : await exportGoalData({ subject: options['--subject'], goalId: options['--goal-id'], dataRoot: options['--data-root'], output: options['--output'], pages: input });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ error: safeCode(error), advice: '导出未完成。保留源原件及已生成的部分目录，勿覆盖或删除；重新核对本人账号、选定记录及完整结果。' })); process.exitCode = 1;
});
