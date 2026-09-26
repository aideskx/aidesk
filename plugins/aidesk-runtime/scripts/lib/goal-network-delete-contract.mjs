// Generated from services/authority-api/src/goal-network-delete-contract.ts; source SHA-256 df33ab54b3a5e89e43500019e8d4a1179bfbadce147adb08a09e25ce899661b1.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Explicit own-content erasure implementation; not a sharing licence,
 * retention policy or authority to recall other people's lawful copies. */
export const GOAL_NETWORK_DELETE_CONTRACT = "aidesk-goal-network-delete-v1";
export const GOAL_NETWORK_DELETE_V2_CONTRACT = "aidesk-goal-network-delete-v2";
export const GOAL_NETWORK_DELETE_V3_CONTRACT = "aidesk-goal-network-delete-v3";
export const GOAL_NETWORK_DELETE_V4_CONTRACT = "aidesk-goal-network-delete-v4";
export const GOAL_NETWORK_DELETE_V5_CONTRACT = "aidesk-goal-network-delete-v5";
export const GOAL_COMMUNITY_REPORT_SCOPE = "own_community_report_data";
export const GOAL_COMMUNITY_REPORT_EXCLUSIONS = ["source_content", "other_reports", "operator_originals_and_grants", "content_restrictions", "other_network_objects", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export const GOAL_COMMUNITY_REPORT_DELETE_EXCLUSIONS = [...GOAL_COMMUNITY_REPORT_EXCLUSIONS, "independent_exports"];
export const GOAL_COMMUNITY_NOTIFICATION_SCOPE = "own_community_notification_data";
export const GOAL_COMMUNITY_NOTIFICATION_SETTINGS_SCOPE = "own_community_notification_settings_data";
export const GOAL_COMMUNITY_NOTIFICATION_EXCLUSIONS = ["source_content", "other_notifications", "notification_settings", "comments_and_replies", "adoptions_and_goals", "other_network_objects", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export const GOAL_COMMUNITY_NOTIFICATION_SETTINGS_EXCLUSIONS = ["notifications_and_events", "other_settings_generations", "source_content", "comments_and_replies", "adoptions_and_goals", "other_network_objects", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export const GOAL_COMMUNITY_NOTIFICATION_DELETE_EXCLUSIONS = [...GOAL_COMMUNITY_NOTIFICATION_EXCLUSIONS, "independent_exports"];
export const GOAL_COMMUNITY_NOTIFICATION_SETTINGS_DELETE_EXCLUSIONS = [...GOAL_COMMUNITY_NOTIFICATION_SETTINGS_EXCLUSIONS, "independent_exports"];
export const GOAL_COMMUNITY_COMMENT_SCOPE = "own_community_comment_data";
export const GOAL_COMMUNITY_COMMENT_EXCLUSIONS = ["source_content", "independent_comments_and_replies", "adoptions_and_goals", "other_network_objects", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export const GOAL_COMMUNITY_COMMENT_DELETE_EXCLUSIONS = [...GOAL_COMMUNITY_COMMENT_EXCLUSIONS, "independent_exports"];
export const GOAL_NETWORK_DELETE_SCOPE = "own_network_content";
export const GOAL_COMMUNITY_RELATIONSHIP_SCOPE = "own_community_relationship_data";
export const GOAL_COMMUNITY_RELATIONSHIP_EXCLUSIONS = ["source_content", "adoptions_and_goals", "comments_and_replies", "other_relationship_generations",
    "other_network_objects", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export const GOAL_COMMUNITY_RELATIONSHIP_DELETE_EXCLUSIONS = [...GOAL_COMMUNITY_RELATIONSHIP_EXCLUSIONS, "independent_exports"];
export const GOAL_NETWORK_DELETE_EXCLUSIONS = ["independent_responses", "adopted_copies_and_goals", "other_network_objects",
    "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes", "independent_exports"];
export const GOAL_NETWORK_DELETE_LIMITS = Object.freeze({ requestBytes: 2048, transportBytes: 4096 });
export class GoalNetworkDeleteError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(kind === "deletion_cancelled" ? "本次删除原号已取消且不可再执行；对象当前状态须另行核对。"
            : kind === "network_content_deleted" ? "该帖子或回应正文已删除；保留原号核对服务事实与本机清理。"
                : "本人分享内容删除未确认完成；保留准确对象、原号及摘要，对账后处理。");
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalNetworkDeleteError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const uuid = (v) => typeof v === "string" && isUuid(v) && v === v.toLowerCase();
const count = (v, min, max = Number.MAX_SAFE_INTEGER) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export function validGoalNetworkDeleteTarget(v) {
    return validGoalCommunityReportDataTarget(v) || validGoalCommunityNotificationTarget(v) || validGoalCommunityCommentTarget(v) || validGoalCommunityRelationshipTarget(v) || teachingObject(v) && uuid(v.cohortId) && uuid(v.postId)
        && (v.kind === "post" && exact(v, ["kind", "cohortId", "postId"])
            || v.kind === "response" && exact(v, ["kind", "cohortId", "postId", "sourceVersion", "responseId"])
                && uuid(v.responseId) && count(v.sourceVersion, 1, 2147483647));
}
export function validGoalCommunityRelationshipTarget(v) {
    return exact(v, ["kind", "publicId", "generation"]) && v.kind === "community_relationships" && uuid(v.publicId) && count(v.generation, 1, 2147483647);
}
export function validGoalCommunityCommentTarget(v) {
    return exact(v, ["kind", "publicId", "commentId"]) && v.kind === "community_comment" && uuid(v.publicId) && uuid(v.commentId);
}
export function validGoalCommunityNotificationTarget(v) {
    return exact(v, ["kind", "notificationId"]) && v.kind === "community_notification" && uuid(v.notificationId)
        || exact(v, ["kind", "generation"]) && v.kind === "community_notification_settings" && count(v.generation, 1, 2147483647);
}
export function validGoalCommunityReportDataTarget(v) {
    return exact(v, ["kind", "reportId"]) && v.kind === "community_report" && uuid(v.reportId);
}
const contract = (v) => v === GOAL_NETWORK_DELETE_CONTRACT || v === GOAL_NETWORK_DELETE_V2_CONTRACT || v === GOAL_NETWORK_DELETE_V3_CONTRACT || v === GOAL_NETWORK_DELETE_V4_CONTRACT || v === GOAL_NETWORK_DELETE_V5_CONTRACT;
const targetFor = (c, v) => validGoalNetworkDeleteTarget(v)
    && (c === GOAL_NETWORK_DELETE_V5_CONTRACT ? v.kind === "community_report" : c === GOAL_NETWORK_DELETE_V4_CONTRACT ? v.kind === "community_notification" || v.kind === "community_notification_settings" && v.generation < 2147483647
        : c === GOAL_NETWORK_DELETE_V3_CONTRACT ? v.kind === "community_comment" : c === GOAL_NETWORK_DELETE_V2_CONTRACT ? v.kind === "community_relationships" && v.generation < 2147483647 : v.kind === "post" || v.kind === "response");
const settingsTarget = (v) => teachingObject(v) && v.kind === "community_notification_settings";
const boundary = (v) => v.scope === (v.contract === GOAL_NETWORK_DELETE_V5_CONTRACT ? GOAL_COMMUNITY_REPORT_SCOPE : v.contract === GOAL_NETWORK_DELETE_V4_CONTRACT ? settingsTarget(v.target) ? GOAL_COMMUNITY_NOTIFICATION_SETTINGS_SCOPE : GOAL_COMMUNITY_NOTIFICATION_SCOPE : v.contract === GOAL_NETWORK_DELETE_V3_CONTRACT ? GOAL_COMMUNITY_COMMENT_SCOPE : v.contract === GOAL_NETWORK_DELETE_V2_CONTRACT ? GOAL_COMMUNITY_RELATIONSHIP_SCOPE : GOAL_NETWORK_DELETE_SCOPE)
    && canonicalTeachingJson(v.exclusions) === canonicalTeachingJson(v.contract === GOAL_NETWORK_DELETE_V5_CONTRACT ? GOAL_COMMUNITY_REPORT_DELETE_EXCLUSIONS : v.contract === GOAL_NETWORK_DELETE_V4_CONTRACT ? settingsTarget(v.target) ? GOAL_COMMUNITY_NOTIFICATION_SETTINGS_DELETE_EXCLUSIONS : GOAL_COMMUNITY_NOTIFICATION_DELETE_EXCLUSIONS : v.contract === GOAL_NETWORK_DELETE_V3_CONTRACT ? GOAL_COMMUNITY_COMMENT_DELETE_EXCLUSIONS : v.contract === GOAL_NETWORK_DELETE_V2_CONTRACT ? GOAL_COMMUNITY_RELATIONSHIP_DELETE_EXCLUSIONS : GOAL_NETWORK_DELETE_EXCLUSIONS);
export function parseGoalNetworkDeleteInput(action, value) {
    let p;
    try {
        p = parseTeachingJson(typeof value === "string" ? value : canonicalTeachingJson(value), GOAL_NETWORK_DELETE_LIMITS.requestBytes);
    }
    catch {
        throw new GoalNetworkDeleteError("invalid_input");
    }
    if (!teachingObject(p) || !contract(p.contract))
        throw new GoalNetworkDeleteError("invalid_input");
    const valid = action === "preview" ? exact(p, ["contract", "target"]) && targetFor(p.contract, p.target)
        : action === "delete" || action === "cancel" ? exact(p, ["contract", "operationId", "target", "expectedSnapshot"])
            && targetFor(p.contract, p.target) && uuid(p.operationId) && hash(p.expectedSnapshot)
            : action === "operation" && exact(p, ["contract", "operationId", "requestSha256"]) && uuid(p.operationId) && hash(p.requestSha256);
    if (!valid)
        throw new GoalNetworkDeleteError("invalid_input");
    return p;
}
function terminalReceipt(v) {
    if (!teachingObject(v) || v.status !== "deleted" && v.status !== "cancelled")
        return false;
    const timestamp = v.status === "deleted" ? "deletedAt" : "cancelledAt";
    const advancesGeneration = v.contract === GOAL_NETWORK_DELETE_V2_CONTRACT || v.contract === GOAL_NETWORK_DELETE_V4_CONTRACT && settingsTarget(v.target);
    if (!exact(v, ["contract", "status", "operationId", "requestSha256", "target", timestamp, "snapshot", "scope", "exclusions", ...(advancesGeneration && v.status === "deleted" ? ["nextGeneration"] : [])])
        || !contract(v.contract) || !targetFor(v.contract, v.target) || !uuid(v.operationId)
        || !hash(v.requestSha256) || !hash(v.snapshot) || typeof v[timestamp] !== "string" || !isTimestamp(v[timestamp]) || !boundary(v))
        return false;
    return (!advancesGeneration || v.status !== "deleted" || teachingObject(v.target) && typeof v.target.generation === "number" && v.nextGeneration === v.target.generation + 1)
        && teachingRequestSha256({ contract: v.contract, operationId: v.operationId, target: v.target, expectedSnapshot: v.snapshot }) === v.requestSha256;
}
export function validGoalNetworkDeleteResult(action, v, input) {
    try {
        if (!teachingObject(v) || !contract(input.contract) || v.contract !== input.contract || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_NETWORK_DELETE_LIMITS.transportBytes)
            return false;
        if (action === "delete" || action === "cancel") {
            const p = input;
            return terminalReceipt(v) && (action === "cancel" || v.status === "deleted") && canonicalTeachingJson(v.target) === canonicalTeachingJson(p.target)
                && v.operationId === p.operationId && v.snapshot === p.expectedSnapshot && v.requestSha256 === teachingRequestSha256(p);
        }
        if (action === "operation") {
            const p = input;
            return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
                && (v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                    || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.terminal === true
                        && terminalReceipt(v.receipt) && v.receipt.contract === p.contract && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256);
        }
        const p = input;
        if (action !== "preview" || canonicalTeachingJson(v.target) !== canonicalTeachingJson(p.target))
            return false;
        if (v.status === "not_found")
            return exact(v, ["contract", "status", "target"]);
        if (v.status === "deleted")
            return exact(v, ["contract", "status", "target", "receipt"]) && terminalReceipt(v.receipt)
                && v.receipt.status === "deleted" && v.receipt.contract === input.contract && canonicalTeachingJson(v.receipt.target) === canonicalTeachingJson(p.target);
        if (input.contract === GOAL_NETWORK_DELETE_V5_CONTRACT)
            return v.status === "ready" && hash(v.snapshot) && boundary(v)
                && exact(v, ["contract", "status", "target", "snapshot", "scope", "exclusions", "reportCount", "operationCount", "eraseReason", "eraseOperationOriginals", "preserveCaseTarget", "preserveHandlingFacts", "preserveRestrictions"])
                && p.target.kind === "community_report" && count(v.reportCount, 0, 1) && v.operationCount === v.reportCount && v.eraseReason === true
                && v.eraseOperationOriginals === true && v.preserveCaseTarget === true && v.preserveHandlingFacts === true && v.preserveRestrictions === true;
        if (input.contract === GOAL_NETWORK_DELETE_V4_CONTRACT)
            return v.status === "ready" && hash(v.snapshot) && boundary(v)
                && (p.target.kind === "community_notification"
                    ? exact(v, ["contract", "status", "target", "snapshot", "scope", "exclusions", "notificationCount", "eventCount", "operationCount", "eraseMetadata", "eraseOperationOriginals", "preserveSourceContent", "preserveSettings"])
                        && v.notificationCount === 1 && count(v.eventCount, 1) && count(v.operationCount, 0) && v.eraseMetadata === true
                        && v.eraseOperationOriginals === true && v.preserveSourceContent === true && v.preserveSettings === true
                    : p.target.kind === "community_notification_settings"
                        && exact(v, ["contract", "status", "target", "snapshot", "scope", "exclusions", "muteCount", "operationCount", "eraseSettings", "eraseOperationOriginals", "nextGeneration", "defaultProactiveEnabled", "defaultMuted"])
                        && count(v.muteCount, 0) && count(v.operationCount, 0) && v.eraseSettings === true && v.eraseOperationOriginals === true
                        && v.nextGeneration === p.target.generation + 1 && v.defaultProactiveEnabled === false && v.defaultMuted === false);
        if (input.contract === GOAL_NETWORK_DELETE_V3_CONTRACT)
            return v.status === "ready"
                && exact(v, ["contract", "status", "target", "snapshot", "scope", "exclusions", "commentCount", "operationCount", "eraseBody", "eraseOperationOriginals", "preserveIndependentReplies"])
                && count(v.commentCount, 0, 1) && count(v.operationCount, 0, 1) && Number(v.commentCount) + Number(v.operationCount) > 0
                && v.eraseBody === true && v.eraseOperationOriginals === true && v.preserveIndependentReplies === true && hash(v.snapshot) && boundary(v);
        if (input.contract === GOAL_NETWORK_DELETE_V2_CONTRACT)
            return v.status === "ready"
                && exact(v, ["contract", "status", "target", "snapshot", "scope", "exclusions", "relationshipCount", "operationCount", "eraseRelationships", "eraseOperationOriginals", "nextGeneration"])
                && validGoalCommunityRelationshipTarget(p.target) && v.nextGeneration === p.target.generation + 1
                && count(v.relationshipCount, 0, 2) && count(v.operationCount, 0) && v.eraseRelationships === true && v.eraseOperationOriginals === true && hash(v.snapshot) && boundary(v);
        return v.status === "ready" && exact(v, ["contract", "status", "target", "currentVersion", "revisionCount", "contentBytes", "snapshot", "scope", "exclusions"])
            && count(v.currentVersion, 1, 2147483647) && count(v.revisionCount, 1, 2147483647) && count(v.contentBytes, 1)
            && (p.target.kind !== "response" || v.currentVersion === p.target.sourceVersion && v.revisionCount === 1)
            && hash(v.snapshot) && boundary(v);
    }
    catch {
        return false;
    }
}
export const goalNetworkDeleteToolAction = (name) => name === "aidesk_goal_network_delete_preview" ? "preview"
    : name === "aidesk_goal_network_delete" ? "delete" : name === "aidesk_goal_network_delete_cancel" ? "cancel" : name === "aidesk_goal_network_delete_operation" ? "operation" : undefined;
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f-]+$" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const targetSchema = { anyOf: [
        { type: "object", additionalProperties: false, properties: { kind: { const: "post", type: "string" }, cohortId: id, postId: id }, required: ["kind", "cohortId", "postId"] },
        { type: "object", additionalProperties: false, properties: { kind: { const: "response", type: "string" }, cohortId: id, postId: id, responseId: id,
                sourceVersion: { type: "integer", minimum: 1, maximum: 2147483647 } }, required: ["kind", "cohortId", "postId", "sourceVersion", "responseId"] },
    ] };
function schema(properties) {
    return { type: "object", additionalProperties: false, properties: { contract: { const: GOAL_NETWORK_DELETE_CONTRACT, type: "string" }, ...properties }, required: ["contract", ...Object.keys(properties)] };
}
export const goalNetworkDeleteToolDefinitions = [
    { name: "aidesk_goal_network_delete_preview", description: "只读预览本人单帖全部历史修订或单条回应的准确删除快照；不删除，不受理，不建立账号。", inputSchema: schema({ target: targetSchema }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_delete", description: "仅按用户对准确对象的明确删除要求，删除本人帖子全部修订正文或单条回应正文。保留薄原号与来源关系，他人采用副本和独立回应不删；本机清理另核。", inputSchema: schema({ operationId: id, target: targetSchema, expectedSnapshot: digest }),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_delete_cancel", description: "按完全相同删除原件及原号取消尚未完成删除；已经删除只返回原事实。not_found或取消未知不释放意图。", inputSchema: schema({ operationId: id, target: targetSchema, expectedSnapshot: digest }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_delete_operation", description: "按本人删除原号和完整请求摘要对账。not_found不是终态；不换原号，不附正文。", inputSchema: schema({ operationId: id, requestSha256: digest }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
export const goalCommunityRelationshipTargetSchema = { type: "object", additionalProperties: false,
    properties: { kind: { const: "community_relationships", type: "string" }, publicId: id, generation: { type: "integer", minimum: 1, maximum: 2147483647 } },
    required: ["kind", "publicId", "generation"] };
export const goalNetworkDeleteV2ToolDefinitions = goalNetworkDeleteToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v2 只清本人准确公开编号及 generation 的点赞／收藏关系和原件；取消点赞／收藏不等于删除。",
    inputSchema: { type: "object", oneOf: [tool.inputSchema, { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
                    contract: { const: GOAL_NETWORK_DELETE_V2_CONTRACT, type: "string" },
                    ...("target" in tool.inputSchema.properties ? { target: { ...goalCommunityRelationshipTargetSchema, properties: {
                                ...goalCommunityRelationshipTargetSchema.properties, generation: { type: "integer", minimum: 1, maximum: 2147483646 }
                            } } } : {}) } }] },
}));
export const goalCommunityCommentTargetSchema = { type: "object", additionalProperties: false,
    properties: { kind: { const: "community_comment", type: "string" }, publicId: id, commentId: id },
    required: ["kind", "publicId", "commentId"] };
export const goalNetworkDeleteV3ToolDefinitions = goalNetworkDeleteToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " v3 清理本人准确公共目标下的单条评论／回复及取消原号；独立回复保持，本机清理另核。",
    inputSchema: { type: "object", oneOf: [...goalNetworkDeleteV2ToolDefinitions[index].inputSchema.oneOf,
            { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
                    contract: { const: GOAL_NETWORK_DELETE_V3_CONTRACT, type: "string" },
                    ...("target" in tool.inputSchema.properties ? { target: goalCommunityCommentTargetSchema } : {}) } }] },
}));
export const goalCommunityNotificationTargetSchema = { oneOf: [
        { type: "object", additionalProperties: false, properties: { kind: { const: "community_notification", type: "string" }, notificationId: id }, required: ["kind", "notificationId"] },
        { type: "object", additionalProperties: false, properties: { kind: { const: "community_notification_settings", type: "string" }, generation: { type: "integer", minimum: 1, maximum: 2147483647 } }, required: ["kind", "generation"] },
    ] };
