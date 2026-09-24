// Generated from services/authority-api/src/goal-task-contract.ts; source SHA-256 d8f89eb55842cebfe555c342c59d0cbb9690899f045ffad0c721fd237e10fa52.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Non-authoritative persistence contract. A recorded host receipt is a source
 * claim, never server verification of Codex, readable files or human intent.
 * The existing goal and service-acceptance owners remain authoritative. */
export const GOAL_TASK_CONTRACT = "aidesk-goal-task-v1";
export const GOAL_TASK_LIMITS = Object.freeze({ requestBytes: 12288, transportBytes: 32768, minBudget: 1024, maxBudget: 24576 });
export class GoalTaskError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ goal_deleted: "该目标内容已删除，不能重放写入；保留原号核对旧操作。", invalid_input: "目标任务记录请求无效。", payload_too_large: "目标任务记录超过大小限制。", scope_denied: "当前账号无权访问此目标任务范围。",
            version_conflict: "目标或用户决定已变更，请读取当前记录。", idempotency_conflict: "原号或回报身份对应的内容不一致。",
            creation_conflict: "此目标已有创建原件，请核对原任务，不能再次创建。", source_mismatch: "回报来源与原目标任务不符。",
            budget_too_small: "读取预算不足以容纳此条记录。", unavailable: "暂时无法读取任务记录。",
            outcome_unknown: "记录结果尚不确定，请沿原号对账，不重建任务或重做成果。", cancelled: "读取或未发送请求已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalTaskError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v, max) => typeof v === "string" && v.isWellFormed() && v.trim().length > 0
    && !/[\p{Cc}]/u.test(v) && Buffer.byteLength(v) <= max;
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const nativeId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(v);
const target = (v) => exact(v, ["hostId", "threadId"]) && text(v.hostId, 128) && nativeId(v.threadId);
const one = (v, values) => typeof v === "string" && values.includes(v);
// Fixed-width UTC preserves PostgreSQL microseconds in lexical cursor ordering;
// Date.parse is used only by the calendar validator, never to order these values.
const recentTimestamp = (v) => typeof v === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(v) && isTimestamp(v);
const recentCursor = (v) => exact(v, ["activityAt", "goalId"])
    && recentTimestamp(v.activityAt) && uuid(v.goalId);
