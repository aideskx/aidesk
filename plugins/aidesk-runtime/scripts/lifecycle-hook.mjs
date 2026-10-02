#!/usr/bin/env node
import { chmod, mkdir, open, readdir, rename, rm, lstat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isKnownTool, isWriteTool, operationId, sha256, toolFromEvent } from './lib/contract.mjs';
import { requestDigest } from './domain/contracts.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function context(message) { return { hookSpecificOutput: { hookEventName: phase, additionalContext: message } }; }
function deny(code, message) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `AI书桌新版 Hook 已停止本次调用：${code}。${message}` } };
}
function isNonEmptyString(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function boundedString(value, max = 256) { return isNonEmptyString(value, max) ? value : null; }
const TARGET_IDENTIFIER_FIELDS = ['id', 'kind', 'goalId', 'publicId', 'publicVersion', 'commentId', 'notificationId', 'familyId', 'learnerId', 'sourceId'];
function associationFromArgs(args, tool = null) {
  const target = args?.target && typeof args.target === 'object' && !Array.isArray(args.target) ? args.target : {};
  // Service acceptance references a goal through the formal v1/v2 goalRef;
  // do not search arbitrary nested request content for a cleanup association.
  const goalRef = tool === 'aidesk_goal_service_cooperate'
    && ['aidesk-goal-service-v1', 'aidesk-goal-service-v2'].includes(args?.contract)
    && args.goalRef && typeof args.goalRef === 'object' && !Array.isArray(args.goalRef) ? args.goalRef : {};
  const referenceGoalId = boundedString(goalRef.goalId, 512);
  const directGoalIds = [args?.goalId, target.goalId].map(value => boundedString(value, 512)).filter(Boolean);
  if (referenceGoalId && directGoalIds.some(value => value !== referenceGoalId)) throw new Error('goal association conflict');
  const values = {};
  for (const field of TARGET_IDENTIFIER_FIELDS) {
    const value = target[field] ?? args?.[field];
    if (field === 'publicVersion' && Number.isSafeInteger(value)) values[field] = String(value);
    else if (boundedString(value, 512)) values[field] = value;
  }
  if (!values.kind && boundedString(args?.targetKind, 128)) values.kind = args.targetKind;
  if (!values.id && boundedString(args?.targetId, 512)) values.id = args.targetId;
  const targetKind = boundedString(values.kind, 128);
  const goalId = directGoalIds[0] ?? referenceGoalId;
  // Normalize the primary object identifier so a target can be addressed by
  // --target-kind/--target-id without having to reproduce unrelated public
  // version or display metadata from the original request.
  const primaryField = ['id', 'goalId', 'publicId', 'commentId', 'notificationId', 'familyId', 'learnerId', 'sourceId']
    .find(field => boundedString(values[field], 512));
  const identity = primaryField ? { kind: targetKind, id: values[primaryField] } : null;
  return {
    goalIdSha256: goalId ? sha256(goalId) : null,
    targetSha256: identity ? sha256(identity) : null,
    targetKind,
  };
}
function projectRecord(record) {
  return {
    phase: record.phase ?? null,
    tool: record.tool ?? null,
    operationId: record.operationId ?? null,
    accountSubjectSha256: record.accountSubjectSha256 ?? null,
    requestSha256: record.requestSha256 ?? null,
    goalIdSha256: record.goalIdSha256 ?? null,
    targetSha256: record.targetSha256 ?? null,
    targetKind: record.targetKind ?? null,
    observedSessionId: record.observedSessionId ?? null,
    observedCallId: record.observedCallId ?? null,
    responseSha256: record.responseSha256 ?? null,
    responseIsError: typeof record.responseIsError === 'boolean' ? record.responseIsError : null,
    at: record.at ?? null,
  };
}
function suppliedRequestDigestMatches(args) {
  // MCP domain contracts derive the request digest from the complete write
  // body; older valid calls omit the derived field and let the service return
  // it. When a caller supplies one, validate it before recording or sending
  // the write. Operation/status reads are deliberately handled separately:
  // their requestSha256 identifies the original write, not the read request.
  if (!Object.hasOwn(args, 'requestSha256')) return true;
  return typeof args.requestSha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(args.requestSha256)
    && args.requestSha256 === requestDigest(args);
}
function operationPath(dataRoot, subject, id) {
  // Keep the user-supplied operation id out of a path unless it is a portable filename.
  // The account directory is a one-way subject hash, so records from two subjects cannot collide.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(id)) return null;
  return join(resolve(dataRoot), 'operations', sha256(subject), `${id}.jsonl`);
}
async function syncDirectory(path) {
  if (process.platform === 'win32') return;
  const handle = await open(path, (constants.O_RDONLY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function assertDirectory(path, { create = true } = {}) {
  const target = resolve(path);
  // Always validate the immediate parent, including when the target already
  // exists. Otherwise an existing directory below a parent symlink would be
  // accepted and later writes could escape the host-owned data root.
  const parent = dirname(target);
  const parentItem = await lstat(parent);
  if (parentItem.isSymbolicLink() || !parentItem.isDirectory()) throw new Error('unsafe parent directory');
  try {
    const item = await lstat(target);
    if (item.isSymbolicLink() || !item.isDirectory()) throw new Error('unsafe directory');
    await chmod(target, 0o700);
    return target;
  } catch (error) {
    if (error?.code !== 'ENOENT' || !create) throw error;
    // PLUGIN_DATA is host-owned. Never recursively create an ancestor or
    // follow a parent symlink while materializing a missing leaf.
    await mkdir(target, { recursive: false, mode: 0o700 });
    const item = await lstat(target);
    if (item.isSymbolicLink() || !item.isDirectory()) throw new Error('unsafe directory', { cause: error });
    await chmod(target, 0o700);
    await syncDirectory(parent);
    return target;
  }
}
async function appendRecoveryRecord(dataRoot, args, record) {
  const root = resolve(dataRoot);
  await assertDirectory(root, { create: true });
  const operations = join(root, 'operations');
  await assertDirectory(operations, { create: true });
  const subject = args.expectedAccountSubject;
  const subjectDir = join(operations, sha256(subject));
  await assertDirectory(subjectDir, { create: true });
  const path = operationPath(root, subject, record.operationId);
  if (!path) throw new Error('unsafe operation id');
  const lock = `${path}.lock`;
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
    const previous = await readLedgerFile(path).catch(error => {
      if (error?.code === 'ENOENT') return '';
      throw error;
    });
    const rows = previous.split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (rows.some(row => row.operationId !== record.operationId || row.accountSubjectSha256 !== record.accountSubjectSha256)) throw new Error('ledger identity conflict');
    if (rows.some(row => row.requestSha256 !== record.requestSha256)) {
      throw new Error('idempotency conflict');
    }
    if (rows.some(row => row.requestSha256 === record.requestSha256 && row.phase === record.phase)) return true;
    const file = await open(path, (constants.O_WRONLY ?? 0) | (constants.O_APPEND ?? 0) | (constants.O_CREAT ?? 0) | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      const item = await file.stat();
      if (!item.isFile()) throw new Error('unsafe ledger file');
      await file.write(`${JSON.stringify(record)}\n`, null, 'utf8');
      await file.sync();
    } finally { await file.close(); }
    await chmod(path, 0o600);
    await syncDirectory(dirname(path));
    return true;
  } finally {
    // Only the process that successfully created the lock owns it. In
    // particular, an EEXIST failure must leave another writer's lock intact.
    if (handle) {
      try { await handle.close(); } finally { await rm(lock, { force: true }); }
    }
  }
}

async function readLedgerFile(path) {
  const file = await open(path, (constants.O_RDONLY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    const item = await file.stat();
    if (!item.isFile()) throw new Error('unsafe ledger file');
    return await file.readFile('utf8');
  } finally { await file.close(); }
}

function cliOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error('invalid_arguments');
    if (token === '--confirm') { options.set(token, true); continue; }
    const value = argv[index + 1];
    if (!isNonEmptyString(value, 4096) || value.startsWith('--')) throw new Error('invalid_arguments');
    options.set(token, value);
    index += 1;
  }
  return options;
}
function option(options, name) { return options.get(name) ?? null; }
function requiredOption(options, name, max = 4096) {
  const value = option(options, name);
  if (!isNonEmptyString(value, max)) throw new Error('invalid_arguments');
  return value;
}

async function recordPostObservation(dataRoot, tool, event, args) {
  if (!isWriteTool(tool) || !isNonEmptyString(dataRoot, 4096) || !isAbsolute(dataRoot)
    || !operationId(args) || !isNonEmptyString(args.expectedAccountSubject, 512)) return 'unavailable';
  const response = event.tool_response;
  try {
    const record = {
      phase: 'PostToolUse', tool, operationId: operationId(args),
      accountSubjectSha256: sha256(args.expectedAccountSubject), requestSha256: requestDigest(args),
      ...associationFromArgs(args, tool),
      observedSessionId: isNonEmptyString(event.session_id, 512) ? sha256(event.session_id) : null,
      observedCallId: isNonEmptyString(event.tool_use_id, 512) ? sha256(event.tool_use_id) : null,
      responseSha256: response === undefined ? null : sha256(response),
      responseIsError: response === undefined ? null : response?.isError === true,
      at: new Date().toISOString(),
    };
    const recorded = await appendRecoveryRecord(dataRoot, args, record);
    return recorded === false ? 'conflict' : 'saved';
  } catch (error) {
    return ['idempotency conflict', 'ledger identity conflict', 'goal association conflict'].includes(error?.message) ? 'conflict' : 'unavailable';
  }
}
function filterFromOptions(options, { requireFilter = false } = {}) {
  const goalId = option(options, '--goal-id');
  const targetKind = option(options, '--target-kind');
  const targetId = option(options, '--target-id');
  if ((targetKind && !targetId) || (!targetKind && targetId)) throw new Error('invalid_arguments');
  if (goalId && !isNonEmptyString(goalId, 512)) throw new Error('invalid_arguments');
  if (targetKind && (!isNonEmptyString(targetKind, 128) || !isNonEmptyString(targetId, 512))) throw new Error('invalid_arguments');
  if (requireFilter && !goalId && !targetKind) throw new Error('filter_required');
  const target = targetKind ? associationFromArgs({ target: { kind: targetKind, id: targetId } }) : null;
  return {
    goalIdSha256: goalId ? sha256(goalId) : null,
    targetSha256: target?.targetSha256 ?? null,
    targetKind: targetKind ?? null,
  };
}
function matchesFilter(record, filter) {
  if (filter.goalIdSha256 && record.goalIdSha256 !== filter.goalIdSha256) return false;
  if (filter.targetSha256 && record.targetSha256 !== filter.targetSha256) return false;
  if (filter.targetKind && record.targetKind !== filter.targetKind) return false;
  return true;
}
async function ledgerFiles(dataRoot, subject) {
  const root = resolve(dataRoot);
  const operations = join(root, 'operations');
  const subjectDir = join(operations, sha256(subject));
  for (const directory of [root, operations, subjectDir]) {
    try {
      const item = await lstat(directory);
      if (item.isSymbolicLink() || !item.isDirectory()) throw new Error('unsafe_data_root');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const parent = dirname(directory);
        const parentItem = await lstat(parent).catch(() => null);
        if (!parentItem || parentItem.isSymbolicLink() || !parentItem.isDirectory()) throw new Error('unsafe_data_root', { cause: error });
        return [];
      }
      throw error;
    }
  }
  const entries = await readdir(subjectDir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.jsonl')) continue;
    const path = join(subjectDir, entry.name);
    const item = await lstat(path);
    if (item.isSymbolicLink() || !item.isFile()) throw new Error('unsafe_data_root');
    paths.push(path);
  }
  return paths.sort();
}
async function readLedgerFiles(paths) {
  const rows = [];
  for (const path of paths) {
    const text = await readLedgerFile(path);
    for (const line of text.split('\n').filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { throw new Error('ledger_corrupt'); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('ledger_corrupt');
      rows.push({ path, row });
    }
  }
  return rows;
}
async function exportSummary(options) {
  const dataRoot = requiredOption(options, '--data-root');
  const subject = requiredOption(options, '--account-subject', 512);
  const filter = filterFromOptions(options);
  const paths = await ledgerFiles(dataRoot, subject);
  const rows = await readLedgerFiles(paths);
  const selected = rows.filter(({ row }) => matchesFilter(row, filter)).map(({ row }) => projectRecord(row));
  output({
    format: 1,
    status: 'ok',
    accountSubjectSha256: sha256(subject),
    filter,
    recordCount: selected.length,
    records: selected,
    bodyStored: false,
    credentialsStored: false,
  });
}
async function cleanSummary(options) {
  if (!options.has('--confirm')) throw new Error('confirm_required');
  const dataRoot = requiredOption(options, '--data-root');
  const subject = requiredOption(options, '--account-subject', 512);
  const filter = filterFromOptions(options, { requireFilter: true });
  const paths = await ledgerFiles(dataRoot, subject);
  const rows = await readLedgerFiles(paths);
  let removed = 0;
  let remaining = 0;
  const grouped = new Map();
  for (const item of rows) {
    const list = grouped.get(item.path) ?? [];
    list.push(item.row);
    grouped.set(item.path, list);
  }
  for (const [path, records] of grouped) {
    const kept = records.filter(record => !matchesFilter(record, filter));
    removed += records.length - kept.length;
    remaining += kept.length;
    if (kept.length === records.length) continue;
    if (kept.length === 0) await rm(path);
    else {
      const temp = `${path}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temp, `${kept.map(record => JSON.stringify(record)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await chmod(temp, 0o600);
      await rename(temp, path);
    }
    await syncDirectory(dirname(path));
  }
  output({ format: 1, status: 'ok', accountSubjectSha256: sha256(subject), filter, removedRecords: removed, remainingRecords: remaining, bodyStored: false, credentialsStored: false });
}
async function maybeRunRecoveryCommand() {
  const argv = process.argv.slice(2);
  const mode = argv.includes('--export-summary') ? 'export' : argv.includes('--clean-recovery') ? 'clean' : null;
  if (!mode) return false;
  try {
    const options = cliOptions(argv.filter(value => value !== '--export-summary' && value !== '--clean-recovery'));
    if (mode === 'export') await exportSummary(options);
    else await cleanSummary(options);
  } catch (error) {
    const code = ['invalid_arguments', 'filter_required', 'confirm_required', 'unsafe_data_root', 'ledger_corrupt'].includes(error?.message)
      ? error.message : 'local_data_rights_failed';
    output({ format: 1, status: 'error', error: code });
    process.exitCode = 1;
  }
  return true;
}
if (await maybeRunRecoveryCommand()) process.exit();

const phaseIndex = process.argv.indexOf('--hook');
const phase = phaseIndex >= 0 ? process.argv[phaseIndex + 1] : null;
const input = await new Promise(resolveInput => {
  let text = '';
  let size = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    size += Buffer.byteLength(chunk);
    if (size <= MAX_INPUT_BYTES) text += chunk;
  });
  process.stdin.on('end', () => resolveInput(size <= MAX_INPUT_BYTES ? text : null));
});

let event;
if (input === null) { output(deny('event_too_large', 'Hook 输入超过 1 MiB，拒绝继续解析。')); process.exit(0); }
try { event = JSON.parse(input || '{}'); } catch { output(deny('invalid_event', 'Hook 输入不是有效 JSON。')); process.exit(0); }
const tool = toolFromEvent(event);
if (!tool || !['PreToolUse', 'PostToolUse'].includes(phase) || event.hook_event_name !== phase) { output({}); process.exit(0); }
if (!isKnownTool(tool)) { output(deny('unknown_tool', '目标工具不在新版 Plugin 的显式领域合同中。')); process.exit(0); }
const args = event.tool_input;
if (!args || typeof args !== 'object' || Array.isArray(args)) { output(deny('invalid_input', '工具输入必须是对象。')); process.exit(0); }
const write = isWriteTool(tool);
if (phase === 'PreToolUse') {
  if (write && !operationId(args)) { output(deny('operation_id_required', '写入必须携带一次性的 operationId；请沿原请求恢复，不要换号重试。')); process.exit(0); }
  if (write && !isNonEmptyString(args.contract, 256)) { output(deny('contract_required', '写入必须携带领域 contract。')); process.exit(0); }
  if (write && !isNonEmptyString(args.expectedAccountSubject, 512)) { output(deny('account_subject_required', '写入必须携带已核实的 expectedAccountSubject。')); process.exit(0); }
  if (write && !suppliedRequestDigestMatches(args)) { output(deny('request_digest_invalid', '请求摘要格式或规范化输入不一致；请沿原请求核对，不要换号重试。')); process.exit(0); }
  const dataRoot = process.env.PLUGIN_DATA;
  if (write && (!isNonEmptyString(dataRoot, 4096) || !isAbsolute(dataRoot))) { output(deny('plugin_data_unavailable', '宿主没有提供绝对路径 PLUGIN_DATA，无法建立本机恢复记录。')); process.exit(0); }
  if (write) {
    try {
      const association = associationFromArgs(args, tool);
      const record = {
        phase, tool, operationId: operationId(args),
        accountSubjectSha256: sha256(args.expectedAccountSubject),
        requestSha256: requestDigest(args),
        ...association,
        observedSessionId: isNonEmptyString(event.session_id, 512) ? sha256(event.session_id) : null,
        observedCallId: isNonEmptyString(event.tool_use_id, 512) ? sha256(event.tool_use_id) : null,
        at: new Date().toISOString(),
      };
      const recorded = await appendRecoveryRecord(dataRoot, args, record);
      if (recorded === false) process.exit(0);
    } catch (error) {
      const code = ['ledger identity conflict', 'idempotency conflict', 'unsafe operation id', 'goal association conflict'].includes(error?.message) ? 'recovery_record_conflict' : 'recovery_record_failed';
      output(deny(code, '本机恢复原件没有安全落盘，本次写入停止。')); process.exit(0);
    }
  }
  output({}); process.exit(0);
}

const response = event.tool_response;
const digest = response === undefined ? null : sha256(response);
const observation = await recordPostObservation(process.env.PLUGIN_DATA, tool, event, args);
const recovery = observation === 'saved'
  ? '已保存本机哈希观察记录'
  : observation === 'conflict'
    ? '本机观察记录冲突，保留原号并停止重试'
    : '本机观察记录未落盘，按原号对账';
if (!response || response.isError === true) {
  output(context(`AI书桌新版结果未知：${tool} 未获得成功回执（回执摘要 ${digest}）；${recovery}，先做原号对账，不换号重试。`)); process.exit(0);
}
if (observation === 'conflict') {
  output(context(`AI书桌新版 PostToolUse 回执关联冲突：${tool} 的回执摘要为 ${digest}；${recovery}，先做原号对账，不换号重试。`)); process.exit(0);
}
output(context(`AI书桌新版已观察 ${tool} 的 PostToolUse 成功回执（回执摘要 ${digest}）；${recovery}。这是宿主观察记录，不替代服务终态、宿主任务创建或成果验证。`));