export const goalNetworkDeleteV4ToolDefinitions = goalNetworkDeleteToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " v4 按准确范围清理单条本人通知及标读原件，或本代全部通知设置及原件；设置清理后主动提醒关闭、目标恢复默认未静音，不删除消息或源内容。",
    inputSchema: { type: "object", oneOf: [...goalNetworkDeleteV3ToolDefinitions[index].inputSchema.oneOf,
            { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, contract: { const: GOAL_NETWORK_DELETE_V4_CONTRACT, type: "string" },
                    ...("target" in tool.inputSchema.properties ? { target: { oneOf: [goalCommunityNotificationTargetSchema.oneOf[0],
                                { ...goalCommunityNotificationTargetSchema.oneOf[1], properties: { ...goalCommunityNotificationTargetSchema.oneOf[1].properties,
                                        generation: { type: "integer", minimum: 1, maximum: 2147483646 } } }] } } : {}) } }] },
}));
export const goalCommunityReportDataTargetSchema = { type: "object", additionalProperties: false,
    properties: { kind: { const: "community_report", type: "string" }, reportId: id }, required: ["kind", "reportId"] };
export const goalNetworkDeleteV5ToolDefinitions = goalNetworkDeleteToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " v5 仅擦本人准确举报的理由和提交原件；案件目标、处理与限制薄事实保留，不撤处置、不删除源内容或他人举报。",
    inputSchema: { type: "object", oneOf: [...goalNetworkDeleteV4ToolDefinitions[index].inputSchema.oneOf,
            { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, contract: { const: GOAL_NETWORK_DELETE_V5_CONTRACT, type: "string" },
                    ...("target" in tool.inputSchema.properties ? { target: goalCommunityReportDataTargetSchema } : {}) } }] },
}));
