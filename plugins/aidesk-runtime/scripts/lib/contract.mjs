import { createHash } from 'node:crypto';

export const WRITE_TOOLS = new Set([
  'aidesk_goal_draft_save', 'aidesk_goal_service_cooperate',
  'aidesk_goal_task_reserve', 'aidesk_goal_task_record',
  'aidesk_goal_finalization_finalize', 'aidesk_goal_share_preference_update',
  'aidesk_goal_community_publish', 'aidesk_goal_community_close', 'aidesk_goal_community_withdraw',
  'aidesk_goal_community_reopen', 'aidesk_goal_community_interaction_relation_set',
  'aidesk_goal_community_interaction_adopt', 'aidesk_goal_community_comment_create',
  'aidesk_goal_community_comment_cancel', 'aidesk_goal_community_notification_mark_read',
  'aidesk_goal_community_notification_mute_set', 'aidesk_goal_community_notification_proactive_set',
  'aidesk_goal_community_report_submit', 'aidesk_goal_data_delete',
  // Result records are durable writes owned by the goal/result contract. They
  // must enter the same operation ledger as goal and community mutations.
  'aidesk_goal_result_record', 'aidesk_goal_result_correct',
  'aidesk_goal_network_delete', 'aidesk_goal_data_delete_cancel',
  'aidesk_goal_network_delete_cancel',
  'aidesk_goal_network_withdraw',
]);

export const READ_TOOLS = new Set([
  'aidesk_account_status', 'aidesk_check_plugin_update', 'aidesk_platform_account_prepare',
  'aidesk_platform_subscription_read',
  'aidesk_goal_draft_read', 'aidesk_goal_task_read', 'aidesk_goal_finalization_read',
  'aidesk_goal_share_preference_read', 'aidesk_goal_community_state',
  'aidesk_goal_community_discover', 'aidesk_goal_community_read',
  // Every operation/preview endpoint is a read of an existing write fact;
  // blocking it would make the required unknown-result recovery path
  // unreachable through the same CLI-native Hook.
  'aidesk_goal_draft_operation', 'aidesk_goal_service_operation',
  'aidesk_goal_task_operation', 'aidesk_goal_finalization_operation',
  'aidesk_goal_share_preference_operation', 'aidesk_goal_community_operation',
  'aidesk_goal_data_export', 'aidesk_goal_data_delete_preview',
  'aidesk_goal_data_delete_operation', 'aidesk_goal_network_discover',
  'aidesk_goal_network_read', 'aidesk_goal_network_operation',
  'aidesk_goal_network_scope_read', 'aidesk_goal_network_scope_operation',
  'aidesk_goal_network_delete_preview', 'aidesk_goal_network_delete_operation',
  'aidesk_goal_network_report_operation', 'aidesk_goal_network_report_status',
  'aidesk_goal_result_read', 'aidesk_goal_result_operation',
  // P1-03 community interaction reads. These are explicit read contracts so
  // the lifecycle Hook can observe the complete community surface without
  // treating existing MCP capabilities as unknown tools.
  'aidesk_goal_community_interaction_adoptions',
  'aidesk_goal_community_interaction_state',
  'aidesk_goal_community_interaction_bookmarks',
  'aidesk_goal_community_interaction_operation',
  'aidesk_goal_community_comment_read',
  'aidesk_goal_community_comment_thread',
  'aidesk_goal_community_comment_own',
  'aidesk_goal_community_comment_operation',
  'aidesk_goal_community_notification_list',
  'aidesk_goal_community_notification_read',
  'aidesk_goal_community_notification_preferences',
  'aidesk_goal_community_notification_operation',
  'aidesk_goal_community_report_list',
  'aidesk_goal_community_report_status',
  'aidesk_goal_community_report_operation',
]);

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

export function toolFromEvent(event) {
  const match = /^mcp__aidesk[_-]authority__(.+)$/u.exec(event?.tool_name ?? '');
  return match?.[1] ?? null;
}

export function isWriteTool(tool) { return WRITE_TOOLS.has(tool); }
export function isReadTool(tool) { return READ_TOOLS.has(tool); }
export function isKnownTool(tool) { return isWriteTool(tool) || isReadTool(tool); }

export function operationId(input) {
  return typeof input?.operationId === 'string'
    && input.operationId.length > 0
    && input.operationId.length <= 200
    && !/[\u0000\r\n]/u.test(input.operationId)
    ? input.operationId
    : null;
}
