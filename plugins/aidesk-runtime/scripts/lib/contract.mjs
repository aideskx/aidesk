import { createHash } from 'node:crypto';

export const WRITE_TOOLS = new Set([
  'aidesk_goal_draft_save', 'aidesk_goal_service_cooperate',
  'aidesk_goal_task_reserve', 'aidesk_goal_task_record',
  'aidesk_goal_finalization_finalize', 'aidesk_goal_share_preference_update',
  'aidesk_goal_community_publish', 'aidesk_goal_community_close',
  'aidesk_goal_community_reopen', 'aidesk_goal_community_interaction_relation_set',
  'aidesk_goal_community_interaction_adopt', 'aidesk_goal_community_comment_create',
  'aidesk_goal_community_comment_cancel', 'aidesk_goal_community_notification_mark_read',
  'aidesk_goal_community_notification_mute_set', 'aidesk_goal_community_notification_proactive_set',
  'aidesk_goal_community_report_submit', 'aidesk_goal_data_delete',
  'aidesk_goal_network_delete',
]);

export const READ_TOOLS = new Set([
  'aidesk_account_status', 'aidesk_check_plugin_update', 'aidesk_platform_subscription_read',
  'aidesk_goal_draft_read', 'aidesk_goal_task_read', 'aidesk_goal_finalization_read',
  'aidesk_goal_share_preference_read', 'aidesk_goal_community_state',
  'aidesk_goal_community_discover', 'aidesk_goal_community_read',
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
export function isReadTool(tool) { return READ_TOOLS.has(tool) || Boolean(tool?.startsWith('aidesk_goal_')); }

export function operationId(input) { return typeof input?.operationId === 'string' && input.operationId.length > 0 ? input.operationId : null; }
