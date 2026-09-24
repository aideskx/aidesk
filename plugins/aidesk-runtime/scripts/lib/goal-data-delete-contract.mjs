// Generated from services/authority-api/src/goal-data-delete-contract.ts; source SHA-256 a7d929c9b244a1f20e64365736380a2f22806248aa8c175577d15db302b0398a.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
import { GOAL_DATA_EXPORT_EXCLUSIONS } from "./goal-data-export-contract.mjs";
/** Versioned implementation contract, not a retention policy or a claim to
 * erase host history, arbitrary files, or another person's lawful copies. */
export const GOAL_DATA_DELETE_CONTRACT = "aidesk-goal-data-delete-v1";
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
    if (!teachingObject(p) || p.contract !== GOAL_DATA_DELETE_CONTRACT)
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
    if (!exact(v, ["contract", "status", "operationId", "requestSha256", "goalId", timestamp, "snapshot", "scope", "exclusions"])
        || v.contract !== GOAL_DATA_DELETE_CONTRACT || !uuid(v.goalId) || !uuid(v.operationId)
        || !hash(v.requestSha256) || !hash(v.snapshot) || typeof v[timestamp] !== "string" || !isTimestamp(v[timestamp]) || !boundary(v))
        return false;
    return teachingRequestSha256({ contract: GOAL_DATA_DELETE_CONTRACT, operationId: v.operationId, goalId: v.goalId, expectedSnapshot: v.snapshot }) === v.requestSha256;
}
export function validGoalDataDeleteResult(action, v, input) {
    try {
        if (!teachingObject(v) || v.contract !== GOAL_DATA_DELETE_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_DATA_DELETE_LIMITS.transportBytes)
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
                        && terminalReceipt(v.receipt) && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256);
        }
        if (action !== "preview" || v.goalId !== input.goalId)
            return false;
        if (v.status === "not_found")
            return exact(v, ["contract", "status", "goalId"]);
        if (v.status === "deleted")
            return exact(v, ["contract", "status", "goalId", "receipt"]) && terminalReceipt(v.receipt) && v.receipt.status === "deleted" && v.receipt.goalId === v.goalId;
        return v.status === "ready" && exact(v, ["contract", "status", "goalId", "currentVersion", "snapshot", "scope", "exclusions"])
            && typeof v.currentVersion === "number" && Number.isSafeInteger(v.currentVersion) && v.currentVersion >= 1 && v.currentVersion <= 2147483647
            && hash(v.snapshot) && boundary(v);
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
