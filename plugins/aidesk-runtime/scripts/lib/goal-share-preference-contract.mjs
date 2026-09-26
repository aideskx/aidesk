// Generated from services/authority-api/src/goal-share-preference-contract.ts; source SHA-256 98600cde2de80ae6d5b61a9586bdbacc9294b9c9499f0786c2378836b8f795f1.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Goal-owned preference, not a platform-wide setting or publication grant.
 * It only seeds new goal previews; existing goals and previews remain intact.
 * Non-authoritative implementation of PRODUCT-CONSTITUTION sections 6/8. */
export const GOAL_SHARE_PREFERENCE_CONTRACT = "aidesk-goal-share-preference-v1";
export const GOAL_SHARE_PREFERENCE_LIMITS = Object.freeze({ requestBytes: 1024, transportBytes: 4096 });
export class GoalSharePreferenceError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "目标分享默认设置请求无效。", payload_too_large: "目标分享默认设置请求过大。",
            scope_denied: "当前账号不能办理此分享默认设置。", version_conflict: "分享默认设置已变化，请读取当前版本。",
            idempotency_conflict: "原操作号对应的设置请求不一致。", unavailable: "暂时无法读取分享默认设置，不能据此采用缺省值。",
            outcome_unknown: "分享默认设置的保存结果尚不确定，请沿原号对账。", cancelled: "读取或尚未发送的设置请求已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalSharePreferenceError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 0, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
export const goalSharePreferenceIsWrite = (action) => action === "update";
export function parseGoalSharePreferenceInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_SHARE_PREFERENCE_LIMITS.requestBytes)
            throw new GoalSharePreferenceError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_SHARE_PREFERENCE_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalSharePreferenceError ? error : new GoalSharePreferenceError("invalid_input");
    }
    const valid = teachingObject(v) && v.contract === GOAL_SHARE_PREFERENCE_CONTRACT
        && (action === "read" && exact(v, ["contract"])
            || action === "update" && exact(v, ["contract", "operationId", "expectedVersion", "enabled"])
                && uuid(v.operationId) && integer(v.expectedVersion, 0, 2147483646) && typeof v.enabled === "boolean"
            || action === "operation" && exact(v, ["contract", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256));
    if (!valid)
        throw new GoalSharePreferenceError("invalid_input");
    return v;
}
function preference(v) {
    return exact(v, ["enabled", "version", "updatedAt"]) && typeof v.enabled === "boolean" && integer(v.version)
        && (v.version === 0 ? v.enabled === true && v.updatedAt === null : isTimestamp(v.updatedAt));
}
function receipt(v, operationId, digest) {
    return exact(v, ["contract", "status", "operationId", "requestSha256", "preference"])
        && v.contract === GOAL_SHARE_PREFERENCE_CONTRACT && v.status === "updated"
        && v.operationId === operationId && v.requestSha256 === digest && preference(v.preference) && v.preference.version > 0
        && teachingRequestSha256({ contract: GOAL_SHARE_PREFERENCE_CONTRACT, operationId,
            expectedVersion: v.preference.version - 1, enabled: v.preference.enabled }) === digest;
}
export function validGoalSharePreferenceResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_SHARE_PREFERENCE_CONTRACT)
        return false;
    if (action === "read")
        return exact(v, ["contract", "status", "preference"]) && v.status === "read" && preference(v.preference);
    if (action === "update") {
        const p = input;
        return receipt(v, p.operationId, teachingRequestSha256(p)) && v.preference.enabled === p.enabled && v.preference.version === p.expectedVersion + 1;
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
const actions = ["read", "update", "operation"];
export const goalSharePreferenceToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_share_preference_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const fields = {
    read: {}, update: { operationId: id, expectedVersion: { type: "integer", minimum: 0, maximum: 2147483646 }, enabled: { type: "boolean" } },
    operation: { operationId: id, requestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } },
};
const descriptions = {
    read: "读取本人新目标分享默认设置；成功返回version=0才表示尚未设置、缺省开启。读取失败不能当缺省；不公开草稿、不改变已展示开关或既有目标。",
    update: "按本人意愿和准确expectedVersion保存未来新目标分享默认值；不改变既有目标、已展示的单目标开关或公开范围，不启动试用。",
    operation: "用原操作号及完整请求摘要核对本人设置保存结果；旧回执只证明当时保存，当前值另用read读取，不换号重放未知操作。",
};
export const goalSharePreferenceToolDefinitions = actions.map(action => ({ name: `aidesk_goal_share_preference_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action],
    inputSchema: { type: "object", additionalProperties: false,
        properties: { contract: { type: "string", enum: [GOAL_SHARE_PREFERENCE_CONTRACT] }, ...fields[action] },
        required: ["contract", ...Object.keys(fields[action])] },
    annotations: { readOnlyHint: !goalSharePreferenceIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
