// Generated from services/authority-api/src/goal-data-delete-contract.ts; source SHA-256 f35a38059f7a8e8a346a93af318338251222c64209e9e82ef012c328d9652fa1.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
import { GOAL_DATA_EXPORT_EXCLUSIONS } from "./goal-data-export-contract.mjs";
/** Versioned implementation contract, not a retention policy or a claim to
 * erase host history, arbitrary files, or another person's lawful copies. */
export const GOAL_DATA_DELETE_CONTRACT = "aidesk-goal-data-delete-v1";
export const GOAL_DATA_DELETE_V2_CONTRACT = "aidesk-goal-data-delete-v2";
export const GOAL_DATA_DELETE_V3_CONTRACT = "aidesk-goal-data-delete-v3";
export const GOAL_DATA_DELETE_V4_CONTRACT = "aidesk-goal-data-delete-v4";
export const GOAL_DATA_DELETE_V5_CONTRACT = "aidesk-goal-data-delete-v5";
const deleteContract = (v) => v === GOAL_DATA_DELETE_CONTRACT || v === GOAL_DATA_DELETE_V2_CONTRACT || v === GOAL_DATA_DELETE_V3_CONTRACT || v === GOAL_DATA_DELETE_V4_CONTRACT || v === GOAL_DATA_DELETE_V5_CONTRACT;
export const GOAL_DATA_DELETE_SCOPE = "personal_goal_content";
export const GOAL_DATA_DELETE_EXCLUSIONS = [...GOAL_DATA_EXPORT_EXCLUSIONS, "independent_exports"];
export const GOAL_DATA_DELETE_LIMITS = Object.freeze({ requestBytes: 2048, transportBytes: 4096 });
export class GoalDataDeleteError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(kind === "deletion_cancelled" ? "本次删除操作已取消，原号不可再执行；目标没有因此被删除。" : kind === "goal_deleted" ? "该目标内容已删除；不能重放原请求。原操作是否曾完成须保留原号对账。"
            : "本人目标删除未确认完成；保留准确目标、原号及摘要，核对结果后再处理。");
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalDataDeleteError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const uuid = (v) => typeof v === "string" && isUuid(v) && v === v.toLowerCase();
const boundary = (v) => v.scope === GOAL_DATA_DELETE_SCOPE
    && canonicalTeachingJson(v.exclusions) === canonicalTeachingJson(GOAL_DATA_DELETE_EXCLUSIONS);
