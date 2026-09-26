// Generated from services/authority-api/src/goal-community-report-contract.ts; source SHA-256 87e4ab8d0f64e874dd1a3da1d39ad5f3d96736d4f66758127db76e2b338353f1.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Versioned consumers of the existing report owner. A report receipt records
 * an allegation, not a finding or current visibility. Operator inspection is
 * separately scoped and never copies source bodies into operation originals. */
export const GOAL_COMMUNITY_REPORT_CONTRACT = "aidesk-goal-community-report-v1";
export const GOAL_COMMUNITY_REPORT_LIMITS = Object.freeze({ requestBytes: 4096, transportBytes: 32768, minBudget: 1024, maxBudget: 32768, pageItems: 16 });
export const GOAL_COMMUNITY_REPORT_REASONS = ["spam", "privacy", "harmful", "other"];
export class GoalCommunityReportError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ invalid_input: "举报或处置请求格式无效。", payload_too_large: "举报或处置请求超过大小限制。", scope_denied: "当前账号没有这一举报或处置范围的权限。",
            version_conflict: "举报、来源或限制状态已变化，请重新读取当前状态。", idempotency_conflict: "此原操作号对应的请求不一致，请按原号核对。",
            content_deleted: "本人举报资料已清除，旧原号不能恢复原件。", budget_too_small: "读取预算不足以容纳举报记录。",
            cancelled: "读取或尚未发送的请求已取消。", unavailable: "暂时无法核验举报或处置记录。",
            outcome_unknown: "举报或处置结果未确认，请保留原号和请求摘要对账。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalCommunityReportError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const nullableId = (v) => v === null || uuid(v);
