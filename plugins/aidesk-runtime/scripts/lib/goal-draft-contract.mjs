// Generated from services/authority-api/src/goal-draft-contract.ts; source SHA-256 a5caa90c6a0eb84dcd22983170f6aa71246e59a1cbfe4fa04adf12783d558c49.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Non-authoritative implementation contract for goal organization only. These
 * goal IDs/revisions belong to the goal owner and must survive later acceptance;
 * draft is this slice's capability boundary, never a required user mode. */
export const GOAL_DRAFT_CONTRACT = "aidesk-goal-draft-v1";
export const GOAL_DRAFT_LIMITS = Object.freeze({ requestBytes: 12288, transportBytes: 32768, minBudget: 1024, maxBudget: 24576 });
export class GoalDraftError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ goal_deleted: "该目标内容已删除，不能重放写入；保留原号核对旧操作。", invalid_input: "目标整理请求无效。", payload_too_large: "目标整理内容超过本次大小限制。", scope_denied: "当前账号无权读取或修改此范围。",
            version_conflict: "目标已变更，请读取最新修订后重新整理。", idempotency_conflict: "原操作号对应的内容不一致。", budget_too_small: "读取预算不足以容纳此条记录。",
            unavailable: "暂时无法读取目标整理记录。", outcome_unknown: "保存结果尚不确定，请用原操作号和摘要对账。", cancelled: "读取已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalDraftError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v, min, max = 2147483647) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v, max) => typeof v === "string" && v.isWellFormed() && v.trim().length > 0
    && !/[\p{Cc}]/u.test(v) && Buffer.byteLength(v) <= max;
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const contentKeys = ["objective", "expectedResult", "constraints", "materials", "revisionReason"];
function content(v) {
    return text(v.objective, 2048) && text(v.expectedResult, 2048) && Array.isArray(v.constraints) && v.constraints.length <= 8
        && v.constraints.every(c => text(c, 512)) && Array.isArray(v.materials) && v.materials.length <= 8
        && v.materials.every(m => exact(m, ["id", "uri", "sha256"]) && text(m.id, 64) && text(m.uri, 512) && (m.sha256 === null || hash(m.sha256)))
        && new Set(v.materials.map(m => m.id)).size === v.materials.length
        && (v.revisionReason === null || text(v.revisionReason, 512));
}
export function parseGoalDraftInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_DRAFT_LIMITS.requestBytes)
            throw new GoalDraftError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_DRAFT_LIMITS.requestBytes);
    }
    catch (e) {
        throw e instanceof GoalDraftError ? e : new GoalDraftError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_DRAFT_CONTRACT) {
        if (action === "save")
            valid = exact(v, ["contract", "operationId", "goalId", "expectedVersion", ...contentKeys])
                && uuid(v.operationId) && uuid(v.goalId) && integer(v.expectedVersion, 0, 2147483646) && content(v);
        if (action === "operation")
            valid = exact(v, ["contract", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
        if (action === "read")
            valid = integer(v.budgetBytes, GOAL_DRAFT_LIMITS.minBudget, GOAL_DRAFT_LIMITS.maxBudget)
                && (v.view === "list" && exact(v, ["contract", "view", "afterGoalId", "limit", "budgetBytes"])
                    && (v.afterGoalId === null || uuid(v.afterGoalId)) && integer(v.limit, 1, 16)
                    || v.view === "goal" && exact(v, ["contract", "view", "goalId", "version", "budgetBytes"])
                        && uuid(v.goalId) && (v.version === null || integer(v.version, 1)));
    }
    if (!valid)
        throw new GoalDraftError("invalid_input");
    return v;
}
function goal(v) {
    return exact(v, ["goalId", "version", "status", "updatedAt", ...contentKeys]) && uuid(v.goalId) && integer(v.version, 1)
        && v.status === "draft" && isTimestamp(v.updatedAt) && content(v);
}
function receipt(v, operationId, digest) {
    if (!(exact(v, ["contract", "status", "operationId", "requestSha256", "goal"]) && v.contract === GOAL_DRAFT_CONTRACT
        && v.status === "saved" && v.operationId === operationId && v.requestSha256 === digest && goal(v.goal)))
        return false;
    const g = v.goal;
    return teachingRequestSha256({ contract: GOAL_DRAFT_CONTRACT, operationId, goalId: g.goalId, expectedVersion: g.version - 1,
        objective: g.objective, expectedResult: g.expectedResult, constraints: g.constraints, materials: g.materials, revisionReason: g.revisionReason }) === digest;
}
export function validGoalDraftResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_DRAFT_CONTRACT)
        return false;
    if (action === "save") {
        const p = input;
        return receipt(v, p.operationId, teachingRequestSha256(p)) && v.goal.goalId === p.goalId && v.goal.version === p.expectedVersion + 1
            && contentKeys.every(k => canonicalTeachingJson(v.goal[k]) === canonicalTeachingJson(p[k]));
    }
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"])
                    && v.terminal === true && receipt(v.receipt, p.operationId, p.requestSha256));
    }
    const p = input;
    if (Buffer.byteLength(canonicalTeachingJson(v)) > p.budgetBytes)
        return false;
    if (p.view === "goal")
        return exact(v, ["contract", "status", "goal"])
            && (v.status === "not_found" && v.goal === null || v.status === "found" && goal(v.goal) && v.goal.goalId === p.goalId
                && (p.version === null || v.goal.version === p.version));
    if (!exact(v, ["contract", "status", "items", "nextAfterGoalId"]) || v.status !== "listed" || !Array.isArray(v.items) || v.items.length > p.limit)
        return false;
    let previous = p.afterGoalId ?? "";
    for (const item of v.items) {
        if (!exact(item, ["goalId", "version", "status", "objectivePreview", "updatedAt"]) || !uuid(item.goalId) || item.goalId <= previous
            || !integer(item.version, 1) || item.status !== "draft" || typeof item.objectivePreview !== "string" || item.objectivePreview.length === 0
            || Buffer.byteLength(item.objectivePreview) > 480 || !isTimestamp(item.updatedAt))
            return false;
        previous = item.goalId;
    }
    return v.nextAfterGoalId === null || v.items.length > 0 && v.nextAfterGoalId === previous;
}
export const goalDraftToolAction = (name) => name === "aidesk_goal_draft_save" ? "save"
    : name === "aidesk_goal_draft_read" ? "read" : name === "aidesk_goal_draft_operation" ? "operation" : undefined;
