// Generated from services/authority-api/src/goal-community-comment-contract.ts; source SHA-256 5b8ca54122843303fdbdaf9d3c5494d3679b035faf8a1be3b6346bd53dabe0d8.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Comments belong to the existing network owner. Historical receipts contain
 * metadata only; they never grant current access to comment or source text. */
export const GOAL_COMMUNITY_COMMENT_CONTRACT = "aidesk-goal-community-comment-v1";
export const GOAL_COMMUNITY_COMMENT_LIMITS = Object.freeze({ requestBytes: 8192, transportBytes: 32768, textBytes: 2048, minBudget: 1024, maxBudget: 24576 });
export class GoalCommunityCommentError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "评论请求无效。", payload_too_large: "评论请求超过大小限制。", scope_denied: "当前账号无权执行此评论操作。",
            feature_unavailable: "当前没有读取讨论或新增评论的服务权益。", version_conflict: "公开来源已经变更，请重新读取当前目标。",
            idempotency_conflict: "原操作号或评论编号对应的请求不一致。", budget_too_small: "读取预算不足以容纳此评论记录。",
            content_deleted: "评论资料已清除，旧原号不能恢复正文。", comment_cancelled: "此评论原号已取消，迟到请求不能发表。",
            parent_unavailable: "原回复对象当前不可用，不能改为向其他对象发表。", cancelled: "读取或尚未发送的请求已取消。",
            unavailable: "暂时无法读取评论记录。", outcome_unknown: "评论操作结果尚不确定，请保留原号和完整请求摘要对账。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalCommunityCommentError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const nullableId = (v) => v === null || uuid(v);
