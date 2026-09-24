// Generated from services/authority-api/src/goal-network-delete-contract.ts; source SHA-256 a326ec8e2ceefa2ff5c29a2f2a59f9b8e43533d2ff35b146085963e5c238b658.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Explicit own-content erasure implementation; not a sharing licence,
 * retention policy or authority to recall other people's lawful copies. */
export const GOAL_NETWORK_DELETE_CONTRACT = "aidesk-goal-network-delete-v1";
export const GOAL_NETWORK_DELETE_SCOPE = "own_network_content";
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
    return teachingObject(v) && uuid(v.cohortId) && uuid(v.postId)
        && (v.kind === "post" && exact(v, ["kind", "cohortId", "postId"])
            || v.kind === "response" && exact(v, ["kind", "cohortId", "postId", "sourceVersion", "responseId"])
                && uuid(v.responseId) && count(v.sourceVersion, 1, 2147483647));
}
const boundary = (v) => v.scope === GOAL_NETWORK_DELETE_SCOPE
    && canonicalTeachingJson(v.exclusions) === canonicalTeachingJson(GOAL_NETWORK_DELETE_EXCLUSIONS);
export function parseGoalNetworkDeleteInput(action, value) {
    let p;
    try {
        p = parseTeachingJson(typeof value === "string" ? value : canonicalTeachingJson(value), GOAL_NETWORK_DELETE_LIMITS.requestBytes);
    }
    catch {
        throw new GoalNetworkDeleteError("invalid_input");
    }
    if (!teachingObject(p) || p.contract !== GOAL_NETWORK_DELETE_CONTRACT)
        throw new GoalNetworkDeleteError("invalid_input");
    const valid = action === "preview" ? exact(p, ["contract", "target"]) && validGoalNetworkDeleteTarget(p.target)
        : action === "delete" || action === "cancel" ? exact(p, ["contract", "operationId", "target", "expectedSnapshot"])
            && validGoalNetworkDeleteTarget(p.target) && uuid(p.operationId) && hash(p.expectedSnapshot)
            : action === "operation" && exact(p, ["contract", "operationId", "requestSha256"]) && uuid(p.operationId) && hash(p.requestSha256);
    if (!valid)
        throw new GoalNetworkDeleteError("invalid_input");
    return p;
}
function terminalReceipt(v) {
    if (!teachingObject(v) || v.status !== "deleted" && v.status !== "cancelled")
        return false;
    const timestamp = v.status === "deleted" ? "deletedAt" : "cancelledAt";
    if (!exact(v, ["contract", "status", "operationId", "requestSha256", "target", timestamp, "snapshot", "scope", "exclusions"])
        || v.contract !== GOAL_NETWORK_DELETE_CONTRACT || !validGoalNetworkDeleteTarget(v.target) || !uuid(v.operationId)
        || !hash(v.requestSha256) || !hash(v.snapshot) || typeof v[timestamp] !== "string" || !isTimestamp(v[timestamp]) || !boundary(v))
        return false;
    return teachingRequestSha256({ contract: GOAL_NETWORK_DELETE_CONTRACT, operationId: v.operationId, target: v.target, expectedSnapshot: v.snapshot }) === v.requestSha256;
}
export function validGoalNetworkDeleteResult(action, v, input) {
    try {
        if (!teachingObject(v) || v.contract !== GOAL_NETWORK_DELETE_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_NETWORK_DELETE_LIMITS.transportBytes)
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
                        && terminalReceipt(v.receipt) && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256);
        }
        const p = input;
        if (action !== "preview" || canonicalTeachingJson(v.target) !== canonicalTeachingJson(p.target))
            return false;
        if (v.status === "not_found")
            return exact(v, ["contract", "status", "target"]);
        if (v.status === "deleted")
            return exact(v, ["contract", "status", "target", "receipt"]) && terminalReceipt(v.receipt)
                && v.receipt.status === "deleted" && canonicalTeachingJson(v.receipt.target) === canonicalTeachingJson(p.target);
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
