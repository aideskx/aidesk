// Generated from services/authority-api/src/goal-data-export-contract.ts; source SHA-256 e5941cac69de5e4fb4dd99f9f3720f43313620a928b47da6ffe0179e60c0d998.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Read-only implementation contract, not a retention policy or an account-wide
 * data-rights claim. References are exported as references; no linked file fetch. */
export const GOAL_DATA_EXPORT_CONTRACT = "aidesk-goal-data-export-v1";
export const GOAL_DATA_EXPORT_LIMITS = Object.freeze({ requestBytes: 1024, transportBytes: 16384, documentBytes: 4194304, records: 10000, chunkBytes: 8192 });
export const GOAL_DATA_EXPORT_EXCLUSIONS = ["unlinked_publications_and_responses", "other_goals", "orders_and_account_data", "legacy_namespace", "other_devices_and_host_history", "referenced_file_bytes"];
export class GoalDataExportError extends Error {
    kind;
    constructor(kind) {
        super(kind === "goal_deleted" ? "该目标内容已删除，无法导出旧正文。" : "本人目标导出未完成；请保留原件并按准确目标重新核对。");
        this.kind = kind;
        this.name = "GoalDataExportError";
    }
}
const exact = (v, keys) => teachingObject(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const uuid = (v) => typeof v === "string" && isUuid(v) && v === v.toLowerCase();
const int = (v, min, max) => typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
export function parseGoalDataExportInput(action, value) {
    let p;
    try {
        p = parseTeachingJson(typeof value === "string" ? value : canonicalTeachingJson(value), GOAL_DATA_EXPORT_LIMITS.requestBytes);
    }
    catch {
        throw new GoalDataExportError("invalid_input");
    }
    if (action !== "read" || !exact(p, ["contract", "goalId", "snapshot", "offset", "chunkBytes"]) || p.contract !== GOAL_DATA_EXPORT_CONTRACT || !uuid(p.goalId)
        || !(p.snapshot === null || hash(p.snapshot)) || !int(p.offset, 0, GOAL_DATA_EXPORT_LIMITS.documentBytes - 1) || p.snapshot === null && p.offset !== 0
        || !int(p.chunkBytes, 1024, GOAL_DATA_EXPORT_LIMITS.chunkBytes))
        throw new GoalDataExportError("invalid_input");
    return p;
}
export function validGoalDataExportResult(_action, v, p) {
    if (!teachingObject(v) || v.contract !== GOAL_DATA_EXPORT_CONTRACT || v.goalId !== p.goalId)
        return false;
    if (v.status === "not_found")
        return p.snapshot === null && exact(v, ["contract", "status", "goalId"]);
    if (!exact(v, ["contract", "status", "goalId", "snapshot", "totalBytes", "offset", "nextOffset", "data", "chunkSha256"])
        || v.status !== "chunk" || !hash(v.snapshot) || p.snapshot !== null && v.snapshot !== p.snapshot
        || !int(v.totalBytes, 1, GOAL_DATA_EXPORT_LIMITS.documentBytes) || v.offset !== p.offset || p.offset >= v.totalBytes
        || typeof v.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(v.data) || !hash(v.chunkSha256))
        return false;
    const bytes = Buffer.from(v.data, "base64"), end = p.offset + bytes.length;
    return bytes.toString("base64") === v.data && bytes.length === Math.min(p.chunkBytes, v.totalBytes - p.offset)
        && teachingRequestSha256(bytes.toString("base64")) === v.chunkSha256 && v.nextOffset === (end === v.totalBytes ? null : end)
        && Buffer.byteLength(canonicalTeachingJson(v)) <= GOAL_DATA_EXPORT_LIMITS.transportBytes;
}
const kinds = ["goal", "revision", "draft_operation", "service_operation", "task_link", "task_operation", "adoption", "adoption_operation", "parent_link", "parent_operation"];
const tools = { draft_operation: ["aidesk_goal_draft_save"], service_operation: ["aidesk_goal_service_cooperate"],
    task_operation: ["aidesk_goal_task_reserve", "aidesk_goal_task_record"], adoption_operation: ["aidesk_goal_network_adopt"] };
export function validGoalExportDocument(v, goalId) {
    if (!exact(v, ["contract", "goalId", "exclusions", "records"]) || v.contract !== GOAL_DATA_EXPORT_CONTRACT || v.goalId !== goalId
        || canonicalTeachingJson(v.exclusions) !== canonicalTeachingJson(GOAL_DATA_EXPORT_EXCLUSIONS) || !Array.isArray(v.records)
        || v.records.length < 2 || v.records.length > GOAL_DATA_EXPORT_LIMITS.records)
        return false;
    const seen = new Set(), ops = new Set();
    let goals = 0;
    for (const r of v.records) {
        if (!exact(r, ["kind", "id", "data", "localOperation"]) || typeof r.kind !== "string" || !kinds.includes(r.kind) || typeof r.id !== "string"
            || !/^[a-z0-9-]{1,64}$/u.test(r.id) || !teachingObject(r.data) || seen.has(`${r.kind}:${r.id}`))
            return false;
        seen.add(`${r.kind}:${r.id}`);
        if (["draft_operation", "task_link", "task_operation", "adoption"].includes(r.kind) && r.data.goal_id !== goalId)
            return false;
        if (r.kind === "revision" && (r.data.goalId !== goalId || String(r.data.version) !== r.id))
            return false;
        if (["service_operation", "adoption_operation"].includes(r.kind)
            && (!teachingObject(r.data.request) || !teachingObject(r.data.request.goalRef) || r.data.request.goalRef.goalId !== goalId))
            return false;
        if (r.kind === "parent_link" && (r.data.role !== "owner" || !teachingObject(r.data.goalRef) || r.data.goalRef.goalId !== goalId))
            return false;
        if (["draft_operation", "service_operation", "task_operation"].includes(r.kind)
            && (!teachingObject(r.data.request) || teachingRequestSha256(r.data.request) !== r.data.request_sha256))
            return false;
        if (r.kind === "goal") {
            goals++;
            if (r.id !== goalId || r.data.goalId !== goalId || !int(r.data.currentVersion, 1, 2147483647))
                return false;
        }
        if (r.localOperation === null) {
            if (tools[r.kind])
                return false;
        }
        else {
            const o = r.localOperation;
            if (!exact(o, ["tool", "operationId", "requestSha256"]) || typeof o.tool !== "string" || !tools[r.kind]?.includes(o.tool)
                || !uuid(o.operationId) || o.operationId !== r.id || !hash(o.requestSha256) || ops.has(o.operationId)
                || r.data.operation_id !== o.operationId || r.data.request_sha256 !== o.requestSha256)
                return false;
            ops.add(o.operationId);
        }
    }
    return goals === 1;
}
/** Pages have already passed same-account MCP transport verification. A full
 * digest is verified before interpreting or writing any goal/body data. */
export function assembleGoalExport(pages) {
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 4096)
        throw new GoalDataExportError("invalid_input");
    const chunks = [];
    let offset = 0, snapshot = null, total = 0;
    const goalId = pages[0].input.goalId;
    for (const [index, page] of pages.entries()) {
        const p = parseGoalDataExportInput("read", page.input), r = page.result;
        if (p.goalId !== goalId || p.offset !== offset || p.snapshot !== snapshot || !validGoalDataExportResult("read", r, p) || r.status !== "chunk"
            || index > 0 && r.totalBytes !== total || r.nextOffset === null && index !== pages.length - 1)
            throw new GoalDataExportError("version_conflict");
        snapshot = r.snapshot;
        total = r.totalBytes;
        const chunk = Buffer.from(r.data, "base64");
        chunks.push(chunk);
        offset += chunk.length;
    }
    const bytes = Buffer.concat(chunks);
    let document;
    try {
        document = parseTeachingJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), GOAL_DATA_EXPORT_LIMITS.documentBytes);
    }
    catch {
        throw new GoalDataExportError("invalid_input");
    }
    // Same canonical JSON digest used by the SQL owner (strings remain exact).
    if (offset !== total || !validGoalExportDocument(document, goalId) || teachingRequestSha256(document) !== snapshot
        || !bytes.equals(Buffer.from(canonicalTeachingJson(document))))
        throw new GoalDataExportError("version_conflict");
    return { document, bytes, snapshot: snapshot };
}
export const goalDataExportToolAction = (name) => name === "aidesk_goal_data_export" ? "read" : undefined;
export const goalDataExportToolDefinitions = [{ name: "aidesk_goal_data_export", description: "只读导出本人准确目标的历史修订、任务记录及明确关联副本。分段必须同一snapshot并核完整摘要；不含独立发表回应、订单、宿主历史或引用文件字节，不删除或改变原件。",
        inputSchema: { type: "object", additionalProperties: false, required: ["contract", "goalId", "snapshot", "offset", "chunkBytes"], properties: {
                contract: { const: GOAL_DATA_EXPORT_CONTRACT }, goalId: { type: "string", format: "uuid" }, snapshot: { anyOf: [{ type: "string", pattern: "^[a-f0-9]{64}$" }, { type: "null" }] },
                offset: { type: "integer", minimum: 0, maximum: 4194303 }, chunkBytes: { type: "integer", minimum: 1024, maximum: 8192 }
            } },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }];