const budget = (v) => integer(v, GOAL_COMMUNITY_COMMENT_LIMITS.minBudget, GOAL_COMMUNITY_COMMENT_LIMITS.maxBudget);
const page = (v) => nullableId(v.afterId) && integer(v.limit, 1, 16) && budget(v.budgetBytes);
function source(v) {
    return exact(v, ["publicId", "publicVersion", "projectionSha256"]) && uuid(v.publicId) && integer(v.publicVersion) && hash(v.projectionSha256);
}
function text(v) {
    return typeof v === "string" && v.isWellFormed() && v.trim().length > 0 && !/[^\P{Cc}\r\n\t]/u.test(v)
        && Buffer.byteLength(v) <= GOAL_COMMUNITY_COMMENT_LIMITS.textBytes;
}
export const goalCommunityCommentIsWrite = (action) => action === "create" || action === "cancel";
export function parseGoalCommunityCommentInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_COMMUNITY_COMMENT_LIMITS.requestBytes)
            throw new GoalCommunityCommentError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_COMMUNITY_COMMENT_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalCommunityCommentError ? error : new GoalCommunityCommentError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_COMMUNITY_COMMENT_CONTRACT) {
        if (goalCommunityCommentIsWrite(action))
            valid = exact(v, ["contract", "operationId", "commentId", "source", "parentCommentId", "text"])
                && uuid(v.operationId) && uuid(v.commentId) && source(v.source) && nullableId(v.parentCommentId) && v.parentCommentId !== v.commentId && text(v.text);
        if (action === "read")
            valid = exact(v, ["contract", "publicId", "commentId", "budgetBytes"]) && uuid(v.publicId) && uuid(v.commentId) && budget(v.budgetBytes);
        if (action === "thread" || action === "own")
            valid = exact(v, ["contract", "publicId", "afterId", "limit", "budgetBytes"])
                && (action === "own" ? nullableId(v.publicId) : uuid(v.publicId)) && page(v);
        if (action === "operation")
            valid = exact(v, ["contract", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
    }
    if (!valid)
        throw new GoalCommunityCommentError("invalid_input");
    return v;
}
export function goalCommunityCommentMetadata(p) {
    return { contract: p.contract, operationId: p.operationId, commentId: p.commentId, source: p.source,
        parentCommentId: p.parentCommentId, contentSha256: teachingRequestSha256({ text: p.text }) };
}
function metadata(v) {
    return exact(v, ["contract", "operationId", "commentId", "source", "parentCommentId", "contentSha256"])
        && v.contract === GOAL_COMMUNITY_COMMENT_CONTRACT && uuid(v.operationId) && uuid(v.commentId) && source(v.source)
        && nullableId(v.parentCommentId) && v.parentCommentId !== v.commentId && hash(v.contentSha256);
}
/** A metadata receipt cannot reconstruct a full request without its text.
 * Optional query identifiers bind this thin historical fact to its own lookup. */
export function validGoalCommunityCommentReceipt(v, operationId, requestSha256) {
    return exact(v, ["contract", "status", "operationId", "requestSha256", "requestRepresentation", "request", "authorId", "recordedAt"])
        && v.contract === GOAL_COMMUNITY_COMMENT_CONTRACT && uuid(v.operationId) && hash(v.requestSha256)
        && (operationId === undefined || v.operationId === operationId) && (requestSha256 === undefined || v.requestSha256 === requestSha256)
        && v.requestRepresentation === "metadata_only" && metadata(v.request) && v.request.operationId === v.operationId && isTimestamp(v.recordedAt)
        && (v.status === "recorded" ? uuid(v.authorId) : v.status === "cancelled" && v.authorId === null);
}
export function validGoalCommunityCommentItem(v) {
    return exact(v, ["commentId", "publicId", "source", "parentCommentId", "authorId", "createdAt", "status", "text", "contentSha256", "erasedAt"])
        && uuid(v.commentId) && uuid(v.publicId) && source(v.source) && v.source.publicId === v.publicId && nullableId(v.parentCommentId)
        && v.parentCommentId !== v.commentId && uuid(v.authorId) && isTimestamp(v.createdAt)
        && (v.status === "published" ? text(v.text) && hash(v.contentSha256) && teachingRequestSha256({ text: v.text }) === v.contentSha256 && v.erasedAt === null
            : v.text === null && v.contentSha256 === null && (v.status === "deleted" ? isTimestamp(v.erasedAt) : v.status === "unavailable" && v.erasedAt === null));
}
export function validGoalCommunityCommentOwnItem(v) {
    if (!exact(v, ["commentId", "publicId", "parentCommentId", "operationId", "requestSha256", "status", "recordedAt", "erasedAt", "source", "authorId", "contentSha256"])
        || !uuid(v.commentId) || !uuid(v.publicId) || !nullableId(v.parentCommentId) || v.parentCommentId === v.commentId || !uuid(v.operationId) || !hash(v.requestSha256) || !isTimestamp(v.recordedAt))
        return false;
    if (v.status === "erased")
        return v.source === null && v.contentSha256 === null && v.authorId === null && isTimestamp(v.erasedAt);
    return source(v.source) && v.source.publicId === v.publicId && hash(v.contentSha256) && v.erasedAt === null
        && (v.status === "recorded" ? uuid(v.authorId) : v.status === "cancelled" && v.authorId === null);
}
export function validGoalCommunityCommentResult(action, v, input) {
    try {
        const p = parseGoalCommunityCommentInput(action, input);
        if (!teachingObject(v) || v.contract !== GOAL_COMMUNITY_COMMENT_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_COMMUNITY_COMMENT_LIMITS.transportBytes)
            return false;
        if (action === "create" || action === "cancel") {
            const original = p;
            return validGoalCommunityCommentReceipt(v, original.operationId, teachingRequestSha256(original))
                && (action === "cancel" || v.status === "recorded") && same(v.request, goalCommunityCommentMetadata(original));
        }
        if (action === "operation") {
            const q = p;
            if (v.operationId !== q.operationId || v.requestSha256 !== q.requestSha256)
                return false;
            if (v.status === "erased")
                return exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "target", "erasedAt"])
                    && v.terminal === true && isTimestamp(v.erasedAt) && exact(v.target, ["kind", "publicId", "commentId"])
                    && v.target.kind === "community_comment" && uuid(v.target.publicId) && uuid(v.target.commentId);
            return v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"])
                    && v.terminal === true && validGoalCommunityCommentReceipt(v.receipt, q.operationId, q.requestSha256);
        }
        const query = p;
        if (v.publicId !== query.publicId || Buffer.byteLength(canonicalTeachingJson(v)) > query.budgetBytes)
            return false;
        if (action === "read")
            return exact(v, ["contract", "status", "publicId", "commentId", "item"])
                && v.commentId === query.commentId
                && (v.status === "not_found" ? v.item === null : v.status === "found" && validGoalCommunityCommentItem(v.item)
                    && v.item.publicId === v.publicId && v.item.commentId === v.commentId);
        const list = query;
        if (!exact(v, ["contract", "status", "publicId", "items", "nextAfterId"]) || v.status !== "listed" || !Array.isArray(v.items) || v.items.length > list.limit)
            return false;
        let previous = list.afterId ?? "";
        for (const item of v.items) {
            if (!(action === "own" ? validGoalCommunityCommentOwnItem(item) : validGoalCommunityCommentItem(item))
                || list.publicId !== null && item.publicId !== list.publicId || item.commentId <= previous)
                return false;
            previous = item.commentId;
        }
        return v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous;
    }
    catch {
        return false;
    }
}
const actions = ["create", "cancel", "read", "thread", "own", "operation"];
export const goalCommunityCommentToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_community_comment_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const int = (minimum = 1, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
const record = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const writeFields = { operationId: id, commentId: id, source: record({ publicId: id, publicVersion: int(), projectionSha256: sha }), parentCommentId: nullable(id),
    text: { type: "string", minLength: 1, maxLength: 2048, description: "最多2048 UTF-8字节，非纯空白；允许换行、回车和TAB，拒绝其他控制字符，保留原文。" } };
const pagination = { afterId: nullable(id), limit: int(1, 16), budgetBytes: int(1024, 24576) };
const fields = { create: writeFields, cancel: writeFields,
    read: { publicId: id, commentId: id, budgetBytes: int(1024, 24576) }, thread: { publicId: id, ...pagination }, own: { publicId: nullable(id), ...pagination },
    operation: { operationId: id, requestSha256: sha } };
const descriptions = {
    create: "仅按本人明确发表意愿创建准确公开目标的评论或回复；保存所见来源版本及父评论，不改写原文，不代作者回复。回执仅为历史元数据，正文须另核当前权限读取。",
    cancel: "用完全相同的评论原件和原号取消尚未保存的发表；已保存只返回原事实，不冒充撤回或删除。未知结果先原号对账，不能换号、补写正文或更换回复对象。",
    read: "按准确公开目标和评论读取当前可见正文；核当前源状态及讨论权益。已删除或作者不可用仅返回占位，不以旧原号恢复正文。",
    thread: "读取同一稳定公开目标的讨论，按评论编号分页；保留每条原来源版本和父评论关系，目标修订不会把旧讨论改称对新版的评价。",
    own: "找回本人评论、取消和擦除的薄记录；源关闭或权益到期仍可管理本人记录，不附正文、摘要或他人草稿。正文导出走准确本人数据范围。",
    operation: "按本人原号和完整请求摘要核评论保存、取消或擦除事实；不返回正文或授予源访问权，not_found不是终态，不自动重试或换号。",
};
export const goalCommunityCommentToolDefinitions = actions.map(action => ({ name: `aidesk_goal_community_comment_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action],
    inputSchema: record({ contract: { type: "string", const: GOAL_COMMUNITY_COMMENT_CONTRACT }, ...fields[action] }),
    annotations: { readOnlyHint: !goalCommunityCommentIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
