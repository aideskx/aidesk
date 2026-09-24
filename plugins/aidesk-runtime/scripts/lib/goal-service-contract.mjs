// Generated from services/authority-api/src/goal-service-contract.ts; source SHA-256 ab52520bb8e15434cd93827bdd1fda9d478c685a034676cf54db75aacf819a14.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Non-authoritative service acceptance contract. The cooperate call means
 * accepting collaboration the user has authorized; obtaining that authorization
 * belongs to the natural Plugin interaction, not a boolean or new evidence flow.
 * No prompt, material body, actor or trial date is input. */
export const GOAL_SERVICE_CONTRACT = "aidesk-goal-service-v1";
// Explicitly selected by a current goal consumer; neither a Plugin version nor
// a client-side subscription observation selects the SQL account policy.
export const GOAL_PLATFORM_SERVICE_CONTRACT = "aidesk-goal-service-v2";
export const GOAL_SERVICE_LIMITS = Object.freeze({ requestBytes: 2048, transportBytes: 8192 });
export class GoalServiceError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ goal_deleted: "该目标内容已删除，不能重放写入；保留原号核对旧操作。", invalid_input: "协作受理请求无效。", payload_too_large: "协作受理请求超过大小限制。",
            scope_denied: "当前账号无权访问此范围。", feature_unavailable: "当前账号不能新增书桌服务协作。",
            version_conflict: "目标已修订，请核对当前目标后发起协作。", idempotency_conflict: "原操作号对应的请求不一致。",
            unavailable: "暂时无法读取受理结果。", outcome_unknown: "受理结果尚不确定，请用原操作号和摘要对账。",
            cancelled: "请求在发送前或读取完成前已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalServiceError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const reference = (v) => v === null || exact(v, ["goalId", "version"])
    && uuid(v.goalId) && Number.isSafeInteger(v.version) && Number(v.version) >= 1 && Number(v.version) <= 2147483647;
export function parseGoalServiceInput(action, input) {
    let v;
    try {
        const wire = typeof input === "string" ? input : canonicalTeachingJson(input);
        if (Buffer.byteLength(wire) > GOAL_SERVICE_LIMITS.requestBytes)
            throw new GoalServiceError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_SERVICE_LIMITS.requestBytes);
    }
    catch (e) {
        throw e instanceof GoalServiceError ? e : new GoalServiceError("invalid_input");
    }
    if (!(teachingObject(v) && (v.contract === GOAL_SERVICE_CONTRACT || v.contract === GOAL_PLATFORM_SERVICE_CONTRACT) && uuid(v.operationId)
        && (action === "cooperate" && exact(v, ["contract", "operationId", "goalRef"])
            && reference(v.goalRef)
            || action === "operation" && exact(v, ["contract", "operationId", "requestSha256"]) && hash(v.requestSha256))))
        throw new GoalServiceError("invalid_input");
    return v;
}
// SQL observation timestamps retain microseconds, including a valid active
// term shorter than one millisecond. This validates a receipt, not current rights.
function micros(value) {
    if (!isTimestamp(value))
        return;
    const part = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
    if (!part)
        return;
    return BigInt(Date.parse(value)) * 1000n + BigInt((part[2] ?? "").padEnd(6, "0").slice(3));
}
function receipt(v, contract, operationId, digest) {
    if (!(exact(v, ["contract", "status", "action", "operationId", "requestSha256", "goalRef", "acceptedAt", "entitlement"])
        && v.contract === contract && v.status === "accepted" && v.action === "cooperate"
        && v.operationId === operationId && v.requestSha256 === digest && reference(v.goalRef) && isTimestamp(v.acceptedAt)))
        return false;
    const a = v.entitlement;
    if (contract === GOAL_SERVICE_CONTRACT) {
        if (!exact(a, ["state", "checkedAt", "startsAt", "expiresAt"]) || !(a.state === "active" || a.state === "annual")
            || !isTimestamp(a.checkedAt) || !isTimestamp(a.startsAt) || !isTimestamp(a.expiresAt)
            || v.acceptedAt !== a.checkedAt || Date.parse(a.startsAt) > Date.parse(a.checkedAt) || Date.parse(a.checkedAt) >= Date.parse(a.expiresAt))
            return false;
    }
    else {
        if (!exact(a, ["contract", "scope", "basis", "policyId", "state", "checkedAt", "effectiveAt", "expiresAt"])
            || a.contract !== "aidesk-platform-subscription-local-v1" || a.scope !== "synthetic-only"
            || a.basis !== "platform_annual_local" || a.policyId !== "platform-subscription-local-v1" || a.state !== "active"
            || v.acceptedAt !== a.checkedAt)
            return false;
        const checked = micros(a.checkedAt), effective = micros(a.effectiveAt), expires = micros(a.expiresAt);
        if (checked === undefined || effective === undefined || expires === undefined || effective > checked || checked >= expires)
            return false;
    }
    // Original contract and goal participate in the canonical digest. Recovery
    // must not relabel a v1 receipt or substitute a platform request/goal.
    return teachingRequestSha256({ contract, operationId, goalRef: v.goalRef }) === digest;
}
export function validGoalServiceResult(action, value, input) {
    if (action === "cooperate")
        return receipt(value, input.contract, input.operationId, teachingRequestSha256(input));
    const p = input;
    return teachingObject(value) && value.contract === p.contract && value.operationId === p.operationId && value.requestSha256 === p.requestSha256
        && (value.status === "not_found" && value.terminal === false && exact(value, ["contract", "status", "terminal", "operationId", "requestSha256"])
            || value.status === "completed" && value.terminal === true && exact(value, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"])
                && receipt(value.receipt, p.contract, p.operationId, p.requestSha256));
}
export const goalServiceToolAction = (name) => name === "aidesk_goal_service_cooperate" ? "cooperate"
    : name === "aidesk_goal_service_operation" ? "operation" : undefined;
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const base = { contract: { enum: [GOAL_SERVICE_CONTRACT, GOAL_PLATFORM_SERVICE_CONTRACT] }, operationId: id };
export const goalServiceToolDefinitions = [
    { name: "aidesk_goal_service_cooperate", description: "仅在用户已确认开展后受理本人书桌协作，v1旧资格首次成功受理按账号起算试用。可不建立长期目标；不创建或证明宿主任务。不重复询问已获授权，也不声称服务独立核验了人类意图。v1保留旧权益；明确v2仅消费本人当前平台订阅，不发试用。结果未知沿原合同和操作号对账。",
        inputSchema: obj({ ...base,
            goalRef: { anyOf: [obj({ goalId: id, version: { type: "integer", minimum: 1, maximum: 2147483647 } }), { type: "null" }] } }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_service_operation", description: "按本人原受理操作号和完整请求摘要对账；旧受理回执不授予新的协作权益，未找到不是取消终态。",
        inputSchema: obj({ ...base, requestSha256: sha }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