const nullableHash = (v) => v === null || hash(v);
const timestamp = (v) => typeof v === "string" && isTimestamp(v);
const reason = (v) => GOAL_COMMUNITY_REPORT_REASONS.some(item => item === v);
const outcome = (v) => v === "no_action" || v === "hidden" || v === "released";
const budget = (v) => integer(v, GOAL_COMMUNITY_REPORT_LIMITS.minBudget, GOAL_COMMUNITY_REPORT_LIMITS.maxBudget);
export function validGoalCommunityReportTarget(v) {
    return teachingObject(v) && uuid(v.publicId) && (v.kind === "goal" && exact(v, ["kind", "publicId", "publicVersion", "projectionSha256"])
        && integer(v.publicVersion) && hash(v.projectionSha256) || v.kind === "comment" && exact(v, ["kind", "publicId", "commentId"]) && uuid(v.commentId));
}
export function validGoalCommunityReportResolvedTarget(v) {
    return teachingObject(v) && (v.kind === "goal" && validGoalCommunityReportTarget(v)
        || v.kind === "comment" && exact(v, ["kind", "publicId", "commentId", "contentSha256"]) && uuid(v.publicId) && uuid(v.commentId) && nullableHash(v.contentSha256));
}
function restrictionTarget(v) {
    return teachingObject(v) && uuid(v.publicId) && (v.kind === "goal" && exact(v, ["kind", "publicId"])
        || v.kind === "comment" && exact(v, ["kind", "publicId", "commentId"]) && uuid(v.commentId));
}
function targetOf(v) {
    return v.kind === "goal" ? { kind: "goal", publicId: v.publicId } : { kind: "comment", publicId: v.publicId, commentId: v.commentId };
}
function snapshotTarget(v) {
    return v.comment === null ? { kind: "goal", publicId: v.source.publicId } : { kind: "comment", publicId: v.source.publicId, commentId: v.comment.commentId };
}
export function validGoalCommunityReportRestriction(v) {
    return exact(v, ["target", "version", "state", "updatedAt"]) && restrictionTarget(v.target) && integer(v.version, 0)
        && (v.version === 0 ? v.state === "clear" && v.updatedAt === null : (v.state === "clear" || v.state === "hidden") && timestamp(v.updatedAt));
}
export function validGoalCommunityReportSourceSnapshot(v) {
    if (!exact(v, ["source", "comment"]) || !exact(v.source, ["publicId", "publicVersion", "stateVersion", "state", "projectionSha256", "availability"]))
        return false;
    const s = v.source;
    if (!uuid(s.publicId) || !integer(s.publicVersion) || !integer(s.stateVersion) || !(s.state === "published" || s.state === "closed")
        || !(s.availability === "deleted" ? s.projectionSha256 === null : hash(s.projectionSha256)
            && (s.availability === "unavailable" || s.availability === "available" && s.state === "published")))
        return false;
    if (v.comment === null)
        return true;
    return exact(v.comment, ["commentId", "contentSha256", "availability"]) && uuid(v.comment.commentId)
        && (v.comment.availability === "deleted" ? v.comment.contentSha256 === null : hash(v.comment.contentSha256)
            && (v.comment.availability === "unavailable" || v.comment.availability === "available" && s.availability === "available"));
}
export function validGoalCommunityReportItem(v) {
    return exact(v, ["reportId", "target", "reason", "version", "status", "outcome", "createdAt", "updatedAt", "erasedAt"])
        && uuid(v.reportId) && validGoalCommunityReportResolvedTarget(v.target) && integer(v.version) && timestamp(v.createdAt) && timestamp(v.updatedAt)
        && Date.parse(v.createdAt) <= Date.parse(v.updatedAt)
        && (v.status === "received" ? v.version === 1 && v.outcome === null : v.status === "closed" && v.version >= 2 && outcome(v.outcome))
        && (v.erasedAt === null ? reason(v.reason) : timestamp(v.erasedAt) && v.reason === null && Date.parse(v.erasedAt) >= Date.parse(v.createdAt));
}
export const goalCommunityReportIsWrite = (action) => action === "submit" || action === "review";
export function parseGoalCommunityReportInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_COMMUNITY_REPORT_LIMITS.requestBytes)
            throw new GoalCommunityReportError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_COMMUNITY_REPORT_LIMITS.requestBytes);
    }
    catch (error) {
        throw error instanceof GoalCommunityReportError ? error : new GoalCommunityReportError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_COMMUNITY_REPORT_CONTRACT && v.action === action) {
        if (action === "submit")
            valid = exact(v, ["contract", "action", "operationId", "target", "reason"])
                && uuid(v.operationId) && validGoalCommunityReportTarget(v.target) && reason(v.reason);
        if (action === "list" || action === "queue")
            valid = exact(v, ["contract", "action", "publicId", "afterId", "limit", "budgetBytes"])
                && nullableId(v.publicId) && nullableId(v.afterId) && integer(v.limit, 1, GOAL_COMMUNITY_REPORT_LIMITS.pageItems) && budget(v.budgetBytes);
        if (action === "status" || action === "inspect")
            valid = exact(v, ["contract", "action", "reportId", "budgetBytes"]) && uuid(v.reportId) && budget(v.budgetBytes);
        if (action === "operation" || action === "review_operation")
            valid = exact(v, ["contract", "action", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
        if (action === "review")
            valid = exact(v, ["contract", "action", "operationId", "reportId", "expectedVersion", "expectedRestrictionVersion", "expectedSourceSnapshot", "decision"])
                && uuid(v.operationId) && uuid(v.reportId) && integer(v.expectedVersion, 1, 2147483646) && integer(v.expectedRestrictionVersion, 0, 2147483646)
                && validGoalCommunityReportSourceSnapshot(v.expectedSourceSnapshot)
                && (v.decision === "no_action" || v.decision === "release" || v.decision === "hide" && v.expectedSourceSnapshot.source.availability === "available"
                    && (v.expectedSourceSnapshot.comment === null || v.expectedSourceSnapshot.comment.availability === "available"));
    }
    if (!valid)
        throw new GoalCommunityReportError("invalid_input");
    return v;
}
export function validGoalCommunityReportReceipt(v, action) {
    try {
        if (!exact(v, ["contract", "status", "operationId", "requestSha256", "request", "result", "recordedAt"])
            || v.contract !== GOAL_COMMUNITY_REPORT_CONTRACT || v.status !== "recorded" || !uuid(v.operationId) || !hash(v.requestSha256)
            || !timestamp(v.recordedAt) || !teachingObject(v.request) || !goalCommunityReportIsWrite(v.request.action)
            || action !== undefined && v.request.action !== action)
            return false;
        const p = parseGoalCommunityReportInput(v.request.action, v.request);
        if (p.operationId !== v.operationId || teachingRequestSha256(p) !== v.requestSha256)
            return false;
        if (p.action === "submit") {
            if (!validGoalCommunityReportItem(v.result))
                return false;
            const r = v.result;
            return r.reportId === p.operationId && r.status === "received" && r.version === 1 && r.outcome === null && r.reason === p.reason && r.erasedAt === null
                && r.createdAt === v.recordedAt && r.updatedAt === v.recordedAt && (p.target.kind === "goal" ? same(r.target, p.target)
                : r.target.kind === "comment" && r.target.publicId === p.target.publicId && r.target.commentId === p.target.commentId);
        }
        if (!exact(v.result, ["reportId", "version", "status", "outcome", "restriction"]) || v.result.reportId !== p.reportId
            || v.result.version !== p.expectedVersion + 1 || v.result.status !== "closed" || v.result.outcome !== { no_action: "no_action", hide: "hidden", release: "released" }[p.decision]
            || !validGoalCommunityReportRestriction(v.result.restriction) || !same(v.result.restriction.target, snapshotTarget(p.expectedSourceSnapshot)))
            return false;
        const r = v.result.restriction;
        return p.decision === "no_action" ? r.version === p.expectedRestrictionVersion && (r.updatedAt === null || Date.parse(r.updatedAt) <= Date.parse(v.recordedAt))
            : r.version === p.expectedRestrictionVersion + 1 && r.state === (p.decision === "hide" ? "hidden" : "clear") && r.updatedAt === v.recordedAt;
    }
    catch {
        return false;
    }
}
function validText(v, max, title = false) {
    return typeof v === "string" && v.isWellFormed() && v.trim().length > 0 && !(title ? /\p{Cc}/u : /[^\P{Cc}\r\n\t]/u).test(v) && Buffer.byteLength(v) <= max;
}
function body(v, s) {
    if (s.source.availability !== "available" || s.comment !== null && s.comment.availability !== "available")
        return v === null;
    return s.comment === null ? exact(v, ["kind", "title", "text"]) && v.kind === "goal" && validText(v.title, 160, true) && validText(v.text, 8192)
        && teachingRequestSha256({ title: v.title, text: v.text }) === s.source.projectionSha256
        : exact(v, ["kind", "text"]) && v.kind === "comment" && validText(v.text, 2048) && teachingRequestSha256({ text: v.text }) === s.comment.contentSha256;
}
export function validGoalCommunityReportResult(action, v, input) {
    try {
        const p = parseGoalCommunityReportInput(action, input);
        if (!teachingObject(v) || v.contract !== GOAL_COMMUNITY_REPORT_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_COMMUNITY_REPORT_LIMITS.transportBytes
            || "budgetBytes" in p && Buffer.byteLength(canonicalTeachingJson(v)) > p.budgetBytes)
            return false;
        if (p.action === "submit" || p.action === "review")
            return validGoalCommunityReportReceipt(v, p.action) && same(v.request, p);
        if (p.action === "operation" || p.action === "review_operation") {
            if (v.operationId !== p.operationId || v.requestSha256 !== p.requestSha256)
                return false;
            if (v.status === "erased")
                return p.action === "operation" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "action", "target", "erasedAt"])
                    && v.terminal === true && v.action === "submit" && timestamp(v.erasedAt) && exact(v.target, ["kind", "reportId"])
                    && v.target.kind === "community_report" && v.target.reportId === p.operationId;
            return v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.terminal === true
                    && validGoalCommunityReportReceipt(v.receipt, p.action === "operation" ? "submit" : "review")
                    && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256;
        }
        if (p.action === "status" || p.action === "inspect") {
            if (p.action === "status" && v.status === "not_found")
                return exact(v, ["contract", "status", "reportId"]) && v.reportId === p.reportId;
            if (v.status !== "found" || !validGoalCommunityReportItem(v.report) || v.report.reportId !== p.reportId
                || !validGoalCommunityReportRestriction(v.restriction) || !same(v.restriction.target, targetOf(v.report.target)))
                return false;
            return p.action === "status" ? exact(v, ["contract", "status", "report", "restriction"])
                : exact(v, ["contract", "status", "report", "restriction", "sourceSnapshot", "body"]) && validGoalCommunityReportSourceSnapshot(v.sourceSnapshot)
                    && same(snapshotTarget(v.sourceSnapshot), targetOf(v.report.target)) && body(v.body, v.sourceSnapshot);
        }
        if (!exact(v, ["contract", "status", "publicId", "items", "nextAfterId"]) || v.status !== "listed" || v.publicId !== p.publicId
            || !Array.isArray(v.items) || v.items.length > p.limit || !nullableId(v.nextAfterId))
            return false;
        let previous = p.afterId;
        for (const item of v.items) {
            if (!validGoalCommunityReportItem(item) || p.publicId !== null && item.target.publicId !== p.publicId || previous !== null && item.reportId <= previous)
                return false;
            previous = item.reportId;
        }
        return v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous;
    }
    catch {
        return false;
    }
}
export const goalCommunityReportToolAction = (name) => name === "aidesk_goal_community_report_submit" ? "submit"
    : name === "aidesk_goal_community_report_list" ? "list" : name === "aidesk_goal_community_report_status" ? "status"
        : name === "aidesk_goal_community_report_operation" ? "operation" : undefined;
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f-]+$" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const nullable = (value) => ({ anyOf: [value, { type: "null" }] });
const positive = { type: "integer", minimum: 1, maximum: 2147483647 };
const budgetSchema = { type: "integer", minimum: GOAL_COMMUNITY_REPORT_LIMITS.minBudget, maximum: GOAL_COMMUNITY_REPORT_LIMITS.maxBudget };
function shape(properties) { return { type: "object", additionalProperties: false, properties, required: Object.keys(properties) }; }
function schema(action, properties) { return shape({ contract: { type: "string", const: GOAL_COMMUNITY_REPORT_CONTRACT }, action: { type: "string", const: action }, ...properties }); }
const targetSchema = { oneOf: [shape({ kind: { type: "string", const: "goal" }, publicId: id, publicVersion: positive, projectionSha256: digest }),
        shape({ kind: { type: "string", const: "comment" }, publicId: id, commentId: id })] };
