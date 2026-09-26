// Generated from services/authority-api/src/goal-community-interaction-contract.ts; source SHA-256 ed32ddadac4dd39eed1702e80cd4f9f1136920baa3497bc7c090594bfcd77ec4.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Thin interactions under the existing network owner. Adoption associates an
 * exact reference with the actor's finalization; it never copies source text. */
export const GOAL_COMMUNITY_INTERACTION_CONTRACT = "aidesk-goal-community-interaction-v1";
export const GOAL_COMMUNITY_INTERACTION_USAGE = "reference-only-v1";
export const GOAL_COMMUNITY_INTERACTION_LIMITS = Object.freeze({ requestBytes: 4096, transportBytes: 32768, minBudget: 1024, maxBudget: 24576 });
export class GoalCommunityInteractionError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "社区互动请求无效。", payload_too_large: "社区互动请求超过大小限制。", scope_denied: "当前账号无权执行此社区互动。",
            feature_unavailable: "当前没有新增社区服务权益。", version_conflict: "目标定稿、公开来源或本人关系已变更，请读取当前事实。",
            idempotency_conflict: "原操作号对应的请求不一致。", goal_deleted: "该本人目标已删除，不能新增采用关联。",
            content_deleted: "该代关系或采用资料已清除，旧操作不能恢复内容或重新执行。", budget_too_small: "读取预算不足以容纳此记录。",
            cancelled: "读取或尚未发送的请求已取消。", unavailable: "暂时无法读取本人社区互动。",
            outcome_unknown: "社区互动结果尚不确定，请沿原号和完整请求摘要对账。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalCommunityInteractionError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const prefix = ["contract", "action"];
