import { goalDataExportToolAction, parseGoalDataExportInput, validGoalDataExportResult } from './lib/goal-data-export-contract.mjs';
import { GOAL_NETWORK_DELETE_CONTRACT } from './lib/goal-network-delete-contract.mjs';
import { GOAL_DATA_DELETE_CONTRACT } from './lib/goal-data-delete-contract.mjs';
import { completeLocalGoalDeletion, recordLocalGoalDeletion, recordLocalGoalCancellation, completeLocalNetworkDeletion, recordLocalNetworkDeletion, recordLocalNetworkCancellation } from './goal-data-delete.mjs';
/** Minimal same-Plugin mechanical goal seam. No prompt/Stop capture, teaching
 * selection, mode, execution lock, OAuth state or host-history access. Session
 * and tool-use identifiers correlate observed calls only; they prove neither
 * native task creation, child-task identity nor a person's authorization.
 * This module is not active until the candidate explicitly installs its matcher.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTeachingJson, teachingRequestSha256 } from './lib/teaching-business-contract.mjs';
import { splitGoalMcpRequest, readGoalMcpToolResult } from './lib/goal-mcp-transport.mjs';
import { GOAL_PLUGIN_LIMITS, GoalPluginError, needGoal, sameGoalValue, goalTool, isGoalWrite, goalMayRepeatRead, recordGoalNetworkReadObservation, withGoalStore, opaqueGoalId,
  assertGoalServiceOperation, loadGoalOperation, stageGoalRequest, reserveGoalCall, matchGoalCall, markGoalUnknown, completeGoalOperation, readGoalStdin,
  localGoalId, localNetworkTarget, networkDeletionState, networkDeletionIntent, networkDeletionCancellation, networkOperationTombstone, goalDeletionState, goalDeletionIntent, goalDeletionCancellation, goalOperationTombstone } from './goal-plugin-request.mjs';

const toolName = event => /^mcp__aidesk[_-]authority__(aidesk_goal_(?:data_export|data_delete(?:_preview|_operation|_cancel)?|network_delete(?:_preview|_operation|_cancel)?|draft_(?:save|read|operation)|service_(?:cooperate|operation)|task_(?:reserve|record|read|operation)|network_(?:publish|discover|read|adopt|respond|withdraw|operation)|network_scope_(?:invite|request|accept|leave|read|operation)|network_report_(?:submit|status|operation|export)))$/u.exec(event?.tool_name ?? '')?.[1];
const localAvailability = code => code === 'BUSY' || code.startsWith('LOCK_') || code.startsWith('PLUGIN_DATA_') || code === 'LEGACY_LOCK_REQUIRES_QUIESCENCE'
  ? '本机书桌恢复记录当前不可用；原生 Codex 工作可以继续。'
  : '其他目标和原生 Codex 工作可以继续。';
const deny = (code, recovery, stage) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: `AI书桌本次目标调用未获本机放行（${code}${stage ? '；阶段 ' + stage : ''}）。保留已有原号并核对；不要换号重写。${localAvailability(code)}`,
  ...(recovery ? { additionalContext: recovery } : {}) } });
const notice = (code, stage) => ({ hookSpecificOutput: { hookEventName: 'PostToolUse',
  additionalContext: `AI书桌原请求恢复状态：${code}${stage ? '；阶段 ' + stage : ''}。未核实的调用不能报为已保存或已取消；沿原号和摘要对账，不重复 prepare。${localAvailability(code)}` } });
const observedSessionContext = event => opaqueGoalId(event.session_id)
  ? ` 本次 Hook 直接观察的字段：${JSON.stringify({ observedHostSessionId: event.session_id })}。这只是 event.session_id，不等于已核实的根任务、子任务或子代理身份；仅在该宿主真实验证其与可见任务 ID 的映射后使用，不推断 hostId。` : '';
function rowForOperation(store, id) {
  try { return loadGoalOperation(store, id); }
  catch (error) { if (error instanceof GoalPluginError && ['ORIGINAL_NOT_FOUND', 'ORIGINAL_NOT_READY'].includes(error.code)) return null; throw error; }
}
const isDeletion = tool => [GOAL_DATA_DELETE_CONTRACT, GOAL_NETWORK_DELETE_CONTRACT].includes(tool.contract);
function deletionOwner(contract) {
  return contract === GOAL_NETWORK_DELETE_CONTRACT
    ? { key: input => input.target, intent: networkDeletionIntent, state: networkDeletionState, cancellation: networkDeletionCancellation,
      record: recordLocalNetworkDeletion, cancel: recordLocalNetworkCancellation, complete: completeLocalNetworkDeletion, tool: 'aidesk_goal_network_delete', label: '本人网络内容' }
    : { key: input => input.goalId, intent: goalDeletionIntent, state: goalDeletionState, cancellation: goalDeletionCancellation,
      record: recordLocalGoalDeletion, cancel: recordLocalGoalCancellation, complete: completeLocalGoalDeletion, tool: 'aidesk_goal_data_delete', label: '目标' };
}
function deletionReadNotice(store, receipt, subject) {
  const owner = deletionOwner(receipt.contract);
  if (receipt.status === 'cancelled') return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
    `服务已确认此删除原号取消，迟到的同号删除不可再执行。本机意图恢复：${JSON.stringify(owner.cancel(store, receipt))}。取消不恢复任何已删除目标，其他删除意图保持。` } };
  owner.record(store, receipt);
  const result = owner.intent(store, owner.key(receipt)) ? owner.complete(store, receipt)
    : { ...(receipt.target ? { target: receipt.target } : { goalId: receipt.goalId }), complete: false, removedFiles: 0, warnings: [{ code: 'LOCAL_CLEANUP_REQUIRES_EXPLICIT_REQUEST' }] };
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
    `服务已确认删除此${owner.label}；本次实际恢复根：${JSON.stringify({ dataRoot: store?.dataRoot ?? null, expectedAccountSubject: subject })}；本机清理状态：${JSON.stringify(result)}。只读查询仅在已有本机删除意图时续清；否则须沿用户明确删除范围调用 cleanup helper。独立导出、引用文件和其他设备不在本机清理范围。` } };
}
export async function processGoalPluginEvent(event, { dataRoot = process.env.PLUGIN_DATA, now = Date.now() } = {}) {
  // Ignore unrelated hooks before inspecting their input or any local directory.
  const name = toolName(event), phase = event?.hook_event_name;
  if (!name || !['PreToolUse', 'PostToolUse'].includes(phase)) return {};
  let recovery, stage = 'request_validation';
  try {
    if (goalDataExportToolAction(name)) {
      const { expectedAccountSubject: subject, businessInput } = splitGoalMcpRequest(event.tool_input);
      const input = parseGoalDataExportInput('read', businessInput);
      if (phase === 'PreToolUse') return {};
      if (event.tool_response?.isError === true) return notice('READ_NOT_CONFIRMED');
      const { businessResult } = readGoalMcpToolResult(event.tool_response, subject);
      needGoal(validGoalDataExportResult('read', businessResult, input), 'RESULT_INVALID');
      return await withGoalStore({ dataRoot, subject }, store => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
        `本人目标导出分段已核；须收齐同一 snapshot 并校验整体摘要后才可导出。本次实际恢复根观察：${JSON.stringify({ dataRoot: store?.dataRoot ?? null, expectedAccountSubject: subject, goalId: input.goalId })}。无本机原件不等于远端没有数据。` + observedSessionContext(event) } }));
    }
    const tool = goalTool(name), { expectedAccountSubject: subject, businessInput } = splitGoalMcpRequest(event.tool_input);
    const input = tool.parse(tool.action, businessInput), write = isGoalWrite(tool, input);
    if (isDeletion(tool) && tool.action === 'cancel') return await withGoalStore({ dataRoot, subject }, store => {
      const owner = deletionOwner(tool.contract), row = rowForOperation(store, input.operationId), intent = owner.intent(store, owner.key(input));
      if (row) needGoal(row.entry.tool === owner.tool && sameGoalValue(row.entry.input, input), 'DELETE_ORIGINAL_MISMATCH');
      if (phase === 'PreToolUse') {
        needGoal(row || intent && sameGoalValue(intent.input, input), 'DELETE_ORIGINAL_REQUIRED');
        needGoal(!owner.cancellation(store, input.operationId), 'DELETE_OPERATION_CANCELLED');
        needGoal(owner.state(store, owner.key(input))?.status !== 'deleted', 'GOAL_DELETED');
        // Cancellation is correlated by the immutable original and complete
        // account/op/hash receipt. A full write-call log must not block this
        // terminal recovery path, which carries no goal content.
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext:
          '本次仅请求服务为同一删除原号建立取消终态；确认取消前仍保留本机删除意图，不恢复或重写目标。' } };
      }
      if (event.tool_response?.isError === true) return notice('CANCELLATION_NOT_CONFIRMED');
      const { businessResult } = readGoalMcpToolResult(event.tool_response, subject);
      needGoal(tool.valid('cancel', businessResult, input), 'RESULT_INVALID');
      return deletionReadNotice(store, businessResult, subject);
    });
    if (phase === 'PreToolUse' && !write) {
      if (name === 'aidesk_goal_service_operation' && dataRoot !== undefined) await withGoalStore({ dataRoot, subject }, store => assertGoalServiceOperation(store, input));
      return {};
    }
    // Reads have no local state projection. Their service-side precondition and
    // matching response metadata still protect the account boundary.
    if (!write && tool.action !== 'operation') {
      stage = 'reply_validation';
      if (event.tool_response?.isError === true) return notice('READ_NOT_CONFIRMED');
      const { businessResult } = readGoalMcpToolResult(event.tool_response, subject);
      needGoal(tool.valid(tool.action, businessResult, input), 'RESULT_INVALID');
      if (name === 'aidesk_goal_network_report_export') return await withGoalStore({ dataRoot, subject }, store => ({ hookSpecificOutput: {
        hookEventName: 'PostToolUse', additionalContext: `本人举报导出分段已核；须收齐同一 snapshot 并校验整体摘要。本次实际恢复根观察：${JSON.stringify({ dataRoot: store?.dataRoot ?? null, expectedAccountSubject: subject })}。服务快照与本机未决原件分别核对。` + observedSessionContext(event),
      } }));
      if (isDeletion(tool) && businessResult.status === 'deleted') {
        return await withGoalStore({ dataRoot, subject }, store => deletionReadNotice(store, businessResult.receipt, subject));
      }
      const observed = observedSessionContext(event);
      return observed ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: observed } } : {};
    }
    stage = 'local_store';
    return await withGoalStore({ dataRoot, subject, create: phase === 'PreToolUse' && write }, store => {
      if (name === 'aidesk_goal_service_operation') assertGoalServiceOperation(store, input);
      if (phase === 'PostToolUse' && !isDeletion(tool)) {
        // A late response must never rehydrate a deleted original, even after
        // its request/call files were already removed by an earlier Post.
        const deleted = write ? goalDeletionState(store, localGoalId(input)) ?? networkDeletionState(store, localNetworkTarget(input))
          : goalOperationTombstone(store, input.operationId) ?? networkOperationTombstone(store, input.operationId);
        if (deleted?.status === 'deleted' || deleted?.receipt) return notice('GOAL_DELETED_LOCAL_REPLAY_BLOCKED');
      }
      if (store && write && phase === 'PreToolUse') recovery = `AI书桌本次 Hook 实际观察的本机恢复根及调用参数摘要：${JSON.stringify({ dataRoot: store.dataRoot, expectedAccountSubject: subject,
        operationId: input.operationId, requestSha256: teachingRequestSha256(input) })}。恢复 helper 的 --data-root 仅使用此实际位置；这不是远端备份或已派发证明。保留原号，不重复 prepare。`;
      stage = phase === 'PreToolUse' ? 'original_prewrite' : 'original_lookup';
      const row = write ? phase === 'PreToolUse' ? stageGoalRequest(store, { tool: name, input, now })
        : isDeletion(tool) ? rowForOperation(store, input.operationId) : loadGoalOperation(store, input.operationId) : rowForOperation(store, input.operationId);
      if (row) {
        const originalTool = goalTool(row.entry.tool);
        needGoal(write ? row.entry.tool === name && sameGoalValue(row.entry.input, input)
          : originalTool.operationTool === name && row.entry.requestSha256 === input.requestSha256
            && (name !== 'aidesk_goal_service_operation' || row.entry.input.contract === input.contract), 'ORIGINAL_MISMATCH');
      }
      stage = 'call_correlation';
      const call = { sessionId: event.session_id, toolUseId: event.tool_use_id, tool: name, input: event.tool_input, now };
      if (phase === 'PreToolUse') {
        needGoal(row.state.status !== 'completed' || goalMayRepeatRead(tool, input), 'ALREADY_COMPLETED');
        reserveGoalCall(row, call);
        // Unknown means a durable preparation to release this call, not proof
        // that the host dispatched it. A missing Post event proves no outcome.
        markGoalUnknown(row, now);
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: recovery + observedSessionContext(event) } };
      }
      if (write && !(isDeletion(tool) && deletionOwner(tool.contract).state(store, deletionOwner(tool.contract).key(input))?.status === 'deleted')) matchGoalCall(row, call);
      // Even account_changed proves only this call did not enter business code;
      // it cannot cancel an earlier in-flight attempt with this original ID.
      if (event.tool_response?.isError === true) return notice('OUTCOME_NOT_CONFIRMED');
      stage = 'reply_validation';
      const { businessResult } = readGoalMcpToolResult(event.tool_response, subject);
      needGoal(tool.valid(tool.action, businessResult, input), 'RESULT_INVALID');
      if (tool.action === 'operation' && businessResult.status === 'not_found') {
        // The account, original tool and digest were matched above. Expose only
        // that original's location; this read neither stages nor dispatches it.
        if (tool.contract === GOAL_NETWORK_DELETE_CONTRACT && row) return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
          `NOT_FOUND_IS_NOT_TERMINAL：原号 not_found 不是终态，不能据此重派。本次已匹配本机原件的恢复位置：${JSON.stringify({ dataRoot: store.dataRoot,
            expectedAccountSubject: subject, target: row.entry.input.target, operationId: input.operationId, requestSha256: input.requestSha256 })}。此位置不证明此前 Pre 已执行或调用已派发，也不提供重派许可；确需取消时沿原 helper 的 cancel 核同号原件，只有真实取消回执才解除对应意图。` + observedSessionContext(event) } };
        const goalId = localGoalId(row?.entry.input);
        return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `NOT_FOUND_IS_NOT_TERMINAL：原号 not_found 不是终态，不能据此重派。${goalId
          ? `本机原件对应 goalId=${goalId}；先以 aidesk_goal_data_delete_preview 核该目标是否已有服务墓碑。` : '缺少可归属目标原件时保留未知状态。'}` } };
      }
      if (goalMayRepeatRead(tool, input) && businessResult.status === 'not_found') return notice('READ_NOT_FOUND_IS_NOT_TERMINAL');
      const receipt = write ? businessResult : businessResult.receipt;
      if (isDeletion(tool) && !write) return deletionReadNotice(store, receipt, subject);
      if (isDeletion(tool)) { const owner = deletionOwner(tool.contract); return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
        `服务已确认删除此${owner.label}；本次实际恢复根：${JSON.stringify({ dataRoot: store?.dataRoot ?? null, expectedAccountSubject: subject })}；本机清理结果：${JSON.stringify(owner.complete(store, receipt))}。未清理项保持原样，可沿同一回执再次清理；独立导出、引用文件和其他设备不在本机清理范围。` } }; }
      const wasCompleted = row?.state.status === 'completed';
      stage = 'local_completion';
      if (row) completeGoalOperation(store, row, receipt, now);
      if (row && goalMayRepeatRead(tool, input)) {
        recordGoalNetworkReadObservation(row, businessResult, call, now);
        return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
          (businessResult.receipt === null ? 'AI书桌本次实际读取已核对；本次没有正式受理回执，不宣称新试用起算。'
            : 'AI书桌本次实际正文读取及受理回执已分别核对；原号查询只能恢复受理元数据，不能代替正文回读。') + observedSessionContext(event) } };
      }
      if (tool.contract === 'aidesk-goal-network-v1' && tool.action === 'operation') return { hookSpecificOutput: { hookEventName: 'PostToolUse',
        additionalContext: 'AI书桌只按原号核对了受理元数据，未读取或恢复分享正文。需要正文时沿准确原读取在服务当前权限下重读；撤回或撤权后不可从本机回执恢复正文。' } };
      if (tool.contract === 'aidesk-goal-network-report-v1' && tool.action === 'operation') return { hookSpecificOutput: { hookEventName: 'PostToolUse',
        additionalContext: '举报原号回执已核对，只证明当时受理；用举报 status 查询当前处理状态。受理或结案不表示已删文、封号或恢复正文权限。' } };
      if (tool.contract === 'aidesk-goal-network-scope-v1' && tool.action === 'operation') return { hookSpecificOutput: { hookEventName: 'PostToolUse',
        additionalContext: '共享范围原号回执已核对；它只证明当时的操作。当前成员状态和内容权限须用 scope_read 与 network_discover 重新读取，旧回执不重新加入或开放内容。' } };
      if (receipt.contract === 'aidesk-goal-task-v1' && receipt.action === 'reserve'
        && (tool.action === 'operation' || wasCompleted || receipt.creationDisposition !== 'fresh')) {
        return { hookSpecificOutput: { hookEventName: 'PostToolUse',
          additionalContext: 'AI书桌已按原号核对创建原件。本次恢复、重复或迟到回执不提供再次创建许可；即使保留的首次原回执含 fresh，也只作历史证据。沿已有宿主任务或创建未知状态核对，不换号重建。' } };
      }
      // The verified receipt is associated only with its original account.
      // There is intentionally no mutable global/current-desk projection.
      // Expose the actual location only after an existing original has passed
      // receipt validation and durable completion. A remote success alone (or
      // a missing local row) is not evidence of a recoverable local original.
      return row ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
        `AI书桌本次回执已核对并完成本机原件归档：${JSON.stringify({ dataRoot: store.dataRoot,
          operationId: row.entry.input.operationId, requestSha256: row.entry.requestSha256, localState: 'completed' })}。恢复 helper 的 --data-root 仅使用此实际位置；这只是本机原件完成记录，不是材料正文、完整回执或跨设备备份。保留原号，不重复 prepare。` + observedSessionContext(event) } } : {};
    });
  } catch (error) {
    const code = error instanceof GoalPluginError ? error.code : 'LOCAL_OR_TRANSPORT_UNVERIFIED';
    return phase === 'PreToolUse' ? deny(code, recovery, stage) : notice(code, stage);
  }
}
async function main() {
  const phase = process.argv[3];
  needGoal(process.argv.length === 4 && process.argv[2] === '--hook' && ['PreToolUse', 'PostToolUse'].includes(phase), 'USAGE');
  const event = parseTeachingJson(await readGoalStdin(), GOAL_PLUGIN_LIMITS.inputBytes);
  needGoal(event.hook_event_name === phase, 'EVENT_MISMATCH');
  console.log(JSON.stringify(await processGoalPluginEvent(event)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.log(JSON.stringify(process.argv[3] === 'PreToolUse' ? deny('INVALID_HOOK_INPUT') : notice('INVALID_HOOK_INPUT')));
});