const annotations = (readOnlyHint) => ({ readOnlyHint, destructiveHint: false, idempotentHint: true, openWorldHint: false });
export const goalCommunityReportToolDefinitions = [
    { name: "aidesk_goal_community_report_submit", description: "按本人明确意愿举报准确公开目标或评论；仅提交来源标识和理由枚举，不要求付费先读正文。服务核对当前公开范围或本人合法引用。回执仅表示已收到举报，不认定违规、不自动删除或限制内容；未知先查原号。", inputSchema: schema("submit", { operationId: id, target: targetSchema, reason: { type: "string", enum: GOAL_COMMUNITY_REPORT_REASONS } }), annotations: annotations(false) },
    { name: "aidesk_goal_community_report_list", description: "只读找回本人举报薄目录，可按公开目标筛选；来源关闭或服务权益到期不抹去本人必要记录。已清理项只保留处理与擦除事实，不返回来源正文或审核原件。", inputSchema: schema("list", { publicId: nullable(id), afterId: nullable(id), limit: { type: "integer", minimum: 1, maximum: GOAL_COMMUNITY_REPORT_LIMITS.pageItems }, budgetBytes: budgetSchema }), annotations: annotations(true) },
    { name: "aidesk_goal_community_report_status", description: "只读核本人准确举报当前受理和限制状态；已关闭举报的历史处理结果不等于来源当前公开。此读取不授予来源正文或管理权限。", inputSchema: schema("status", { reportId: id, budgetBytes: budgetSchema }), annotations: annotations(true) },
    { name: "aidesk_goal_community_report_operation", description: "按原举报操作号和完整请求摘要只读核不可变回执；not_found不是未发生终态，擦除仅返回本人薄事实，不恢复原件，不换号重提。", inputSchema: schema("operation", { operationId: id, requestSha256: digest }), annotations: annotations(true) },
];
