// Generated from services/authority-api/src/goal-network-scope-contract.ts; source SHA-256 c1b455b2b0bc96c42b7e7e7d867b59f4f8e5424fe2beb3f879d12baf1b0d8bbe.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Development-only pairing on the existing network owner. An invitation ID
 * is a reference, not a bearer grant or proof of a person's real identity.
 * Scope changes never admit formal service or start a trial. */
export const GOAL_NETWORK_SCOPE_CONTRACT = "aidesk-goal-network-scope-v1";
export const GOAL_NETWORK_SCOPE_PURPOSE = "synthetic-invited-pair";
export const GOAL_NETWORK_SCOPE_LIMITS = Object.freeze({ requestBytes: 12288, transportBytes: 32768 });
export class GoalNetworkScopeError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "协作范围请求无效。", payload_too_large: "协作范围请求过大。", scope_denied: "当前账号不能办理此协作范围。",
            version_conflict: "邀请或范围状态已变更，请读取当前状态。", idempotency_conflict: "原操作号对应的请求不一致。",
            unavailable: "暂时无法读取协作范围。", outcome_unknown: "范围操作结果尚不确定，请沿原号对账。",
            cancelled: "读取或尚未发送的请求已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalNetworkScopeError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const prefix = ["contract", "action"];
const write = [...prefix, "operationId", "cohortId"];
export const goalNetworkScopeIsWrite = (action) => action !== "read" && action !== "operation";
export function parseGoalNetworkScopeInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_NETWORK_SCOPE_LIMITS.requestBytes)
            throw new GoalNetworkScopeError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_NETWORK_SCOPE_LIMITS.requestBytes);
    }
    catch (e) {
        throw e instanceof GoalNetworkScopeError ? e : new GoalNetworkScopeError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_NETWORK_SCOPE_CONTRACT && v.action === action) {
        if (action === "read")
            valid = exact(v, [...prefix, "cohortId"]) && uuid(v.cohortId);
        else if (action === "operation")
            valid = exact(v, [...prefix, "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
        else if (uuid(v.operationId) && uuid(v.cohortId)) {
            if (action === "invite")
                valid = exact(v, write);
            if (action === "request")
                valid = exact(v, [...write, "requestId", "expectedVersion"]) && uuid(v.requestId) && v.expectedVersion === 1;
            if (action === "accept")
                valid = exact(v, [...write, "requestId", "participantId", "expectedVersion"])
                    && uuid(v.requestId) && uuid(v.participantId) && v.expectedVersion === 2;
            if (action === "leave")
                valid = exact(v, [...write, "expectedVersion"]) && integer(v.expectedVersion, 1, 3);
        }
    }
    if (!valid)
        throw new GoalNetworkScopeError("invalid_input");
    return v;
}
function receipt(v, operationId, digest) {
    if (!(exact(v, ["contract", "action", "status", "operationId", "requestSha256", "request", "recordedAt", "cohortId", "scopeVersion"])
        && v.contract === GOAL_NETWORK_SCOPE_CONTRACT && v.status === "recorded" && v.operationId === operationId && v.requestSha256 === digest
        && uuid(v.cohortId) && isTimestamp(v.recordedAt) && integer(v.scopeVersion, 1, 4)))
        return false;
    let request;
    try {
        request = parseGoalNetworkScopeInput(v.action, v.request);
    }
    catch {
        return false;
    }
    if (request.action === "operation" || request.action === "read")
        return false;
    const version = request.action === "invite" ? 1 : request.action === "request" ? 2 : request.action === "accept" ? 3 : request.expectedVersion + 1;
    return request.operationId === operationId && request.cohortId === v.cohortId && version === v.scopeVersion
        && teachingRequestSha256(request) === digest;
}
function scope(v, cohortId) {
    if (!(exact(v, ["cohortId", "purpose", "usage", "version", "state", "self", "inviterId", "candidate", "createdAt", "expiresAt", "closedAt", "contentAvailable"])
        && v.cohortId === cohortId && v.purpose === GOAL_NETWORK_SCOPE_PURPOSE && v.usage === "synthetic-test-reuse-v1"
        && integer(v.version, 1, 4) && typeof v.state === "string" && ["pending", "requested", "active", "closed", "expired"].includes(v.state)
        && (v.self === "inviter" || v.self === "candidate") && uuid(v.inviterId) && isTimestamp(v.createdAt) && isTimestamp(v.expiresAt)
        && Date.parse(v.expiresAt) - Date.parse(v.createdAt) === 86400000 && typeof v.contentAvailable === "boolean"))
        return false;
    const candidate = v.candidate;
    if (candidate !== null && !(exact(candidate, ["requestId", "participantId"]) && uuid(candidate.requestId)
        && uuid(candidate.participantId) && candidate.participantId !== v.inviterId))
        return false;
    if (v.self === "candidate" && candidate === null || v.contentAvailable && v.state !== "active")
        return false;
    if (v.state === "closed")
        return isTimestamp(v.closedAt) && Date.parse(v.closedAt) >= Date.parse(v.createdAt)
            && (v.version === 2 && candidate === null || (v.version === 3 || v.version === 4) && candidate !== null);
    if (v.closedAt !== null)
        return false;
    if (v.state === "active")
        return v.version === 3 && candidate !== null;
    if (v.state === "pending")
        return v.version === 1 && candidate === null;
    if (v.state === "requested")
        return v.version === 2 && candidate !== null;
    return v.version === 1 && candidate === null || v.version === 2 && candidate !== null;
}
export function validGoalNetworkScopeResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_NETWORK_SCOPE_CONTRACT)
        return false;
    if (action === "read") {
        const p = input;
        return exact(v, ["contract", "status", "scope"]) && (v.status === "not_found" ? v.scope === null : v.status === "found" && scope(v.scope, p.cohortId));
    }
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                    && receipt(v.receipt, p.operationId, p.requestSha256));
    }
    const p = input;
    return exact(v, ["contract", "status", "receipt"]) && v.status === "recorded" && receipt(v.receipt, p.operationId, teachingRequestSha256(p))
        && v.receipt.action === action && canonicalTeachingJson(v.receipt.request) === canonicalTeachingJson(p);
}
const actions = ["invite", "request", "accept", "leave", "read", "operation"];
export const goalNetworkScopeToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_network_scope_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const choice = (...values) => ({ type: "string", enum: values });
const fields = {
    invite: { operationId: id, cohortId: id },
    request: { operationId: id, cohortId: id, requestId: id, expectedVersion: { type: "integer", enum: [1] } },
    accept: { operationId: id, cohortId: id, requestId: id, participantId: id, expectedVersion: { type: "integer", enum: [2] } },
    leave: { operationId: id, cohortId: id, expectedVersion: { type: "integer", minimum: 1, maximum: 3 } },
    read: { cohortId: id }, operation: { operationId: id, requestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } },
};
const descriptions = {
    invite: "获准合成账号建立新的空双人邀请；引用不是访问凭证，双方确认前不开放内容，不启动试用。",
    request: "本人自愿申请准确邀请；服务记录实际认证主体，只允许一位候选，申请不授内容权。",
    accept: "发起者核对实际申请后确认准确requestId及participantId；只打开这个新范围，不授家长权或个人目标访问。",
    leave: "本人关闭此邀请或退出范围；范围永久关闭，不换成员或恢复旧内容，已合法采用的本人副本另按原合同保留。",
    read: "读取本人发起或申请的范围当前状态；历史操作回执不能代替当前可用权限，参与者别名不证明现实身份。",
    operation: "沿原操作号和完整请求摘要读取本人历史回执；未知先对账，不换号重发或重新激活邀请。",
};
export const goalNetworkScopeToolDefinitions = actions.map(action => ({ name: `aidesk_goal_network_scope_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action],
    inputSchema: { type: "object", additionalProperties: false,
        properties: { contract: choice(GOAL_NETWORK_SCOPE_CONTRACT), action: choice(action), ...fields[action] },
        required: [...prefix, ...Object.keys(fields[action])] },
    annotations: { readOnlyHint: !goalNetworkScopeIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
