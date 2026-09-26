// Generated from services/authority-api/src/goal-community-contract.ts; source SHA-256 1f7ffd0f9ef6767918e039fcf21a28ac6a898e7c8c8efa9932ea32afbc6b3ab2.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Versioned public consumer of the existing goal-network owner. The selected
 * finalization is the only body source; this is not a second private-goal store. */
export const GOAL_COMMUNITY_CONTRACT = "aidesk-goal-community-v1";
export const GOAL_COMMUNITY_USAGE = "reference-only-v1";
export const GOAL_COMMUNITY_LIMITS = Object.freeze({ requestBytes: 4096, transportBytes: 32768, minBudget: 1024, maxBudget: 24576,
    queryBytes: 128, titleBytes: 160, textBytes: 8192 });
export class GoalCommunityError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "目标社区请求无效。", payload_too_large: "目标社区请求超过大小限制。", scope_denied: "当前账号无权执行此社区操作。",
            feature_unavailable: "当前没有新增社区服务权益。", version_conflict: "目标定稿或公开状态已变更，请读取当前事实。",
            idempotency_conflict: "原操作号对应的请求不一致。", goal_deleted: "该私人目标已删除，不能重新公开；保留原号核对旧操作。",
            budget_too_small: "读取预算不足以容纳此记录。", cancelled: "读取或尚未发送的请求已取消。",
            unavailable: "暂时无法读取目标社区。", outcome_unknown: "社区操作结果尚不确定，请沿原号和完整请求摘要对账。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalCommunityError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v, max, body = false) => typeof v === "string" && v.isWellFormed() && v.trim().length > 0
    && !(body ? /[^\P{Cc}\r\n\t]/u : /\p{Cc}/u).test(v) && Buffer.byteLength(v) <= max;