const str = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const base = { contract: { const: GOAL_DRAFT_CONTRACT } };
const budget = { type: "integer", minimum: 1024, maximum: 24576 };
export const goalDraftToolDefinitions = [
    { name: "aidesk_goal_draft_save", description: "保存或修订本人目标整理记录；不表示正式开展、启动试用或创建任务。材料引用未验证可读或共享。保留原操作号对账。",
        inputSchema: obj({ ...base, operationId: id, goalId: id, expectedVersion: { type: "integer", minimum: 0, maximum: 2147483646 },
            objective: str(2048), expectedResult: str(2048), constraints: { type: "array", maxItems: 8, items: str(512) },
            materials: { type: "array", maxItems: 8, items: obj({ id: str(64), uri: str(512), sha256: nullable({ type: "string", pattern: "^[a-f0-9]{64}$" }) }) }, revisionReason: nullable(str(512)) }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_draft_read", description: "按预算读取本人目标摘要列表或指定修订；分页按 goalId 排序，详情按需读取。",
        inputSchema: { type: "object", oneOf: [obj({ ...base, view: { const: "list" }, afterGoalId: nullable(id), limit: { type: "integer", minimum: 1, maximum: 16 }, budgetBytes: budget }),
                obj({ ...base, view: { const: "goal" }, goalId: id, version: nullable({ type: "integer", minimum: 1, maximum: 2147483647 }), budgetBytes: budget })] },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_draft_operation", description: "用本人原操作号和原请求摘要核对目标保存结果；not_found 不是已取消或可盲重建的终态。",
        inputSchema: obj({ ...base, operationId: id, requestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
