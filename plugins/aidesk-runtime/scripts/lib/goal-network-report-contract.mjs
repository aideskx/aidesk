// Generated from services/authority-api/src/goal-network-report-contract.ts; source SHA-256 01aa86f0c729c0c65b7c39630c083112cee1a40e8a67fdf5defe83b0ce64b8ba.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Synthetic-cohort report intake and metadata-only review. This does not define
 * a retention policy or authorize content removal, account sanctions or access
 * to private goals. The SQL owner checks independent operator grants. */
export const GOAL_NETWORK_REPORT_CONTRACT = "aidesk-goal-network-report-v1";
export const GOAL_NETWORK_REPORT_LIMITS = Object.freeze({ requestBytes: 4096, transportBytes: 16384, queueItems: 16 });
export const GOAL_NETWORK_REPORT_EXPORT_CONTRACT = "aidesk-goal-network-report-export-v1";
export const GOAL_NETWORK_REPORT_EXPORT_LIMITS = Object.freeze({ documentBytes: 4194304, records: 10000, chunkBytes: 8192 });
export const GOAL_NETWORK_REPORT_REASONS = ["spam", "privacy", "harmful", "other"];
const failureMessages = {
    invalid_input: "请求格式不符合举报合同，本次未受理。",
    payload_too_large: "请求超过举报合同大小限制，本次未受理。",
    scope_denied: "当前账号无权执行此举报或受理操作，本次请求被拒绝。",
    version_conflict: "举报当前版本与预期不符，本次受理变更未写入；先读取当前状态。",
    idempotency_conflict: "此操作号已对应不同请求，本次请求被拒绝；保留原号和原件，核对原操作。",
    report_limit: "本账号在该合成协作范围已达到128个新举报操作的开发上限；本次未新增记录，原号查询仍可继续。",
    unavailable: "暂时无法核验举报或受理状态，请保留原号稍后查询。",
    cancelled: "本次请求已停止，未取得结果；原有操作状态须按原号查询。",
    outcome_unknown: "举报或受理结果未确认；保留原号与请求摘要，先核对原操作，不另号重派。",
};
export class GoalNetworkReportError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(`${failureMessages[kind]}举报不会自动删除内容或停用账号。`);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalNetworkReportError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const uuid = (v) => typeof v === "string" && isUuid(v) && v === v.toLowerCase();
const count = (v, min, max = 2147483647) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const timestamp = (v) => typeof v === "string" && isTimestamp(v);
const reason = (v) => GOAL_NETWORK_REPORT_REASONS.some(item => item === v);
export function validGoalNetworkReportTarget(v) {
    return teachingObject(v) && uuid(v.cohortId) && uuid(v.postId) && count(v.sourceVersion, 1) && hash(v.contentSha256)
        && (v.kind === "post" && exact(v, ["kind", "cohortId", "postId", "sourceVersion", "contentSha256"])
            || v.kind === "response" && exact(v, ["kind", "cohortId", "postId", "sourceVersion", "contentSha256", "responseId"]) && uuid(v.responseId));
}
export const goalNetworkReportIsWrite = (action) => action === "report" || action === "review";
export function parseGoalNetworkReportInput(action, value) {
    let raw;
    try {
        raw = typeof value === "string" ? value : canonicalTeachingJson(value);
    }
    catch {
        throw new GoalNetworkReportError("invalid_input");
    }
    if (Buffer.byteLength(raw) > GOAL_NETWORK_REPORT_LIMITS.requestBytes)
        throw new GoalNetworkReportError("payload_too_large");
    let p;
    try {
        p = parseTeachingJson(raw, GOAL_NETWORK_REPORT_LIMITS.requestBytes);
    }
    catch {
        throw new GoalNetworkReportError("invalid_input");
    }
    if (!teachingObject(p) || p.contract !== GOAL_NETWORK_REPORT_CONTRACT)
        throw new GoalNetworkReportError("invalid_input");
    const valid = action === "report" ? exact(p, ["contract", "operationId", "target", "reason"])
        && uuid(p.operationId) && validGoalNetworkReportTarget(p.target) && reason(p.reason)
        : action === "status" ? exact(p, ["contract", "reportId"]) && uuid(p.reportId)
            : action === "operation" || action === "review_operation" ? exact(p, ["contract", "operationId", "requestSha256"]) && uuid(p.operationId) && hash(p.requestSha256)
                : action === "export" ? exact(p, ["contract", "snapshot", "offset", "chunkBytes"]) && (p.snapshot === null || hash(p.snapshot))
                    && count(p.offset, 0, GOAL_NETWORK_REPORT_EXPORT_LIMITS.documentBytes - 1) && (p.snapshot !== null || p.offset === 0)
                    && count(p.chunkBytes, 1024, GOAL_NETWORK_REPORT_EXPORT_LIMITS.chunkBytes)
                    : action === "queue" ? exact(p, ["contract", "cohortId", "after", "limit"]) && uuid(p.cohortId) && (p.after === null || uuid(p.after)) && count(p.limit, 1, GOAL_NETWORK_REPORT_LIMITS.queueItems)
                        : action === "review" && exact(p, ["contract", "operationId", "reportId", "expectedVersion", "decision"]) && uuid(p.operationId) && uuid(p.reportId)
                            && (p.expectedVersion === 1 && p.decision === "reviewing" || p.expectedVersion === 2 && (p.decision === "no_action" || p.decision === "follow_up_required"));
    if (!valid)
        throw new GoalNetworkReportError("invalid_input");
    return p;
}
function state(v) {
    return v.version === 1 && v.status === "received" && v.outcome === null
        || v.version === 2 && v.status === "reviewing" && v.outcome === null
        || v.version === 3 && v.status === "closed" && (v.outcome === "no_action" || v.outcome === "follow_up_required");
}
export function validGoalNetworkReportItem(v) {
    return exact(v, ["reportId", "target", "reason", "version", "status", "outcome", "createdAt", "updatedAt"])
        && uuid(v.reportId) && validGoalNetworkReportTarget(v.target) && reason(v.reason) && state(v)
        && timestamp(v.createdAt) && timestamp(v.updatedAt) && Date.parse(v.updatedAt) >= Date.parse(v.createdAt);
}
function receipt(v, action) {
    if (!exact(v, ["contract", "action", "operationId", "requestSha256", "request", "reportId", "version", "status", "outcome", "recordedAt"])
        || v.contract !== GOAL_NETWORK_REPORT_CONTRACT || v.action !== action || !uuid(v.operationId) || !hash(v.requestSha256)
        || !uuid(v.reportId) || !timestamp(v.recordedAt) || !state(v) || !teachingObject(v.request))
        return false;
    const request = parseGoalNetworkReportInput(action, v.request);
    if (v.operationId !== request.operationId || v.requestSha256 !== teachingRequestSha256(request))
        return false;
    if (action === "review") {
        const p = request;
        return v.reportId === p.reportId && v.version === p.expectedVersion + 1
            && (p.decision === "reviewing" ? v.status === "reviewing" && v.outcome === null : v.status === "closed" && v.outcome === p.decision);
    }
    return true; // Duplicate reports can reference an already-reviewed case; this receipt remains immutable.
}
export function validGoalNetworkReportResult(action, v, input) {
    try {
        parseGoalNetworkReportInput(action, input);
        if (!teachingObject(v) || v.contract !== GOAL_NETWORK_REPORT_CONTRACT || Buffer.byteLength(canonicalTeachingJson(v)) > GOAL_NETWORK_REPORT_LIMITS.transportBytes)
            return false;
        if (goalNetworkReportIsWrite(action))
            return exact(v, ["contract", "status", "receipt"]) && v.status === "recorded"
                && receipt(v.receipt, action) && canonicalTeachingJson(v.receipt.request) === canonicalTeachingJson(input);
        if (action === "operation" || action === "review_operation") {
            const p = input;
            return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
                && (v.status === "not_found" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.terminal === false
                    || v.status === "completed" && exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.terminal === true
                        && receipt(v.receipt, action === "operation" ? "report" : "review") && v.receipt.operationId === p.operationId && v.receipt.requestSha256 === p.requestSha256);
        }
        if (action === "status") {
            const p = input;
            return v.status === "not_found" && exact(v, ["contract", "status", "reportId"]) && v.reportId === p.reportId
                || v.status === "found" && exact(v, ["contract", "status", "report"]) && validGoalNetworkReportItem(v.report) && v.report.reportId === p.reportId;
        }
        if (action === "export") {
            const p = input;
            if (!exact(v, ["contract", "status", "snapshot", "totalBytes", "offset", "nextOffset", "data", "chunkSha256"])
                || v.status !== "chunk" || !hash(v.snapshot) || p.snapshot !== null && v.snapshot !== p.snapshot
                || !count(v.totalBytes, 1, GOAL_NETWORK_REPORT_EXPORT_LIMITS.documentBytes) || v.offset !== p.offset || p.offset >= v.totalBytes
                || typeof v.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(v.data) || !hash(v.chunkSha256))
                return false;
            const bytes = Buffer.from(v.data, "base64"), end = p.offset + bytes.length;
            return bytes.toString("base64") === v.data && bytes.length === Math.min(p.chunkBytes, v.totalBytes - p.offset)
                && teachingRequestSha256(v.data) === v.chunkSha256 && v.nextOffset === (end === v.totalBytes ? null : end);
        }
        if (action !== "queue" || !exact(v, ["contract", "cohortId", "items", "nextAfter"]))
            return false;
        const p = input;
        if (v.cohortId !== p.cohortId || !Array.isArray(v.items) || v.items.length > p.limit || !(v.nextAfter === null || uuid(v.nextAfter)))
            return false;
        let previous = p.after;
        for (const item of v.items) {
            if (!validGoalNetworkReportItem(item) || item.target.cohortId !== p.cohortId || previous !== null && item.reportId <= previous)
                return false;
            previous = item.reportId;
        }
        return v.nextAfter === null || v.items.length === p.limit && v.items.length > 0 && v.nextAfter === previous;
    }
    catch {
        return false;
    }
}
/** The complete reporter-owned snapshot contains current metadata and immutable
 * reporter receipts, never operator receipts or referenced source bodies. */