const budget = (v) => integer(v, GOAL_COMMUNITY_LIMITS.minBudget, GOAL_COMMUNITY_LIMITS.maxBudget);
const prefix = ["contract", "action"];
export const goalCommunityIsWrite = (action) => action === "publish" || action === "close" || action === "reopen";
export function parseGoalCommunityInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_COMMUNITY_LIMITS.requestBytes)
            throw new GoalCommunityError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_COMMUNITY_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalCommunityError ? error : new GoalCommunityError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_COMMUNITY_CONTRACT && v.action === action) {
        if (action === "publish" || action === "reopen")
            valid = exact(v, [...prefix, "operationId", "goalId", "expectedStateVersion", "expectedPublicVersion", "finalizationVersion", "projectionSha256"])
                && uuid(v.operationId) && uuid(v.goalId) && integer(v.expectedStateVersion, 0, 2147483646) && integer(v.expectedPublicVersion, 0, 2147483646)
                && integer(v.finalizationVersion) && hash(v.projectionSha256);
        if (action === "close")
            valid = exact(v, [...prefix, "operationId", "goalId", "expectedStateVersion"])
                && uuid(v.operationId) && uuid(v.goalId) && integer(v.expectedStateVersion, 0, 2147483646);
        if (action === "state")
            valid = exact(v, [...prefix, "goalId"]) && uuid(v.goalId);
        if (action === "discover")
            valid = exact(v, [...prefix, "view", "afterId", "limit", "budgetBytes", "query"])
                && (v.view === "public" || v.view === "own") && (v.afterId === null || uuid(v.afterId)) && integer(v.limit, 1, 16) && budget(v.budgetBytes)
                && (v.query === null || v.view === "public" && text(v.query, GOAL_COMMUNITY_LIMITS.queryBytes));
        if (action === "read")
            valid = exact(v, [...prefix, "publicId", "publicVersion", "budgetBytes"])
                && uuid(v.publicId) && integer(v.publicVersion) && budget(v.budgetBytes);
        if (action === "operation")
            valid = exact(v, [...prefix, "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
    }
    if (!valid)
        throw new GoalCommunityError("invalid_input");
    return v;
}
export function validGoalCommunityPublication(v) {
    return exact(v, ["publicId", "state", "stateVersion", "publicVersion", "finalizationVersion", "projectionSha256", "createdAt", "updatedAt", "closedAt"])
        && uuid(v.publicId) && (v.state === "published" || v.state === "closed") && integer(v.stateVersion) && integer(v.publicVersion, 0)
        && (v.publicVersion === 0 ? v.finalizationVersion === null && v.projectionSha256 === null : integer(v.finalizationVersion) && hash(v.projectionSha256))
        && (v.state !== "published" || v.publicVersion > 0) && isTimestamp(v.createdAt) && isTimestamp(v.updatedAt)
        && Date.parse(v.createdAt) <= Date.parse(v.updatedAt)
        && (v.state === "closed" ? isTimestamp(v.closedAt) && v.closedAt === v.updatedAt : v.closedAt === null);
}
function finalization(v) {
    return exact(v, ["version", "goalVersion", "sharingEnabled", "projectionSha256"]) && integer(v.version) && integer(v.goalVersion)
        && (v.sharingEnabled === true ? hash(v.projectionSha256) : (v.sharingEnabled === false || v.sharingEnabled === null) && v.projectionSha256 === null);
}
/** The full body-free request is retained, so its digest is independently
 * reconstructible even after the selected public projection is unavailable. */
export function validGoalCommunityReceipt(v, operationId, requestSha256) {
    if (!(exact(v, [...prefix, "status", "operationId", "requestSha256", "request", "publication", "recordedAt"])
        && v.contract === GOAL_COMMUNITY_CONTRACT && v.status === "recorded" && v.operationId === operationId && v.requestSha256 === requestSha256
        && isTimestamp(v.recordedAt) && validGoalCommunityPublication(v.publication)))
        return false;
    let p;
    try {
        if (!(v.action === "publish" || v.action === "close" || v.action === "reopen"))
            return false;
        p = parseGoalCommunityInput(v.action, v.request);
    }
    catch {
        return false;
    }
    const publication = v.publication;
    if (p.operationId !== operationId || teachingRequestSha256(p) !== requestSha256 || publication.publicId === p.goalId
        || Date.parse(publication.updatedAt) > Date.parse(v.recordedAt))
        return false;
    if (p.action === "close")
        return publication.state === "closed"
            && (publication.stateVersion === p.expectedStateVersion || publication.stateVersion === p.expectedStateVersion + 1)
            && (p.expectedStateVersion !== 0 || publication.stateVersion === 1 && publication.publicVersion === 0);
    if (publication.state !== "published" || publication.finalizationVersion !== p.finalizationVersion || publication.projectionSha256 !== p.projectionSha256)
        return false;
    if (p.action === "reopen")
        return p.expectedStateVersion > 0 && publication.stateVersion === p.expectedStateVersion + 1
            && publication.publicVersion === p.expectedPublicVersion + 1;
    return p.expectedStateVersion === 0 ? p.expectedPublicVersion === 0 && publication.stateVersion === 1 && publication.publicVersion === 1
        : p.expectedPublicVersion > 0 && publication.stateVersion === p.expectedStateVersion
            && (publication.publicVersion === p.expectedPublicVersion || publication.publicVersion === p.expectedPublicVersion + 1);
}
function publicSummary(v) {
    return exact(v, ["publicId", "publicVersion", "authorId", "title", "preview", "projectionSha256", "publishedAt"])
        && uuid(v.publicId) && integer(v.publicVersion) && uuid(v.authorId) && text(v.title, GOAL_COMMUNITY_LIMITS.titleBytes)
        && typeof v.preview === "string" && v.preview.isWellFormed() && v.preview.length > 0 && Array.from(v.preview).length <= 96
        && !/[^\P{Cc}\r\n\t]/u.test(v.preview) && Buffer.byteLength(v.preview) <= 384 && hash(v.projectionSha256) && isTimestamp(v.publishedAt);
}
function publicItem(v) {
    return exact(v, ["publicId", "publicVersion", "authorId", "title", "text", "projectionSha256", "usage", "publishedAt"])
        && uuid(v.publicId) && integer(v.publicVersion) && uuid(v.authorId) && text(v.title, GOAL_COMMUNITY_LIMITS.titleBytes)
        && text(v.text, GOAL_COMMUNITY_LIMITS.textBytes, true) && v.projectionSha256 === teachingRequestSha256({ title: v.title, text: v.text })
        && v.usage === GOAL_COMMUNITY_USAGE && isTimestamp(v.publishedAt);
}
export function validGoalCommunityResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_COMMUNITY_CONTRACT)
        return false;
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                    && validGoalCommunityReceipt(v.receipt, p.operationId, p.requestSha256));
    }
    if (goalCommunityIsWrite(action)) {
        const p = input;
        return exact(v, ["contract", "status", "receipt"]) && v.status === "recorded" && validGoalCommunityReceipt(v.receipt, p.operationId, teachingRequestSha256(p))
            && v.receipt.action === action && canonicalTeachingJson(v.receipt.request) === canonicalTeachingJson(p);
    }
    if (action === "state") {
        const p = input;
        if (v.goalId !== p.goalId)
            return false;
        if (v.status === "not_found")
            return exact(v, ["contract", "status", "goalId"]);
        if (!(exact(v, ["contract", "status", "goalId", "finalization", "publication", "available"]) && v.status === "found"
            && (v.finalization === null || finalization(v.finalization)) && (v.publication === null || validGoalCommunityPublication(v.publication))
            && typeof v.available === "boolean"))
            return false;
        const f = v.finalization, publication = v.publication;
        return (publication === null || publication.publicId !== p.goalId && (publication.finalizationVersion === null
            || f !== null && publication.finalizationVersion <= f.version))
            && (!v.available || f !== null && f.sharingEnabled === true && publication !== null && publication.state === "published"
                && publication.finalizationVersion === f.version && publication.projectionSha256 === f.projectionSha256);
    }
    if (action === "discover") {
        const p = input;
        if (!(exact(v, ["contract", "status", "view", "items", "nextAfterId"]) && v.status === "listed" && v.view === p.view
            && Array.isArray(v.items) && v.items.length <= p.limit && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
            return false;
        let previous = p.afterId ?? "";
        const goals = new Set();
        for (const row of v.items) {
            let publicId;
            if (p.view === "public") {
                if (!publicSummary(row))
                    return false;
                publicId = row.publicId;
            }
            else {
                if (!(exact(row, ["goalId", "publication", "available"]) && uuid(row.goalId) && validGoalCommunityPublication(row.publication)
                    && row.publication.publicId !== row.goalId && typeof row.available === "boolean" && (!row.available || row.publication.state === "published")
                    && !goals.has(row.goalId)))
                    return false;
                goals.add(row.goalId);
                publicId = row.publication.publicId;
            }
            if (publicId <= previous)
                return false;
            previous = publicId;
        }
        return v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous;
    }
    const p = input;
    if (!(exact(v, ["contract", "status", "publicId", "publicVersion", "item"]) && v.publicId === p.publicId && v.publicVersion === p.publicVersion
        && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
        return false;
    return v.status === "not_found" ? v.item === null : v.status === "found" && publicItem(v.item)
        && v.item.publicId === p.publicId && v.item.publicVersion === p.publicVersion;
}
const actions = ["publish", "close", "reopen", "state", "discover", "read", "operation"];
export const goalCommunityToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_community_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const int = (minimum = 1, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
const choice = (...values) => ({ type: "string", enum: values });
const intent = { operationId: id, goalId: id, expectedStateVersion: int(0, 2147483646), expectedPublicVersion: int(0, 2147483646), finalizationVersion: int(), projectionSha256: sha };
const fields = {
    publish: intent, reopen: intent, close: { operationId: id, goalId: id, expectedStateVersion: int(0, 2147483646) }, state: { goalId: id },
    discover: { view: choice("public", "own"), afterId: nullable(id), limit: int(1, 16), budgetBytes: int(1024, 24576),
        query: { ...nullable({ type: "string", minLength: 1, maxLength: 128 }), description: "public可按标题查找非空短语，最多128 UTF-8字节，字面匹配；own必须null。换短语从afterId:null开始。" } },
    read: { publicId: id, publicVersion: int(), budgetBytes: int(1024, 24576) }, operation: { operationId: id, requestSha256: sha },
};
const descriptions = {
    publish: "按本人已确认的当前定稿预览首次公开或更新同一公开目标；正文由服务取值，核当前权益和版本。已关闭对象不能由此重开，未知沿原号核对。",
    close: "按本人意愿关闭准确目标的公开状态；未曾公开也建立关闭屏障，不要求新定稿或订阅，不删除私人任务或他人合法副本。",
    reopen: "仅按本人本次明确重新开启意愿，绑定当前关闭状态、公开版本和当前定稿预览重开同一公开目标；核当前社区资格及权益。",
    state: "只读本人目标当前定稿元数据、稳定公开映射及当前可见性；无正文，历史发布回执不能替代此状态。",
    discover: "按需浏览或按标题查找当前可见公开摘要；own找回本人公开映射及关闭状态，不要求购买或重新发表，不把公开身份当私人目标ID。",
    read: "只读准确公开目标的当前公开版本；重新核源状态、社区资格及适用权益，不提供历史失权正文或私人目标资料，不新增试用。",
    operation: "按本人原号和完整原请求摘要核对公开、关闭或重开的历史元数据；不附正文，不授当前可见权，not_found不等于终态。",
};
export const goalCommunityToolDefinitions = actions.map(action => {
    const properties = { contract: choice(GOAL_COMMUNITY_CONTRACT), action: choice(action), ...fields[action] };
    return { name: `aidesk_goal_community_${action}`, title: descriptions[action].split("；")[0], description: descriptions[action],
        inputSchema: { type: "object", additionalProperties: false, properties, required: Object.keys(properties) },
        annotations: { readOnlyHint: !goalCommunityIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } };
});
