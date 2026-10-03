#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { isKnownTool, isWriteTool, operationId, sha256, toolFromEvent } from './lib/contract.mjs';
import { requestDigest } from './domain/contracts.mjs';
import { parseGoalTaskInput, parseGoalResultInput, splitGoalMcpRequest } from './domain/host-task-authority.generated.mjs';
import { observeReserveHook } from './lib/host-task-context.mjs';
import { registerHostDataBinding } from './lib/host-data-binding.mjs';
import { associationFromArgs, appendRecoveryRecord, readRecoveryPre, exportRecoveryLedger, cleanRecoveryLedger } from './lib/recovery-ledger.mjs';
import { exportHostTaskMetadataForSubject, cleanHostTaskMetadata, observeHostGoalDeletion } from './lib/host-task-data-rights.mjs';
import { observeTaskAccessHook } from './lib/host-task-access.mjs';
import { observeDataExportHook } from './lib/host-data-access.mjs';

const MAX_INPUT_BYTES = 1024 * 1024;

// Binding availability only enables the separate local owner. Registration
// failure never changes an otherwise valid remote read or business result.
async function registerLocalOwnerBinding() {
  try { await registerHostDataBinding(); } catch { /* Local owner remains unavailable. */ }
}

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function context(message) { return { hookSpecificOutput: { hookEventName: phase, additionalContext: message } }; }
function deny(code, message) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `AI书桌新版 Hook 已停止本次调用：${code}。${message}` } };
}
function isNonEmptyString(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
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
  if (!isWriteTool(tool)) return 'not_applicable';
  if (!isNonEmptyString(dataRoot, 4096) || !isAbsolute(dataRoot)
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
async function exportSummary(options) {
  const dataRoot = requiredOption(options, '--data-root');
  const subject = requiredOption(options, '--account-subject', 512);
  const filter = filterFromOptions(options);
  const ledger = await exportRecoveryLedger(dataRoot, { accountSubjectSha256: sha256(subject), ...filter });
  const targetGoal = filter.targetKind === 'goal' ? sha256(option(options, '--target-id')) : null;
  const goal = filter.targetKind === null ? filter.goalIdSha256 : targetGoal && (!filter.goalIdSha256 || filter.goalIdSha256 === targetGoal) ? targetGoal : null;
  const hostTaskMetadata = filter.targetKind === null || goal ? await exportHostTaskMetadataForSubject(await realpath(resolve(dataRoot)), { accountSubjectSha256: sha256(subject), goalIdSha256: goal }) : [];
  output({ ...ledger, hostTaskMetadata });
}
async function cleanSummary(options) {
  if (!options.has('--confirm')) throw new Error('confirm_required');
  const dataRoot = requiredOption(options, '--data-root');
  const subject = requiredOption(options, '--account-subject', 512);
  const filter = filterFromOptions(options, { requireFilter: true });
  const scope = { accountSubjectSha256: sha256(subject), ...filter };
  const targetGoal = filter.targetKind === 'goal' ? sha256(option(options, '--target-id')) : null;
  const goal = filter.targetKind === null ? filter.goalIdSha256 : targetGoal && (!filter.goalIdSha256 || filter.goalIdSha256 === targetGoal) ? targetGoal : null;
  if (!goal) { output(await cleanRecoveryLedger(dataRoot, scope)); return; }
  await exportRecoveryLedger(dataRoot, scope);
  const result = await cleanHostTaskMetadata(await realpath(resolve(dataRoot)), { accountSubjectSha256: scope.accountSubjectSha256, goalIdSha256: goal },
    { confirm: true, ledgerFilter: { targetSha256: filter.targetSha256, targetKind: filter.targetKind } });
  const { localLedger, ...hostTaskMetadata } = result; output({ ...localLedger, hostTaskMetadata });
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
// Read observation never denies the authority call or changes its result.
// Only the separate local task owner can consume a fresh access witness.
const accessObservation = await observeTaskAccessHook(process.env.PLUGIN_DATA, event);
const deletionWitness = await observeHostGoalDeletion(process.env.PLUGIN_DATA, event, {
  readPreRecord: () => readRecoveryPre(process.env.PLUGIN_DATA, args),
});
const dataExportObservation = await observeDataExportHook(process.env.PLUGIN_DATA, event);

if (phase === 'PreToolUse') {
  if (write && !operationId(args)) { output(deny('operation_id_required', '写入必须携带一次性的 operationId；请沿原请求恢复，不要换号重试。')); process.exit(0); }
  if (write && !isNonEmptyString(args.contract, 256)) { output(deny('contract_required', '写入必须携带领域 contract。')); process.exit(0); }
  if (write && !isNonEmptyString(args.expectedAccountSubject, 512)) { output(deny('account_subject_required', '写入必须携带已核实的 expectedAccountSubject。')); process.exit(0); }
  if (write && !suppliedRequestDigestMatches(args)) { output(deny('request_digest_invalid', '请求摘要格式或规范化输入不一致；请沿原请求核对，不要换号重试。')); process.exit(0); }
  const taskAction = tool === 'aidesk_goal_task_record' ? 'record' : tool === 'aidesk_goal_task_reserve' ? 'reserve' : null;
  const resultAction = tool === 'aidesk_goal_result_record' ? 'record' : tool === 'aidesk_goal_result_correct' ? 'correct' : null;
  if (taskAction || resultAction) {
    // Reuse the authority parser before an invalid request acquires an immutable
    // recovery digest. Post must still observe already-sent originals, including
    // requests rejected by an older caller or the service.
    try {
      const { businessInput } = splitGoalMcpRequest(args);
      if (taskAction) parseGoalTaskInput(taskAction, businessInput);
      else parseGoalResultInput(resultAction, businessInput);
    } catch {
      output(deny(taskAction ? 'task_request_invalid' : 'result_request_invalid', '任务或成果请求未通过领域参数校验，本次未派发，也未新增恢复原件。请核对字段、UTF-8字节限制及文本格式；已有原号的请求内容仍不可修改。')); process.exit(0);
    }
  }
  const dataRoot = process.env.PLUGIN_DATA;
  if (write && (!isNonEmptyString(dataRoot, 4096) || !isAbsolute(dataRoot))) { output(deny('plugin_data_unavailable', '宿主没有提供绝对路径 PLUGIN_DATA，无法建立本机恢复记录。')); process.exit(0); }
  await registerLocalOwnerBinding();
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
      const host = await observeReserveHook(dataRoot, event, {
        observedAt: record.at,
        appendPreRecord: extra => appendRecoveryRecord(dataRoot, args, { ...record, ...extra }, { scopeHeld: true }),
      });
      if (host.status === 'rejected') {
        output(deny(`host_task_${host.error}`, '本次独立任务上下文未绑定真实 Pre 原件；保留原号，不能补写旧记录或换号创建。')); process.exit(0);
      }
      if (host.status === 'not_applicable') await appendRecoveryRecord(dataRoot, args, record);
    } catch (error) {
      const code = ['ledger identity conflict', 'idempotency conflict', 'unsafe operation id', 'goal association conflict'].includes(error?.message) ? 'recovery_record_conflict' : 'recovery_record_failed';
      output(deny(code, '本机恢复原件没有安全落盘，本次写入停止。')); process.exit(0);
    }
  }
  const readNotices = [];
  if (accessObservation.status === 'rejected') readNotices.push(`AI书桌本机任务访问见证未建立：${accessObservation.error}。当前读取仍可继续；本机接续需重新核对，不能借此创建其他任务。`);
  if (dataExportObservation.status === 'rejected') readNotices.push(`AI书桌本机导出许可未建立：${dataExportObservation.error}。当前读取仍可继续；先重新准备并读取，不能把旧回执当导出许可。`);
  output(readNotices.length ? context(readNotices.join('\n')) : {}); process.exit(0);
}

await registerLocalOwnerBinding();
const response = event.tool_response;
const digest = response === undefined ? null : sha256(response);
const observation = await recordPostObservation(process.env.PLUGIN_DATA, tool, event, args);
const hostWitness = await observeReserveHook(process.env.PLUGIN_DATA, event, {
  readPreRecord: () => readRecoveryPre(process.env.PLUGIN_DATA, args),
});
// A deleted preview can establish both independent read and cleanup rights.
// Preserve both references in the real Hook output instead of hiding one.
const dataNotices = [];
if (deletionWitness.status === 'deletion_witness_saved') dataNotices.push(`AI书桌已核实本次云端目标删除。需要清理本机任务元数据时沿 scopeId=${deletionWitness.scopeId}、witnessId=${deletionWitness.witnessId} 的同一见证；宿主聊天、工作目录成果和独立导出仍保留。本机清理尚未执行。`);
if (dataExportObservation.status === 'export_witness_saved') dataNotices.push(`AI书桌已核实本次本机元数据导出范围。使用 scopeId=${dataExportObservation.scopeId}、accessId=${dataExportObservation.accessId} 的本次导出许可；许可于 ${dataExportObservation.expiresAt} 到期且只能消费一次。它不授予任务创建、运行、恢复或删除权限。`);
else if (dataExportObservation.status === 'rejected') dataNotices.push(`AI书桌本机导出许可未建立：${dataExportObservation.error}。原读取结果不因此改变；先重新准备并读取，不复用旧回执。`);
if (dataNotices.length) { output(context(dataNotices.join('\n'))); process.exit(0); }
if (accessObservation.status === 'rejected' || accessObservation.status === 'witness_saved') {
  output(context(accessObservation.status === 'witness_saved'
    ? 'AI书桌已将此次已认证任务快照绑定到本次本机访问；它不证明宿主运行状态或目标完成，也不授予再次创建许可。'
    : `AI书桌本机任务访问见证未建立：${accessObservation.error}。原读取结果不因此改变；不要重放接续或创建其他任务。`)); process.exit(0);
}
if (hostWitness.status === 'rejected') {
  output(context(`AI书桌本机任务见证未建立：${hostWitness.error}。服务 reserve 的实际结果不因此改变；保留原号对账，不把旧 Pre、重复回执或模型说明当创建许可。`)); process.exit(0);
}
if (observation === 'not_applicable') {
  const result = !response || response.isError === true
    ? '未获得成功读取回执；保留准确对象与已有原号，不能据此重发写入'
    : '已观察成功读取回执；按实际返回的状态和范围使用';
  output(context(`AI书桌新版 ${tool} ${result}（回执摘要 ${digest}）。本次只读调用不写入操作恢复账本；专用访问、导出或删除许可仍须各自的真实见证。`)); process.exit(0);
}
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