export function validGoalTaskEvent(v) {
    if (!teachingObject(v))
        return false;
    if (v.kind === "decision")
        return exact(v, ["kind", "goalVersion", "expectedDecisionVersion", "intent", "reason"])
            && integer(v.goalVersion) && integer(v.expectedDecisionVersion, 1, 2147483646) && one(v.intent, ["active", "paused"]) && text(v.reason, 512);
    if (!integer(v.sequence) || !isTimestamp(v.occurredAt))
        return false;
    if (v.kind === "creation") {
        if (!exact(v, ["kind", "sequence", "occurredAt", "hostId", "sourceThreadId", "status", "clientThreadId", "task", "evidenceRef"])
            || !text(v.hostId, 128) || !nativeId(v.sourceThreadId) || !one(v.status, ["created", "pending", "unknown", "not_found", "rejected"])
            || !(v.evidenceRef === null || text(v.evidenceRef, 512)))
            return false;
        if (v.status === "created")
            return v.clientThreadId === null && text(v.evidenceRef, 512)
                && exact(v.task, ["hostId", "threadId", "entryUri", "visible"]) && v.task.hostId === v.hostId
                && nativeId(v.task.threadId) && v.task.threadId !== v.sourceThreadId && v.task.visible === true && v.task.entryUri === `codex://threads/${v.task.threadId}`;
        return v.task === null && (v.status === "pending" ? nativeId(v.clientThreadId) : v.clientThreadId === null);
    }
    if (!integer(v.goalVersion) || !target(v.task))
        return false;
    const common = ["kind", "sequence", "occurredAt", "goalVersion", "task"];
    if (v.kind === "materials")
        return exact(v, [...common, "evidenceRef", "items"]) && text(v.evidenceRef, 512)
            && Array.isArray(v.items) && v.items.length <= 8 && v.items.every(item => exact(item, ["id", "uri", "sha256", "read", "observation"])
            && text(item.id, 64) && text(item.uri, 512) && (item.sha256 === null || hash(item.sha256)) && typeof item.read === "boolean"
            && (!item.read || hash(item.sha256)) && text(item.observation, 512)) && new Set(v.items.map(i => i.id)).size === v.items.length;
    if (!integer(v.decisionVersion))
        return false;
    if (v.kind === "delivery")
        return exact(v, [...common, "decisionVersion", "status", "evidenceRef"])
            && one(v.status, ["delivered", "unknown", "rejected"]) && (v.evidenceRef === null || text(v.evidenceRef, 512))
            && (v.status !== "delivered" || text(v.evidenceRef, 512));
    if (v.kind === "observation")
        return exact(v, [...common, "decisionVersion", "status", "entry", "evidenceRef"])
            && one(v.status, ["running", "paused", "completed", "unknown"]) && one(v.entry, ["accessible", "inaccessible", "unknown"]) && text(v.evidenceRef, 512);
    if (v.kind === "report")
        return exact(v, [...common, "decisionVersion", "reportId", "status", "progress", "limitations", "results"])
            && uuid(v.reportId) && one(v.status, ["working", "needs_input", "completed"]) && text(v.progress, 2048)
            && Array.isArray(v.limitations) && v.limitations.length <= 8 && v.limitations.every(i => text(i, 512))
            && Array.isArray(v.results) && v.results.length <= 4 && v.results.every(i => exact(i, ["id", "uri", "sha256", "access", "verification"])
            && text(i.id, 64) && text(i.uri, 512) && (i.sha256 === null || hash(i.sha256)) && one(i.access, ["local", "private", "shared", "unknown"])
            && text(i.verification, 512)) && new Set(v.results.map(i => i.id)).size === v.results.length;
    return false;
}
export function parseGoalTaskInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_TASK_LIMITS.requestBytes)
            throw new GoalTaskError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_TASK_LIMITS.requestBytes);
    }
    catch (e) {
        throw e instanceof GoalTaskError ? e : new GoalTaskError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_TASK_CONTRACT) {
        if (action === "reserve")
            valid = exact(v, ["contract", "operationId", "goalId", "goalVersion", "attemptId", "serviceOperationId", "serviceRequestSha256", "hostId", "sourceThreadId"])
                && uuid(v.operationId) && uuid(v.goalId) && uuid(v.attemptId) && integer(v.goalVersion) && uuid(v.serviceOperationId)
                && hash(v.serviceRequestSha256) && text(v.hostId, 128) && nativeId(v.sourceThreadId);
        if (action === "record")
            valid = exact(v, ["contract", "operationId", "goalId", "attemptId", "event"])
                && uuid(v.operationId) && uuid(v.goalId) && uuid(v.attemptId) && validGoalTaskEvent(v.event);
        if (action === "operation")
            valid = exact(v, ["contract", "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
        if (action === "read")
            valid = integer(v.budgetBytes, 1024, 24576)
                && (v.view === "recent" && exact(v, ["contract", "view", "after", "limit", "budgetBytes"])
                    && integer(v.limit, 1, 16) && (v.after === null || recentCursor(v.after))
                    || uuid(v.goalId) && (v.view === "snapshot" && exact(v, ["contract", "goalId", "view", "budgetBytes"])
                        || v.view === "reports" && integer(v.limit, 1, 16)
                            && (exact(v, ["contract", "goalId", "view", "afterSequence", "limit", "budgetBytes"])
                                && (v.afterSequence === null || integer(v.afterSequence, 0))
                                || exact(v, ["contract", "goalId", "view", "afterReceiptIndex", "limit", "budgetBytes"])
                                    && (v.afterReceiptIndex === null || integer(v.afterReceiptIndex, 0, Number.MAX_SAFE_INTEGER)))));
    }
    if (!valid)
        throw new GoalTaskError("invalid_input");
    return v;
}
function receipt(v, operationId, digest, recovering) {
    if (!(exact(v, ["contract", "status", "action", "operationId", "requestSha256", "request", "receivedAt", "effect", "creationDisposition"])
        && v.contract === GOAL_TASK_CONTRACT && v.status === "recorded" && one(v.action, ["reserve", "record"])
        && v.operationId === operationId && v.requestSha256 === digest && isTimestamp(v.receivedAt) && one(v.effect, ["applied", "historical", "duplicate"])))
        return false;
    try {
        const input = parseGoalTaskInput(v.action, v.request);
        return input.operationId === operationId && teachingRequestSha256(input) === digest && (v.action === "reserve"
            ? v.effect === "applied" && (recovering ? v.creationDisposition === "reconcile_only" : one(v.creationDisposition, ["fresh", "reconcile_only"]))
            : v.creationDisposition === null);
    }
    catch {
        return false;
    }
}
function snapshot(v, goalId) {
    if (!exact(v, ["goalId", "currentGoalVersion", "reservation", "createdAt", "creation", "decision", "delivery", "hostObservation", "materials", "latestReport",
        "reportMatchesCurrentGoal", "reportMatchesCurrentDecision", "materialsMatchCurrentGoal", "hostEvidence"])
        || v.goalId !== goalId || !integer(v.currentGoalVersion) || !isTimestamp(v.createdAt) || v.hostEvidence !== "reported_not_server_verified")
        return false;
    let reservation;
    try {
        reservation = parseGoalTaskInput("reserve", v.reservation);
        if (reservation.goalId !== goalId || reservation.goalVersion > Number(v.currentGoalVersion))
            return false;
    }
    catch {
        return false;
    }
    if (!exact(v.decision, ["version", "goalVersion", "intent", "reason", "recordedAt"]) || !integer(v.decision.version) || !integer(v.decision.goalVersion)
        || v.decision.goalVersion > Number(v.currentGoalVersion) || v.decision.goalVersion < reservation.goalVersion
        || !one(v.decision.intent, ["active", "paused"]) || !(v.decision.reason === null || text(v.decision.reason, 512)) || !isTimestamp(v.decision.recordedAt))
        return false;
    for (const [key, kind] of [["creation", "creation"], ["delivery", "delivery"], ["hostObservation", "observation"], ["materials", "materials"]])
        if (v[key] !== null && (!validGoalTaskEvent(v[key]) || v[key].kind !== kind))
            return false;
    const creation = v.creation;
    if (creation !== null && (creation.hostId !== reservation.hostId || creation.sourceThreadId !== reservation.sourceThreadId))
        return false;
    for (const key of ["delivery", "hostObservation", "materials"]) {
        const event = v[key];
        if (event !== null && (creation?.status !== "created" || event.task.hostId !== creation.task?.hostId || event.task.threadId !== creation.task?.threadId
            || event.goalVersion > Number(v.currentGoalVersion) || event.goalVersion < reservation.goalVersion
            || "decisionVersion" in event && event.decisionVersion > v.decision.version))
            return false;
    }
    const report = v.latestReport;
    if (report !== null && !(exact(report, ["reportId", "goalVersion", "decisionVersion", "sequence", "status", "progressPreview", "resultCount", "receivedAt"])
        && uuid(report.reportId) && integer(report.goalVersion) && integer(report.decisionVersion) && integer(report.sequence)
        && one(report.status, ["working", "needs_input", "completed"]) && typeof report.progressPreview === "string"
        && report.progressPreview.length > 0 && Buffer.byteLength(report.progressPreview) <= 512 && integer(report.resultCount, 0, 4) && isTimestamp(report.receivedAt)))
        return false;
    return v.reportMatchesCurrentGoal === (report !== null && report.goalVersion === v.currentGoalVersion)
        && v.reportMatchesCurrentDecision === (report !== null && report.goalVersion === v.currentGoalVersion
            && report.decisionVersion === v.decision.version && v.decision.goalVersion === v.currentGoalVersion)
        && v.materialsMatchCurrentGoal === (v.materials !== null && v.materials.goalVersion === v.currentGoalVersion);
}
function recentItem(v) {
    if (!exact(v, ["goalId", "goalVersion", "objectivePreview", "goalUpdatedAt", "activityAt", "task", "decision", "decisionMatchesCurrentGoal",
        "latestReport", "reportMatchesCurrentGoal", "reportMatchesCurrentDecision", "results"])
        || !uuid(v.goalId) || !integer(v.goalVersion) || typeof v.objectivePreview !== "string" || !v.objectivePreview.isWellFormed()
        || Buffer.byteLength(v.objectivePreview) < 1 || Buffer.byteLength(v.objectivePreview) > 480
        || !recentTimestamp(v.goalUpdatedAt) || !recentTimestamp(v.activityAt))
        return false;
    if ((v.task === null) !== (v.decision === null))
        return false;
    if (v.task !== null) {
        if (!exact(v.task, ["creationStatus", "entry", "hostEvidence"])
            || !one(v.task.creationStatus, ["reserved", "created", "pending", "unknown", "not_found", "rejected"])
            || v.task.hostEvidence !== "reported_not_server_verified")
            return false;
        if (v.task.creationStatus === "created") {
            if (!exact(v.task.entry, ["hostId", "threadId", "entryUri"]) || !text(v.task.entry.hostId, 128)
                || !nativeId(v.task.entry.threadId) || v.task.entry.entryUri !== `codex://threads/${v.task.entry.threadId}`)
                return false;
        }
        else if (v.task.entry !== null)
            return false;
    }
    if (v.decision !== null && (!exact(v.decision, ["version", "goalVersion", "intent", "recordedAt"])
        || !integer(v.decision.version) || !integer(v.decision.goalVersion) || v.decision.goalVersion > v.goalVersion
        || !one(v.decision.intent, ["active", "paused"]) || !isTimestamp(v.decision.recordedAt)))
        return false;
    const decision = v.decision;
    const report = v.latestReport;
    if (report !== null && (!exact(report, ["reportId", "goalVersion", "decisionVersion", "sequence", "status", "progressPreview", "resultCount", "receivedAt"])
        || !uuid(report.reportId) || !integer(report.goalVersion) || report.goalVersion > v.goalVersion
        || !integer(report.decisionVersion) || decision === null || report.decisionVersion > decision.version
        || !integer(report.sequence) || !one(report.status, ["working", "needs_input", "completed"])
        || typeof report.progressPreview !== "string" || report.progressPreview.length === 0 || Buffer.byteLength(report.progressPreview) > 512
        || !integer(report.resultCount, 0, 4) || !isTimestamp(report.receivedAt)
        || !teachingObject(v.task) || v.task.creationStatus !== "created"))
        return false;
    const currentReport = report;
    const decisionMatches = decision !== null && decision.goalVersion === v.goalVersion;
    const reportMatches = currentReport !== null && currentReport.goalVersion === v.goalVersion;
    const reportDecisionMatches = reportMatches && decisionMatches && currentReport.decisionVersion === decision.version;
    if (v.decisionMatchesCurrentGoal !== decisionMatches || v.reportMatchesCurrentGoal !== reportMatches
        || v.reportMatchesCurrentDecision !== reportDecisionMatches || !Array.isArray(v.results) || v.results.length > 4
        || v.results.length !== (reportDecisionMatches ? currentReport.resultCount : 0))
        return false;
    return v.results.every(i => exact(i, ["id", "uri", "sha256", "access", "verification"])
        && text(i.id, 64) && text(i.uri, 512) && (i.sha256 === null || hash(i.sha256))
        && one(i.access, ["local", "private", "shared", "unknown"]) && text(i.verification, 512))
        && new Set(v.results.map(i => i.id)).size === v.results.length;
}
export function validGoalTaskResult(action, value, input) {
    if (!teachingObject(value) || value.contract !== GOAL_TASK_CONTRACT)
        return false;
    if (action === "reserve" || action === "record") {
        const p = input;
        return receipt(value, p.operationId, teachingRequestSha256(p), false) && value.action === action && canonicalTeachingJson(value.request) === canonicalTeachingJson(p);
    }
    if (action === "operation") {
        const p = input;
        return value.operationId === p.operationId && value.requestSha256 === p.requestSha256
            && (value.status === "not_found" && value.terminal === false && exact(value, ["contract", "status", "terminal", "operationId", "requestSha256"])
                || value.status === "completed" && value.terminal === true && exact(value, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"])
                    && receipt(value.receipt, p.operationId, p.requestSha256, true));
    }
    const p = input;
    if (Buffer.byteLength(canonicalTeachingJson(value)) > p.budgetBytes)
        return false;
    if (p.view === "recent") {
        if (!exact(value, ["contract", "status", "view", "items", "nextAfter"]) || value.status !== "listed" || value.view !== "recent"
            || !Array.isArray(value.items) || value.items.length > p.limit)
            return false;
        let previous = p.after;
        const seen = new Set();
        for (const item of value.items) {
            if (!recentItem(item) || seen.has(item.goalId) || previous !== null
                && !(item.activityAt < previous.activityAt || item.activityAt === previous.activityAt && item.goalId < previous.goalId))
                return false;
            seen.add(item.goalId);
            previous = { activityAt: item.activityAt, goalId: item.goalId };
        }
        return value.nextAfter === null || value.items.length > 0 && recentCursor(value.nextAfter) && previous !== null
            && value.nextAfter.activityAt === previous.activityAt && value.nextAfter.goalId === previous.goalId;
    }
    if (p.view === "snapshot")
        return exact(value, ["contract", "status", "snapshot"])
            && (value.status === "not_found" && value.snapshot === null || value.status === "found" && snapshot(value.snapshot, p.goalId));
    const receiptOrdered = "afterReceiptIndex" in p;
    const nextCursor = receiptOrdered ? "nextAfterReceiptIndex" : "nextAfterSequence";
    if (!exact(value, ["contract", "status", "goalId", "items", nextCursor]) || value.status !== "listed" || value.goalId !== p.goalId
        || !Array.isArray(value.items) || value.items.length > p.limit)
        return false;
    let previous = (receiptOrdered ? p.afterReceiptIndex : p.afterSequence) ?? 0;
    for (const item of value.items) {
        if (!exact(item, receiptOrdered ? ["event", "receivedAt", "receiptIndex"] : ["event", "receivedAt"])
            || !validGoalTaskEvent(item.event) || item.event.kind !== "report" || !isTimestamp(item.receivedAt))
            return false;
        // Receipt order includes late reports without changing the source event's
        // own sequence or the legacy sequence-ordered response contract.
        const position = receiptOrdered ? item.receiptIndex : item.event.sequence;
        if (!integer(position, 1, Number.MAX_SAFE_INTEGER) || position <= previous)
            return false;
        previous = position;
    }
    return value[nextCursor] === null || value.items.length > 0 && value[nextCursor] === previous;
}
export const goalTaskToolAction = (name) => name === "aidesk_goal_task_reserve" ? "reserve"
    : name === "aidesk_goal_task_record" ? "record" : name === "aidesk_goal_task_read" ? "read" : name === "aidesk_goal_task_operation" ? "operation" : undefined;
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const str = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const id = { type: "string", format: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" };
const native = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const sha = { type: "string", pattern: "^[a-f0-9]{64}$" };
const num = { type: "integer", minimum: 1, maximum: 2147483647 };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const choice = (...values) => ({ type: "string", enum: values });
const base = { contract: { const: GOAL_TASK_CONTRACT }, operationId: id };
const timed = { sequence: num, occurredAt: { type: "string", format: "date-time" } };
const bound = { ...timed, goalVersion: num, task: obj({ hostId: str(128), threadId: native }) };
const eventSchemas = [
    obj({ kind: { const: "creation" }, ...timed, hostId: str(128), sourceThreadId: native, status: choice("created", "pending", "unknown", "not_found", "rejected"),
        clientThreadId: nullable(native), task: nullable(obj({ hostId: str(128), threadId: native, entryUri: str(512), visible: { const: true } })), evidenceRef: nullable(str(512)) }),
    obj({ kind: { const: "materials" }, ...bound, evidenceRef: str(512), items: { type: "array", maxItems: 8,
            items: obj({ id: str(64), uri: str(512), sha256: nullable(sha), read: { type: "boolean" }, observation: str(512) }) } }),
    obj({ kind: { const: "decision" }, goalVersion: num, expectedDecisionVersion: { ...num, maximum: 2147483646 }, intent: choice("active", "paused"), reason: str(512) }),
    obj({ kind: { const: "delivery" }, ...bound, decisionVersion: num, status: choice("delivered", "unknown", "rejected"), evidenceRef: nullable(str(512)) }),
    obj({ kind: { const: "observation" }, ...bound, decisionVersion: num, status: choice("running", "paused", "completed", "unknown"), entry: choice("accessible", "inaccessible", "unknown"), evidenceRef: str(512) }),
    obj({ kind: { const: "report" }, ...bound, reportId: id, decisionVersion: num, status: choice("working", "needs_input", "completed"), progress: str(2048),
        limitations: { type: "array", maxItems: 8, items: str(512) }, results: { type: "array", maxItems: 4,
            items: obj({ id: str(64), uri: str(512), sha256: nullable(sha), access: choice("local", "private", "shared", "unknown"), verification: str(512) }) } }),
];
export const goalTaskToolDefinitions = [
    { name: "aidesk_goal_task_reserve", description: "保存本人已受理目标的唯一创建原件；不创建宿主任务。仅首次确定收到fresh可接续原创建；丢失、重复或换号已存在时只对账，服务原号不保证宿主创建幂等。",
        inputSchema: obj({ ...base, goalId: id, goalVersion: num, attemptId: id, serviceOperationId: id, serviceRequestSha256: sha, hostId: str(128), sourceThreadId: native }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_task_record", description: "记录原目标任务的创建回执、材料阻碍、用户决定、转达、宿主观察或必要Agent报告。来源声明不等于服务独立验证；不审批执行，未读材料不阻止保存真实进展，旧报告不覆盖新决定。",
        inputSchema: obj({ ...base, goalId: id, attemptId: id, event: { oneOf: eventSchemas } }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_task_read", description: "有界读取本人的最近目标及原任务入口、任务关联、分离的决定/送达/宿主来源事实，或必要报告。budgetBytes为1024–24576的整数字节预算，分页limit取1–16。recent按activityAt与goalId倒序，用返回的nextAfter原样续页；activityAt须为UTC六位微秒时间。报告优先使用afterReceiptIndex读取迟到报告；afterSequence仅兼容旧客户端。当前匹配只描述记录，不证明宿主或文件真可达、目标完成或人的能力。",
        inputSchema: { type: "object", oneOf: [obj({ contract: base.contract, goalId: id, view: { const: "snapshot" }, budgetBytes: { type: "integer", minimum: 1024, maximum: 24576 } }),
                obj({ contract: base.contract, goalId: id, view: { const: "reports" }, afterReceiptIndex: nullable({ ...num, minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), limit: { type: "integer", minimum: 1, maximum: 16 }, budgetBytes: { type: "integer", minimum: 1024, maximum: 24576 } }),
                obj({ contract: base.contract, goalId: id, view: { const: "reports" }, afterSequence: nullable({ ...num, minimum: 0 }), limit: { type: "integer", minimum: 1, maximum: 16 }, budgetBytes: { type: "integer", minimum: 1024, maximum: 24576 } }),
                obj({ contract: base.contract, view: { const: "recent" }, after: nullable(obj({ activityAt: { type: "string", format: "date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$" }, goalId: id })),
                    limit: { type: "integer", minimum: 1, maximum: 16 }, budgetBytes: { type: "integer", minimum: 1024, maximum: 24576 } })] },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "aidesk_goal_task_operation", description: "核本人原号及摘要；恢复创建原件永远只对账，不返回再次创建许可。not_found不证明持久取消；只补记原报告，不重跑成果。",
        inputSchema: obj({ ...base, requestSha256: sha }), annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
];
// The server exposes the new variant only to a package that opts in. Older
// packages retain their original description and three read-schema branches.
export const legacyGoalTaskToolDefinitions = goalTaskToolDefinitions.map(tool => tool.name === "aidesk_goal_task_read" ? {
    ...tool,
    description: "有界读取本人的任务关联、分离的决定/送达/宿主来源事实，或必要报告。snapshot与reports的budgetBytes均为1024–24576的整数字节预算。报告分页limit取1–16，优先使用afterReceiptIndex，按接收顺序读取迟到报告；afterSequence仅兼容旧客户端。当前匹配只描述记录，不证明真实宿主可进入或目标完成。",
    inputSchema: { type: "object", oneOf: tool.inputSchema.oneOf.slice(0, 3) },
} : tool);
