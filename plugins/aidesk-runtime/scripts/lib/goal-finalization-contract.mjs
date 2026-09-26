// Generated from services/authority-api/src/goal-finalization-contract.ts; source SHA-256 0a7682ee737a11aac06333032c58379cbe19ff6905de8c913b6082954c404da2.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Non-authoritative implementation of goal finalization. SQL owns trusted
 * creation eligibility and current versions; a preview is not publication. */
export const GOAL_FINALIZATION_CONTRACT = "aidesk-goal-finalization-v1";
export const GOAL_FINALIZATION_LIMITS = Object.freeze({ requestBytes: 24576, transportBytes: 32768 });
export class GoalFinalizationError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ goal_deleted: "该目标内容已删除，不能重新定稿；请沿原号核对旧操作。", invalid_input: "目标定稿请求无效。",
            payload_too_large: "目标定稿内容超过本次大小限制。", scope_denied: "当前账号无权读取或定稿此目标。",
            version_conflict: "目标或分享设置已变化，请读取当前版本。", idempotency_conflict: "原操作号对应的定稿内容不一致。",
            budget_too_small: "读取预算不足以容纳此条记录。", unavailable: "暂时无法读取目标定稿记录，不能据此采用默认分享。",
            outcome_unknown: "定稿结果尚不确定，请用原操作号和完整请求摘要对账。", cancelled: "读取或尚未发送的定稿请求已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalFinalizationError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 0, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v, max, multiline = false) => typeof v === "string" && v.isWellFormed()
    && v.trim().length > 0 && Buffer.byteLength(v) <= max && !/\p{Cc}/u.test(multiline ? v.replace(/[\t\n\r]/gu, "") : v);
function sharing(v) {
    return v === null || exact(v, ["enabled", "basis", "preferenceVersion", "projection"]) && typeof v.enabled === "boolean"
        && (v.basis === "default" ? integer(v.preferenceVersion) : v.basis === "goal_choice" && (v.preferenceVersion === null || integer(v.preferenceVersion)))
        && (v.enabled ? exact(v.projection, ["title", "text"]) && text(v.projection.title, 160) && text(v.projection.text, 8192, true) : v.projection === null);
}
export const goalFinalizationIsWrite = (action) => action === "finalize";
export function parseGoalFinalizationInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_FINALIZATION_LIMITS.requestBytes)
            throw new GoalFinalizationError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_FINALIZATION_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalFinalizationError ? error : new GoalFinalizationError("invalid_input");
    }
    const valid = teachingObject(v) && v.contract === GOAL_FINALIZATION_CONTRACT
        && (action === "finalize" && exact(v, ["contract", "operationId", "goalId", "goalVersion", "expectedVersion", "sharing"])
            && uuid(v.operationId) && uuid(v.goalId) && integer(v.goalVersion, 1) && integer(v.expectedVersion, 0, 2147483646) && sharing(v.sharing)
            || action === "read" && exact(v, ["contract", "goalId", "version"]) && uuid(v.goalId) && (v.version === null || integer(v.version, 1))
            || action === "operation" && exact(v, ["contract", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256));
    if (!valid)
        throw new GoalFinalizationError("invalid_input");
    return v;
}
function finalization(v) {
    return exact(v, ["goalId", "version", "goalVersion", "sharing", "projectionSha256", "finalizedAt"])
        && uuid(v.goalId) && integer(v.version, 1) && integer(v.goalVersion, 1) && sharing(v.sharing) && isTimestamp(v.finalizedAt)
        && (v.sharing?.enabled ? hash(v.projectionSha256) && v.projectionSha256 === teachingRequestSha256(v.sharing.projection) : v.projectionSha256 === null);
}
function receipt(v, operationId, digest) {
    if (!(exact(v, ["contract", "status", "operationId", "requestSha256", "expectedVersion", "finalization"])
        && v.contract === GOAL_FINALIZATION_CONTRACT && v.status === "finalized" && v.operationId === operationId && v.requestSha256 === digest
        && integer(v.expectedVersion, 0, 2147483646) && finalization(v.finalization)))
        return false;
    const f = v.finalization;
    return (f.version === v.expectedVersion || f.version === v.expectedVersion + 1)
        && teachingRequestSha256({ contract: v.contract, operationId, goalId: f.goalId, goalVersion: f.goalVersion,
            expectedVersion: v.expectedVersion, sharing: f.sharing }) === digest;
}
export function validGoalFinalizationResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_FINALIZATION_CONTRACT || v.contract !== input.contract)
        return false;
    if (action === "finalize") {
        const p = input;
        return receipt(v, p.operationId, teachingRequestSha256(p)) && v.expectedVersion === p.expectedVersion
            && v.finalization.goalId === p.goalId && v.finalization.goalVersion === p.goalVersion
            && canonicalTeachingJson(v.finalization.sharing) === canonicalTeachingJson(p.sharing);
    }
    if (action === "read") {
        const p = input;
        return v.goalId === p.goalId && (exact(v, ["contract", "status", "goalId"]) && v.status === "not_found"
            || exact(v, ["contract", "status", "goalId", "defaultEligible", "latestGoalVersion", "finalization"])
                && v.status === "found" && typeof v.defaultEligible === "boolean" && integer(v.latestGoalVersion, 1)
                && (v.finalization === null || finalization(v.finalization) && v.finalization.goalId === p.goalId
                    && v.finalization.goalVersion <= v.latestGoalVersion && (p.version === null || v.finalization.version === p.version)));
    }
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                    && receipt(v.receipt, p.operationId, p.requestSha256));
    }
    return false;
}
const actions = ["finalize", "read", "operation"];
export const goalFinalizationToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_finalization_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const version = { type: "integer", minimum: 1, maximum: 2147483647 };
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const sharingSchema = nullable(object({ enabled: { type: "boolean" }, basis: { type: "string", enum: ["default", "goal_choice"] },
    preferenceVersion: nullable({ type: "integer", minimum: 0, maximum: 2147483647 }),
    projection: nullable(object({ title: { type: "string", minLength: 1, maxLength: 160 }, text: { type: "string", minLength: 1, maxLength: 8192 } })) }));
const fields = {
    finalize: { operationId: id, goalId: id, goalVersion: version, expectedVersion: { type: "integer", minimum: 0, maximum: 2147483646 }, sharing: sharingSchema },
    read: { goalId: id, version: nullable(version) }, operation: { operationId: id, requestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } },
};
const descriptions = {
    finalize: "按本人已明确的目标版本及分享开关定稿，固定最小公开预览；开启须带预览，关闭须为null，采用默认值须带读取的preferenceVersion。不公开原文、不启动试用或创建任务；保留原号对账。",
    read: "读取本人目标的定稿版本及可信新建资格；latestGoalVersion是当前草稿版本，历史定稿不表示当前内容已采用。失败不能当作默认分享或首次创建。",
    operation: "按原操作号与完整请求摘要核对目标定稿；not_found不是取消终态，旧回执只证明当时定稿，当前版本另用read读取。",
};
export const goalFinalizationToolDefinitions = actions.map(action => ({ name: `aidesk_goal_finalization_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action],
    inputSchema: object({ contract: { type: "string", enum: [GOAL_FINALIZATION_CONTRACT] }, ...fields[action] }),
    annotations: { readOnlyHint: !goalFinalizationIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
