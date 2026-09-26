// Generated from services/authority-api/src/goal-community-notification-contract.ts; source SHA-256 ed23bece2976ae29cfc22fa87f1ad7ef47606fb9722e105954cbfafe5e967d6c.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** The existing community owner supplies recipient metadata, never copied
 * content. Reading, acknowledging and host delivery are separate facts. */
export const GOAL_COMMUNITY_NOTIFICATION_CONTRACT = "aidesk-goal-community-notification-v1";
export const GOAL_COMMUNITY_NOTIFICATION_LIMITS = Object.freeze({ requestBytes: 4096, transportBytes: 32768, minBudget: 1024, maxBudget: 32768 });
export class GoalCommunityNotificationError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "通知请求无效。", payload_too_large: "通知请求超过大小限制。", scope_denied: "当前账号无权管理此通知。",
            version_conflict: "通知已读状态或提醒设置已经变化，请读取当前事实。", idempotency_conflict: "原操作号对应的请求不一致。",
            content_deleted: "此通知或该代设置已清除，旧操作不能恢复。", budget_too_small: "读取预算不足以容纳此通知记录。",
            cancelled: "读取或尚未发送的请求已取消。", unavailable: "暂时无法读取本人通知。",
            outcome_unknown: "通知管理结果尚不确定，请沿原号和完整请求摘要核对。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalCommunityNotificationError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const nullableId = (v) => v === null || uuid(v);
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const budget = (v) => integer(v, GOAL_COMMUNITY_NOTIFICATION_LIMITS.minBudget, GOAL_COMMUNITY_NOTIFICATION_LIMITS.maxBudget);
const prefix = ["contract", "action"];
export const goalCommunityNotificationIsWrite = (action) => action === "mark_read" || action === "mute_set" || action === "proactive_set";
export function parseGoalCommunityNotificationInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_COMMUNITY_NOTIFICATION_LIMITS.requestBytes)
            throw new GoalCommunityNotificationError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_COMMUNITY_NOTIFICATION_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalCommunityNotificationError ? error : new GoalCommunityNotificationError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_COMMUNITY_NOTIFICATION_CONTRACT && v.action === action) {
        if (action === "list")
            valid = exact(v, [...prefix, "filter", "publicId", "afterId", "limit", "budgetBytes"])
                && (v.filter === "all" || v.filter === "unread") && nullableId(v.publicId) && nullableId(v.afterId) && integer(v.limit, 1, 30) && budget(v.budgetBytes);
        if (action === "read")
            valid = exact(v, [...prefix, "notificationId", "budgetBytes"]) && uuid(v.notificationId) && budget(v.budgetBytes);
        if (action === "preferences")
            valid = exact(v, [...prefix, "publicId"]) && nullableId(v.publicId);
        if (action === "mark_read")
            valid = exact(v, [...prefix, "operationId", "notificationId", "expectedReadVersion", "throughRevision"])
                && uuid(v.operationId) && uuid(v.notificationId) && integer(v.expectedReadVersion, 0, 2147483646) && integer(v.throughRevision);
        if (action === "mute_set")
            valid = exact(v, [...prefix, "operationId", "publicId", "expectedGeneration", "expectedVersion", "muted"])
                && uuid(v.operationId) && uuid(v.publicId) && integer(v.expectedGeneration, 1, 2147483646) && integer(v.expectedVersion, 0, 2147483646) && typeof v.muted === "boolean";
        if (action === "proactive_set")
            valid = exact(v, [...prefix, "operationId", "expectedGeneration", "expectedVersion", "enabled"])
                && uuid(v.operationId) && integer(v.expectedGeneration, 1, 2147483646) && integer(v.expectedVersion, 0, 2147483646) && typeof v.enabled === "boolean";
        if (action === "operation")
            valid = exact(v, [...prefix, "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
    }
    if (!valid)
        throw new GoalCommunityNotificationError("invalid_input");
    return v;
}
export function validGoalCommunityNotificationItem(v) {
    if (!(exact(v, ["notificationId", "kind", "publicId", "revision", "readThroughRevision", "readVersion", "muted", "sourceState", "commentId", "parentCommentId", "createdAt", "updatedAt"])
        && uuid(v.notificationId) && uuid(v.publicId) && integer(v.revision) && integer(v.readThroughRevision, 0) && v.readThroughRevision <= v.revision
        && integer(v.readVersion, 0) && (v.readVersion === 0 ? v.readThroughRevision === 0 : v.readThroughRevision >= 1) && typeof v.muted === "boolean"
        && (v.sourceState === "available" || v.sourceState === "unavailable") && isTimestamp(v.createdAt) && isTimestamp(v.updatedAt)
        && Date.parse(v.createdAt) <= Date.parse(v.updatedAt)))
        return false;
    return v.kind === "reply" ? uuid(v.commentId) && uuid(v.parentCommentId) && v.commentId !== v.parentCommentId
        : v.kind === "comment" ? uuid(v.commentId) && v.parentCommentId === null
            : (v.kind === "adoption" || v.kind === "like") && v.commentId === null && v.parentCommentId === null;
}
function setting(v, key) {
    return integer(v.generation) && integer(v.version, 0) && typeof v[key] === "boolean"
        && (v.generation !== 2147483647 || v.version === 0)
        && (v.version === 0 ? v[key] === false && v.updatedAt === null : isTimestamp(v.updatedAt));
}
export function validGoalCommunityNotificationProactive(v) {
    return exact(v, ["generation", "enabled", "version", "updatedAt"]) && setting(v, "enabled");
}
export function validGoalCommunityNotificationMute(v) {
    return exact(v, ["publicId", "generation", "muted", "version", "updatedAt"]) && uuid(v.publicId) && setting(v, "muted");
}
export function validGoalCommunityNotificationReceipt(v, operationId, requestSha256) {
    try {
        if (!(exact(v, ["contract", "status", "operationId", "requestSha256", "request", "result", "recordedAt"])
            && v.contract === GOAL_COMMUNITY_NOTIFICATION_CONTRACT && v.status === "recorded" && uuid(v.operationId) && hash(v.requestSha256) && isTimestamp(v.recordedAt)
            && (operationId === undefined || v.operationId === operationId) && (requestSha256 === undefined || v.requestSha256 === requestSha256)
            && teachingObject(v.request) && (v.request.action === "mark_read" || v.request.action === "mute_set" || v.request.action === "proactive_set")))
            return false;
        const p = parseGoalCommunityNotificationInput(v.request.action, v.request), r = v.result;
        if (p.operationId !== v.operationId || teachingRequestSha256(p) !== v.requestSha256)
            return false;
        if (p.action === "mark_read")
            return exact(r, ["notificationId", "readVersion", "readThroughRevision"]) && r.notificationId === p.notificationId
                && r.readVersion === p.expectedReadVersion + 1 && integer(r.readThroughRevision) && r.readThroughRevision >= p.throughRevision;
        if (p.action === "mute_set")
            return validGoalCommunityNotificationMute(r) && r.publicId === p.publicId && r.generation === p.expectedGeneration
                && r.muted === p.muted && r.version === p.expectedVersion + 1 && Date.parse(r.updatedAt) <= Date.parse(v.recordedAt);
        return validGoalCommunityNotificationProactive(r) && r.generation === p.expectedGeneration && r.enabled === p.enabled
            && r.version === p.expectedVersion + 1 && Date.parse(r.updatedAt) <= Date.parse(v.recordedAt);
    }
    catch {
        return false;
    }
}
function erasedOperation(v) {
    if (!(exact(v, [...prefix, "status", "terminal", "operationId", "requestSha256", "target", "erasedAt"])
        && v.status === "erased" && v.terminal === true && isTimestamp(v.erasedAt)))
        return false;
    return v.action === "mark_read" ? exact(v.target, ["kind", "notificationId"]) && v.target.kind === "community_notification" && uuid(v.target.notificationId)
        : (v.action === "mute_set" || v.action === "proactive_set") && exact(v.target, ["kind", "generation"])
            && v.target.kind === "community_notification_settings" && integer(v.target.generation, 1, 2147483646);
}
export function validGoalCommunityNotificationResult(action, v, input) {
    try {
        const p = parseGoalCommunityNotificationInput(action, input);
        if (!teachingObject(v) || v.contract !== GOAL_COMMUNITY_NOTIFICATION_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_COMMUNITY_NOTIFICATION_LIMITS.transportBytes)
            return false;
        if (goalCommunityNotificationIsWrite(action)) {
            const original = p;
            return validGoalCommunityNotificationReceipt(v, original.operationId, teachingRequestSha256(original)) && same(v.request, original);
        }
        if (p.action === "operation")
            return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
                && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                    || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                        && validGoalCommunityNotificationReceipt(v.receipt, p.operationId, p.requestSha256) || erasedOperation(v));
        if (p.action === "preferences")
            return exact(v, ["contract", "status", "generation", "proactive", "mute"]) && v.status === "read" && integer(v.generation)
                && validGoalCommunityNotificationProactive(v.proactive) && v.proactive.generation === v.generation
                && (p.publicId === null ? v.mute === null : validGoalCommunityNotificationMute(v.mute) && v.mute.publicId === p.publicId && v.mute.generation === v.generation);
        if (p.action === "read")
            return Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes
                && (exact(v, ["contract", "status", "notification", "location"]) && v.status === "found" && validGoalCommunityNotificationItem(v.notification) && v.notification.notificationId === p.notificationId
                    && (v.notification.sourceState === "unavailable" ? v.location === null : exact(v.location, ["publicId", "publicVersion"])
                        && v.location.publicId === v.notification.publicId && integer(v.location.publicVersion))
                    || exact(v, ["contract", "status", "notificationId"]) && v.status === "not_found" && v.notificationId === p.notificationId
                    || exact(v, ["contract", "status", "notificationId", "erasedAt"]) && v.status === "erased" && v.notificationId === p.notificationId && isTimestamp(v.erasedAt));
        if (p.action !== "list" || !(exact(v, ["contract", "status", "items", "nextAfterId", "unreadCount"]) && v.status === "listed" && Array.isArray(v.items)
            && v.items.length <= p.limit && integer(v.unreadCount, 0) && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
            return false;
        let previous = p.afterId ?? "", unread = 0;
        for (const n of v.items) {
            if (!validGoalCommunityNotificationItem(n) || n.notificationId <= previous || p.publicId !== null && n.publicId !== p.publicId)
                return false;
            const isUnread = !n.muted && n.readThroughRevision < n.revision;
            if (p.filter === "unread" && !isUnread)
                return false;
            if (isUnread)
                unread++;
            previous = n.notificationId;
        }
        return v.unreadCount >= unread && (v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous);
    }
    catch {
        return false;
    }
}
const actions = ["list", "read", "preferences", "mark_read", "mute_set", "proactive_set", "operation"];
export const goalCommunityNotificationToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_community_notification_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const int = (minimum = 1, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
const choice = (...values) => ({ type: "string", enum: values });
const record = (properties) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const settings = { operationId: id, expectedGeneration: int(1, 2147483646), expectedVersion: int(0, 2147483646) };
const fields = {
    list: { filter: choice("all", "unread"), publicId: nullable(id), afterId: nullable(id), limit: int(1, 30), budgetBytes: int(1024, 32768) },
    read: { notificationId: id, budgetBytes: int(1024, 32768) }, preferences: { publicId: nullable(id) },
    mark_read: { operationId: id, notificationId: id, expectedReadVersion: int(0, 2147483646), throughRevision: int() },
    mute_set: { ...settings, publicId: id, muted: { type: "boolean" } }, proactive_set: { ...settings, enabled: { type: "boolean" } },
    operation: { operationId: id, requestSha256: sha },
};
const descriptions = {
    list: "读取本人通知薄目录和未读数，读取不标读；unread排除静音目标，all保留静音记录，按ID有界续页，无正文或提醒送达承诺。",
    read: "按本人通知编号读取薄元数据并定位publicId及评论编号；不标读，原文须经社区或评论工具重新核当前权限。",
    preferences: "读取本人当前代主动提醒偏好和指定目标静音状态；成功读取的虚拟初值为关闭，读取失败不能当作关闭或无未读。",
    mark_read: "按本人已处理的通知修订和已读版本明确标读；不把迟到新互动一并标读，未知结果沿原号核对。",
    mute_set: "按本人意愿设置目标静音，校验当前设置代数和版本；静音不删除消息或改为已读，解除静音也须保存准确新原号。",
    proactive_set: "保存本人主动提醒开关，核当前设置代数和版本；回执仅证明偏好保存，宿主周期检查、调度及提醒送达另行核实。",
    operation: "按本人原号和完整请求摘要核对标读或设置历史结果；擦除只返回准确薄事实，不能恢复旧通知或旧代设置。",
};
export const goalCommunityNotificationToolDefinitions = actions.map(action => ({ name: `aidesk_goal_community_notification_${action}`,
    title: descriptions[action].split("；")[0], description: descriptions[action], inputSchema: record({ contract: choice(GOAL_COMMUNITY_NOTIFICATION_CONTRACT), action: choice(action), ...fields[action] }),
    annotations: { readOnlyHint: !goalCommunityNotificationIsWrite(action), destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