export function validGoalNetworkReportExportDocument(v) {
    if (!exact(v, ["contract", "reports", "operations"]) || v.contract !== GOAL_NETWORK_REPORT_EXPORT_CONTRACT
        || !Array.isArray(v.reports) || !Array.isArray(v.operations) || v.reports.length + v.operations.length > GOAL_NETWORK_REPORT_EXPORT_LIMITS.records)
        return false;
    const reports = new Map(), originals = new Set();
    let previous = "";
    for (const item of v.reports) {
        if (!validGoalNetworkReportItem(item) || item.reportId <= previous)
            return false;
        reports.set(item.reportId, item);
        previous = item.reportId;
    }
    previous = "";
    for (const operation of v.operations) {
        try {
            if (!receipt(operation, "report"))
                return false;
        }
        catch {
            return false;
        }
        if (operation.operationId <= previous)
            return false;
        previous = operation.operationId;
        const item = reports.get(operation.reportId), request = operation.request;
        if (!item || operation.version > item.version || Date.parse(operation.recordedAt) < Date.parse(item.createdAt)
            || canonicalTeachingJson(request.target) !== canonicalTeachingJson(item.target) || request.reason !== item.reason)
            return false;
        if (operation.operationId === item.reportId) {
            if (operation.version !== 1 || Date.parse(operation.recordedAt) !== Date.parse(item.createdAt))
                return false;
            originals.add(item.reportId);
        }
    }
    return originals.size === reports.size;
}
export function assembleGoalNetworkReportExport(pages) {
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 4096)
        throw new GoalNetworkReportError("invalid_input");
    const chunks = [];
    let offset = 0, snapshot = null, total = 0;
    for (const [index, page] of pages.entries()) {
        const p = parseGoalNetworkReportInput("export", page.input), r = page.result;
        if (p.offset !== offset || p.snapshot !== snapshot || !validGoalNetworkReportResult("export", r, p)
            || index > 0 && r.totalBytes !== total || r.nextOffset === null && index !== pages.length - 1)
            throw new GoalNetworkReportError("version_conflict");
        snapshot = r.snapshot;
        total = r.totalBytes;
        const chunk = Buffer.from(r.data, "base64");
        chunks.push(chunk);
        offset += chunk.length;
    }
    const bytes = Buffer.concat(chunks);
    let document;
    try {
        document = parseTeachingJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), GOAL_NETWORK_REPORT_EXPORT_LIMITS.documentBytes);
    }
    catch {
        throw new GoalNetworkReportError("invalid_input");
    }
    if (offset !== total || !validGoalNetworkReportExportDocument(document) || teachingRequestSha256(document) !== snapshot
        || !bytes.equals(Buffer.from(canonicalTeachingJson(document))))
        throw new GoalNetworkReportError("version_conflict");
    return { document, bytes, snapshot: snapshot };
}
export const goalNetworkReportToolAction = (name) => name === "aidesk_goal_network_report_submit" ? "report"
    : name === "aidesk_goal_network_report_status" ? "status" : name === "aidesk_goal_network_report_operation" ? "operation"
        : name === "aidesk_goal_network_report_export" ? "export" : undefined;
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f-]+$" };
const digest = { type: "string", pattern: "^[a-f0-9]{64}$" };
const targetProperties = { cohortId: id, postId: id, sourceVersion: { type: "integer", minimum: 1, maximum: 2147483647 }, contentSha256: digest };
const targetSchema = { anyOf: [
        { type: "object", additionalProperties: false, properties: { kind: { const: "post", type: "string" }, ...targetProperties }, required: ["kind", ...Object.keys(targetProperties)] },
        { type: "object", additionalProperties: false, properties: { kind: { const: "response", type: "string" }, ...targetProperties, responseId: id }, required: ["kind", ...Object.keys(targetProperties), "responseId"] },
    ] };