function source(v) {
    return exact(v, ["publicId", "publicVersion", "projectionSha256"]) && uuid(v.publicId) && integer(v.publicVersion) && hash(v.projectionSha256);
}
function goalRef(v) {
    return exact(v, ["goalId", "finalizationVersion"]) && uuid(v.goalId) && integer(v.finalizationVersion);
}
function page(v) {
    return (v.afterId === null || uuid(v.afterId)) && integer(v.limit, 1, 16)
        && integer(v.budgetBytes, GOAL_COMMUNITY_INTERACTION_LIMITS.minBudget, GOAL_COMMUNITY_INTERACTION_LIMITS.maxBudget);
}
export const goalCommunityInteractionIsWrite = (action) => action === "adopt" || action === "relation_set";
export function parseGoalCommunityInteractionInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_COMMUNITY_INTERACTION_LIMITS.requestBytes)
            throw new GoalCommunityInteractionError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_COMMUNITY_INTERACTION_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalCommunityInteractionError ? error : new GoalCommunityInteractionError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_COMMUNITY_INTERACTION_CONTRACT && v.action === action) {
        if (action === "adopt")
            valid = exact(v, [...prefix, "operationId", "source", "goalRef"]) && uuid(v.operationId) && source(v.source) && goalRef(v.goalRef);
        if (action === "adoptions")
            valid = exact(v, [...prefix, "goalId", "afterId", "limit", "budgetBytes"]) && (v.goalId === null || uuid(v.goalId)) && page(v);
        if (action === "relation_set")
            valid = exact(v, [...prefix, "operationId", "publicId", "kind", "enabled", "expectedGeneration", "expectedVersion", "source"])
                && uuid(v.operationId) && uuid(v.publicId) && (v.kind === "like" || v.kind === "bookmark") && integer(v.expectedGeneration, 1, 2147483646)
                && integer(v.expectedVersion, 0, 2147483646) && (v.enabled === true ? source(v.source) && v.source.publicId === v.publicId : v.enabled === false && v.source === null);
        if (action === "state")
            valid = exact(v, [...prefix, "publicId"]) && uuid(v.publicId);
        if (action === "bookmarks")
            valid = exact(v, [...prefix, "afterId", "limit", "budgetBytes"]) && page(v);
        if (action === "operation")
            valid = exact(v, [...prefix, "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
    }
    if (!valid)
        throw new GoalCommunityInteractionError("invalid_input");
    return v;
}
export function validGoalCommunityInteractionAdoption(v) {
    return exact(v, ["adoptionId", "source", "authorId", "goalRef", "usage", "createdAt"]) && uuid(v.adoptionId) && source(v.source)
        && uuid(v.authorId) && goalRef(v.goalRef) && v.usage === GOAL_COMMUNITY_INTERACTION_USAGE && isTimestamp(v.createdAt);
}
export function validGoalCommunityInteractionRelation(v, virtual = false) {
    return exact(v, ["publicId", "generation", "kind", "version", "enabled", "source", "updatedAt"]) && uuid(v.publicId) && integer(v.generation, 1, virtual ? 2147483647 : 2147483646)
        && (v.kind === "like" || v.kind === "bookmark") && integer(v.version, virtual ? 0 : 1)
        && (v.generation !== 2147483647 || v.version === 0)
        && (v.enabled === true ? source(v.source) && v.source.publicId === v.publicId : v.enabled === false && v.source === null)
        && (v.version === 0 ? v.enabled === false && v.updatedAt === null : isTimestamp(v.updatedAt));
}
function summary(v) {
    return exact(v, ["publicId", "publicVersion", "authorId", "title", "preview", "projectionSha256", "publishedAt"])
        && uuid(v.publicId) && integer(v.publicVersion) && uuid(v.authorId) && typeof v.title === "string" && v.title.isWellFormed()
        && v.title.trim().length > 0 && !/\p{Cc}/u.test(v.title) && Buffer.byteLength(v.title) <= 160
        && typeof v.preview === "string" && v.preview.isWellFormed() && v.preview.length > 0 && Array.from(v.preview).length <= 96
        && !/[^\P{Cc}\r\n\t]/u.test(v.preview) && Buffer.byteLength(v.preview) <= 384 && hash(v.projectionSha256) && isTimestamp(v.publishedAt);
}
function erased(v) {
    if (!(exact(v, [...prefix, "status", "terminal", "operationId", "requestSha256", "target", "erasedAt"])
        && v.status === "erased" && v.terminal === true && isTimestamp(v.erasedAt)))
        return false;
    const target = v.target;
    return v.action === "adopt" ? exact(target, ["kind", "goalId"]) && target.kind === "goal" && uuid(target.goalId)
        : v.action === "relation_set" && exact(target, ["kind", "publicId", "generation"]) && target.kind === "community_relationships"
            && uuid(target.publicId) && integer(target.generation, 1, 2147483646);
}
/** Each live receipt retains the complete body-free original for independent
 * digest reconstruction. An erased result is a separate terminal fact. */
export function validGoalCommunityInteractionReceipt(v, operationId, requestSha256) {
    if (!teachingObject(v) || !(v.action === "adopt" || v.action === "relation_set")
        || !exact(v, [...prefix, "status", "operationId", "requestSha256", "request", v.action === "adopt" ? "adoption" : "relation", "recordedAt"])
        || v.contract !== GOAL_COMMUNITY_INTERACTION_CONTRACT || v.status !== "recorded" || v.operationId !== operationId
        || v.requestSha256 !== requestSha256 || !isTimestamp(v.recordedAt))
        return false;
    let p;
    try {
        p = parseGoalCommunityInteractionInput(v.action, v.request);
    }
    catch {
        return false;
    }
    if (p.operationId !== operationId || teachingRequestSha256(p) !== requestSha256)
        return false;
    if (p.action === "adopt")
        return validGoalCommunityInteractionAdoption(v.adoption) && same(v.adoption.source, p.source)
            && same(v.adoption.goalRef, p.goalRef) && Date.parse(v.adoption.createdAt) <= Date.parse(v.recordedAt);
    const r = v.relation;
    return validGoalCommunityInteractionRelation(r) && r.publicId === p.publicId && r.generation === p.expectedGeneration && r.kind === p.kind
        && r.enabled === p.enabled && same(r.source, p.source) && r.version === p.expectedVersion + 1 && Date.parse(r.updatedAt) <= Date.parse(v.recordedAt);
}
export function validGoalCommunityInteractionResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_COMMUNITY_INTERACTION_CONTRACT)
        return false;
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                    && validGoalCommunityInteractionReceipt(v.receipt, p.operationId, p.requestSha256) || erased(v));
    }
    if (goalCommunityInteractionIsWrite(action)) {
        const p = input;
        return exact(v, ["contract", "status", "receipt"]) && v.status === "recorded"
            && validGoalCommunityInteractionReceipt(v.receipt, p.operationId, teachingRequestSha256(p)) && v.receipt.action === action && same(v.receipt.request, p);
    }
    if (action === "state") {
        const p = input;
        if (!(exact(v, ["contract", "status", "publicId", "generation", "like", "bookmark", "source", "likeCount"])
            && v.status === "read" && v.publicId === p.publicId && integer(v.generation)))
            return false;
        for (const kind of ["like", "bookmark"]) {
            const r = v[kind];
            if (!(validGoalCommunityInteractionRelation(r, true) && r.publicId === p.publicId && r.generation === v.generation && r.kind === kind))
                return false;
        }
        return v.source === null ? v.likeCount === null : summary(v.source) && v.source.publicId === p.publicId && integer(v.likeCount, 0);
    }
    const p = input;
    if (!(exact(v, ["contract", "status", ...(action === "adoptions" ? ["goalId"] : []), "items", "nextAfterId"]) && v.status === "listed"
        && Array.isArray(v.items) && v.items.length <= p.limit && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
        return false;
    if (action === "adoptions" && v.goalId !== p.goalId)
        return false;
    let previous = p.afterId ?? "";
    for (const row of v.items) {
        let id;
        if (action === "adoptions") {
            if (!(exact(row, ["adoption", "source"]) && validGoalCommunityInteractionAdoption(row.adoption)))
                return false;
            const a = row.adoption;
            if (v.goalId !== null && a.goalRef.goalId !== v.goalId)
                return false;
            if (row.source !== null && !(summary(row.source) && row.source.publicId === a.source.publicId && row.source.publicVersion === a.source.publicVersion
                && row.source.projectionSha256 === a.source.projectionSha256 && row.source.authorId === a.authorId))
                return false;
            id = a.adoptionId;
        }
        else {
            if (!(exact(row, ["relation", "source"]) && validGoalCommunityInteractionRelation(row.relation) && row.relation.kind === "bookmark" && row.relation.enabled))
                return false;
            if (row.source !== null && !(summary(row.source) && row.source.publicId === row.relation.publicId))
                return false;
            id = row.relation.publicId;
        }
        if (id <= previous)
            return false;
        previous = id;
    }
    return v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous;
}
const actions = ["adopt", "adoptions", "relation_set", "state", "bookmarks", "operation"];
export const goalCommunityInteractionToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_community_interaction_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const int = (minimum = 1, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
const choice = (...values) => ({ type: "string", enum: values });
const record = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const sourceSchema = record({ publicId: id, publicVersion: int(), projectionSha256: sha });
const pagination = { afterId: nullable(id), limit: int(1, 16), budgetBytes: int(1024, 24576) };
const fields = {
    adopt: { operationId: id, source: sourceSchema, goalRef: record({ goalId: id, finalizationVersion: int() }) },
    adoptions: { goalId: nullable(id), ...pagination },
    relation_set: { operationId: id, publicId: id, kind: choice("like", "bookmark"), enabled: { type: "boolean" }, expectedGeneration: int(1, 2147483646),
        expectedVersion: int(0, 2147483646), source: { ...nullable(sourceSchema), description: "启用时必须是本人已观察的准确当前来源且publicId相同；取消时必须null。" } },
    state: { publicId: id }, bookmarks: pagination, operation: { operationId: id, requestSha256: sha },
};
const descriptions = {
    adopt: "按本人明确意愿把准确公开来源关联到本人实际已定稿目标；仅reference-only来源引用，不复制正文或自动建立目标/任务，核当前来源和新增服务权益。",
    adoptions: "找回本人采用关联及其准确来源引用；不要求重新采用或购买，源当前仍可见且版本一致才附摘要，不授历史正文权限。",
    relation_set: "按本次明确意愿设置点赞或私有收藏，核本人关系代数和版本；取消不要求源仍可见或新增权益，也建立取消屏障，未知结果沿原号核对。",
    state: "读取本人当前代点赞和收藏状态；成功读取但尚未建立关系时返回虚拟第一代。仅当前可见源附摘要及点赞数，不返回收藏者名单。",
    bookmarks: "找回本人仍收藏的公开目标引用及当前可见摘要；源关闭或失权仍保留本人引用供清理，不返回正文或向作者披露收藏者。",
    operation: "按本人原号和完整摘要核对采用、点赞收藏的历史薄回执；已清除只返回擦除事实，不恢复内容或重放副作用，not_found不是终态。",
};
export const goalCommunityInteractionToolDefinitions = actions.map(action => ({ name: `aidesk_goal_community_interaction_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action], inputSchema: record({ contract: choice(GOAL_COMMUNITY_INTERACTION_CONTRACT), action: choice(action), ...fields[action] }),
    annotations: { readOnlyHint: !goalCommunityInteractionIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