export function parseGoalDataDeleteInput(action, value) {
    let p;
    try {
        p = parseTeachingJson(typeof value === "string" ? value : canonicalTeachingJson(value), GOAL_DATA_DELETE_LIMITS.requestBytes);
    }
    catch {
        throw new GoalDataDeleteError("invalid_input");
    }
    if (!teachingObject(p) || !deleteContract(p.contract))
        throw new GoalDataDeleteError("invalid_input");
    const valid = action === "preview" ? exact(p, ["contract", "goalId"]) && uuid(p.goalId)
        : action === "delete" || action === "cancel" ? exact(p, ["contract", "operationId", "goalId", "expectedSnapshot"])
            && uuid(p.goalId) && uuid(p.operationId) && hash(p.expectedSnapshot)
            : action === "operation" && exact(p, ["contract", "operationId", "requestSha256"]) && uuid(p.operationId) && hash(p.requestSha256);
    if (!valid)
        throw new GoalDataDeleteError("invalid_input");
    return p;
}
function terminalReceipt(v) {
    if (!teachingObject(v) || v.status !== "deleted" && v.status !== "cancelled")
        return false;
    const timestamp = v.status === "deleted" ? "deletedAt" : "cancelledAt";
    if (!exact(v, ["contract", "status", "operationId", "requestSha256", "goalId", timestamp, "snapshot", "scope", "exclusions", ...([GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(v.contract) && v.status === "deleted" ? ["commentScope"] : [])])
        || !deleteContract(v.contract) || !uuid(v.goalId) || !uuid(v.operationId)
        || !hash(v.requestSha256) || !hash(v.snapshot) || typeof v[timestamp] !== "string" || !isTimestamp(v[timestamp]) || !boundary(v) || [GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(v.contract) && v.status === "deleted"
        && !(v.commentScope === null || exact(v.commentScope, ["publicId"]) && uuid(v.commentScope.publicId)))
        return false;
    return teachingRequestSha256({ contract: v.contract, operationId: v.operationId, goalId: v.goalId, expectedSnapshot: v.snapshot }) === v.requestSha256;
}
function communityScope(v) {
    return v === null || exact(v, ["publicId", "state", "publicVersion", "revisionCount", "closeBinding", "eraseProjections", "eraseOperationOriginals"])
        && uuid(v.publicId) && (v.state === "published" || v.state === "closed")
        && typeof v.publicVersion === "number" && Number.isSafeInteger(v.publicVersion) && v.publicVersion >= 0 && v.publicVersion <= 2147483647
        && typeof v.revisionCount === "number" && Number.isSafeInteger(v.revisionCount) && v.revisionCount === v.publicVersion
        && (v.state !== "published" || v.publicVersion > 0) && v.closeBinding === true && v.eraseProjections === true && v.eraseOperationOriginals === true;
}
function commentsScope(v, community) {
    if (v === null)
        return community === null;
    return exact(v, ["publicId", "ownCommentCount", "ownOperationCount", "retainedOtherCommentCount", "eraseBodies", "eraseOperationOriginals", "preserveIndependentComments"])
        && uuid(v.publicId) && teachingObject(community) && community.publicId === v.publicId
        && [v.ownCommentCount, v.ownOperationCount, v.retainedOtherCommentCount].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0)
        && v.eraseBodies === true && v.eraseOperationOriginals === true && v.preserveIndependentComments === true;
}
function notificationsScope(v, community) {
    if (v === null)
        return community === null;
    return exact(v, ["publicId", "ownNotificationCount", "preserveMetadata", "preserveOthers", "sourceStateAfterDelete", "bodyPreviewsStored"])
        && uuid(v.publicId) && teachingObject(community) && community.publicId === v.publicId
        && typeof v.ownNotificationCount === "number" && Number.isSafeInteger(v.ownNotificationCount) && v.ownNotificationCount >= 0
        && v.preserveMetadata === true && v.preserveOthers === true && v.sourceStateAfterDelete === "unavailable" && v.bodyPreviewsStored === false;
}
export function validGoalDataDeleteResult(action, v, input) {
    try {
        if (!teachingObject(v) || !deleteContract(input.contract) || v.contract !== input.contract || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_DATA_DELETE_LIMITS.transportBytes)
            return false;
        if (action === "delete" || action === "cancel") {
            const p = input;
            return terminalReceipt(v) && (action === "cancel" || v.status === "deleted") && v.goalId === p.goalId && v.operationId === p.operationId && v.snapshot === p.expectedSnapshot && v.requestSha256 === teachingRequestSha256(p);
        }
        if (action === "operation") {
            const p = input;
            return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
                && (v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                    || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.terminal === true
                        && terminalReceipt(v.receipt) && v.receipt.contract === p.contract && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256);
        }
        if (action !== "preview" || v.goalId !== input.goalId)
            return false;
        if (v.status === "not_found")
            return exact(v, ["contract", "status", "goalId"]);
        if (v.status === "deleted")
            return exact(v, ["contract", "status", "goalId", "receipt"]) && terminalReceipt(v.receipt) && v.receipt.status === "deleted" && v.receipt.goalId === v.goalId
                && (input.contract !== GOAL_DATA_DELETE_CONTRACT || v.receipt.contract === input.contract);
        return v.status === "ready" && exact(v, ["contract", "status", "goalId", "currentVersion", "snapshot", "scope", "exclusions", ...(input.contract !== GOAL_DATA_DELETE_CONTRACT ? ["community"] : []), ...([GOAL_DATA_DELETE_V3_CONTRACT, GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(input.contract) ? ["adoptions"] : []), ...([GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(input.contract) ? ["comments"] : []), ...(input.contract === GOAL_DATA_DELETE_V5_CONTRACT ? ["notifications"] : [])])
            && typeof v.currentVersion === "number" && Number.isSafeInteger(v.currentVersion) && v.currentVersion >= 1 && v.currentVersion <= 2147483647
            && hash(v.snapshot) && boundary(v) && (input.contract === GOAL_DATA_DELETE_CONTRACT || communityScope(v.community))
            && (![GOAL_DATA_DELETE_V3_CONTRACT, GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(input.contract) || exact(v.adoptions, ["count", "operationCount", "eraseReferences", "eraseOperationOriginals"])
                && typeof v.adoptions.count === "number" && Number.isSafeInteger(v.adoptions.count) && v.adoptions.count >= 0
                && typeof v.adoptions.operationCount === "number" && Number.isSafeInteger(v.adoptions.operationCount) && v.adoptions.operationCount >= 0
                && v.adoptions.eraseReferences === true && v.adoptions.eraseOperationOriginals === true)
            && (![GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT].includes(input.contract) || commentsScope(v.comments, v.community))
            && (input.contract !== GOAL_DATA_DELETE_V5_CONTRACT || notificationsScope(v.notifications, v.community));
    }
    catch {
        return false;
    }
}
export const goalDataDeleteToolAction = (name) => name === "aidesk_goal_data_delete_preview" ? "preview"
    : name === "aidesk_goal_data_delete" ? "delete" : name === "aidesk_goal_data_delete_cancel" ? "cancel" : name === "aidesk_goal_data_delete_operation" ? "operation" : undefined;
const idSchema = { type: "string", format: "uuid", pattern: "^[0-9a-f-]+$" };
const hashSchema = { type: "string", pattern: "^[a-f0-9]{64}$" };
function schema(properties) {
    return { type: "object", additionalProperties: false, properties: { contract: { const: GOAL_DATA_DELETE_CONTRACT, type: "string" }, ...properties }, required: ["contract", ...Object.keys(properties)] };
}
export const goalDataDeleteToolDefinitions = [
    { name: "aidesk_goal_data_delete_preview", description: "只读核本人准确目标的删除范围、当前快照或已有删除事实；不删除、不受理、不停止宿主任务。明确范围和不可恢复影响后，才沿用户准确删除授权执行。",
        inputSchema: schema({ goalId: idSchema }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_data_delete", description: "仅按用户对准确目标及范围的明确删除要求，清除该目标的服务正文及关联内容，保留防复活与试用订单对账薄事实。原号和已核快照绑定；不清宿主历史、引用文件、独立导出或他人副本，本机清理另核。",
        inputSchema: schema({ operationId: idSchema, goalId: idSchema, expectedSnapshot: hashSchema }), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_data_delete_cancel", description: "按同一删除原件与原号终止尚未完成的删除，服务确认取消后迟到原请求也不再执行。已完成删除只返回原事实，不恢复已删内容。不得生成替代原号或只凭not_found声称取消。",
        inputSchema: schema({ operationId: idSchema, goalId: idSchema, expectedSnapshot: hashSchema }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_data_delete_operation", description: "按删除原号与完整请求摘要只读对账；not_found不是终态，也不证明先前未执行。结果未知保留原号，不换号重复删除。",
        inputSchema: schema({ operationId: idSchema, requestSha256: hashSchema }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
// Advertised only by the expanded community directory; old descriptors stay exact.
export const goalDataDeleteV2ToolDefinitions = goalDataDeleteToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v2 预览包含关联公开编号、修订数量及关闭／擦除范围；按原件合同恢复旧删除。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { type: "string", enum: [GOAL_DATA_DELETE_CONTRACT, GOAL_DATA_DELETE_V2_CONTRACT] } } },
}));
export const goalDataDeleteV3ToolDefinitions = goalDataDeleteToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v3 另核本人目的目标的社区采用引用及操作原件数量；不串删独立赞藏或源作者内容。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { type: "string", enum: [GOAL_DATA_DELETE_CONTRACT, GOAL_DATA_DELETE_V2_CONTRACT, GOAL_DATA_DELETE_V3_CONTRACT] } } },
}));
export const goalDataDeleteV4ToolDefinitions = goalDataDeleteToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v4 预览并清理本人在该公开目标下的评论及原号；列明他人独立评论保持，按实际 commentScope 清理本机原件。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { type: "string", enum: [GOAL_DATA_DELETE_CONTRACT, GOAL_DATA_DELETE_V2_CONTRACT, GOAL_DATA_DELETE_V3_CONTRACT, GOAL_DATA_DELETE_V4_CONTRACT] } } },
}));
export const goalDataDeleteV5ToolDefinitions = goalDataDeleteToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v5 另列关联本人通知元数据保留及来源定位失效；不删除他人通知，消息自身和本代全部通知设置须按独立准确范围清理。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { type: "string", enum: [GOAL_DATA_DELETE_CONTRACT, GOAL_DATA_DELETE_V2_CONTRACT, GOAL_DATA_DELETE_V3_CONTRACT, GOAL_DATA_DELETE_V4_CONTRACT, GOAL_DATA_DELETE_V5_CONTRACT] } } },
}));