function schema(properties) {
    return { type: "object", additionalProperties: false, properties: { contract: { const: GOAL_NETWORK_REPORT_CONTRACT, type: "string" }, ...properties }, required: ["contract", ...Object.keys(properties)] };
}
export const goalNetworkReportToolDefinitions = [
    { name: "aidesk_goal_network_report_submit", description: "按本人明确意愿举报当前共享范围内未撤回或删除的准确合成帖子修订或回应；不要求新增订阅准入，也不授正文读取权。理由仅spam/privacy/harmful/other枚举，不上传正文。记录不表示认定违规，不自动删文或封号；未知保留原号和摘要。", inputSchema: schema({ operationId: id, target: targetSchema, reason: { type: "string", enum: GOAL_NETWORK_REPORT_REASONS } }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_report_status", description: "只读核本人举报当前元信息和受理状态，不返回来源正文或运营身份。未找到不证明其他人未举报。", inputSchema: schema({ reportId: id }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_report_operation", description: "按本人举报原号与完整请求摘要只读对账；not_found不是终态，不能据此换号或自动重派。原回执不代表当前处理状态。", inputSchema: schema({ operationId: id, requestSha256: digest }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_network_report_export", description: "只读找回并分段导出本人全部举报元信息和本人原号回执，无需先知道举报编号。不含来源正文、他人举报或运营原件，不启动订阅或重新开放来源；所有分段须同一snapshot并核完整摘要。", inputSchema: schema({ snapshot: { anyOf: [digest, { type: "null" }] },
            offset: { type: "integer", minimum: 0, maximum: GOAL_NETWORK_REPORT_EXPORT_LIMITS.documentBytes - 1 }, chunkBytes: { type: "integer", minimum: 1024, maximum: GOAL_NETWORK_REPORT_EXPORT_LIMITS.chunkBytes } }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
