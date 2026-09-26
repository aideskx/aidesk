// Generated from services/authority-api/src/goal-data-export-contract.ts; source SHA-256 cd8e1064d705e7caf540ae33be73c66b64bd86083f5f0e9e114634717b84c4d2.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { validGoalCommunityReportItem, validGoalCommunityReportReceipt } from "./goal-community-report-contract.mjs";
import { validGoalCommunityNotificationItem, validGoalCommunityNotificationProactive, validGoalCommunityNotificationMute, validGoalCommunityNotificationReceipt } from "./goal-community-notification-contract.mjs";
import { GOAL_COMMUNITY_COMMENT_CONTRACT, parseGoalCommunityCommentInput, validGoalCommunityCommentReceipt, goalCommunityCommentMetadata } from "./goal-community-comment-contract.mjs";
import { GOAL_FINALIZATION_CONTRACT, parseGoalFinalizationInput, validGoalFinalizationResult } from "./goal-finalization-contract.mjs";
import { GOAL_COMMUNITY_CONTRACT, parseGoalCommunityInput, validGoalCommunityResult } from "./goal-community-contract.mjs";
import { validGoalCommunityInteractionAdoption, validGoalCommunityInteractionRelation, validGoalCommunityInteractionReceipt } from "./goal-community-interaction-contract.mjs";
import { GOAL_COMMUNITY_REPORT_SCOPE, GOAL_COMMUNITY_REPORT_EXCLUSIONS, validGoalCommunityReportDataTarget, goalCommunityReportDataTargetSchema, GOAL_COMMUNITY_RELATIONSHIP_SCOPE, GOAL_COMMUNITY_RELATIONSHIP_EXCLUSIONS, validGoalCommunityRelationshipTarget, goalCommunityRelationshipTargetSchema, GOAL_COMMUNITY_NOTIFICATION_SCOPE, GOAL_COMMUNITY_NOTIFICATION_SETTINGS_SCOPE, GOAL_COMMUNITY_NOTIFICATION_EXCLUSIONS, GOAL_COMMUNITY_NOTIFICATION_SETTINGS_EXCLUSIONS, validGoalCommunityNotificationTarget, goalCommunityNotificationTargetSchema, GOAL_COMMUNITY_COMMENT_SCOPE, GOAL_COMMUNITY_COMMENT_EXCLUSIONS, validGoalCommunityCommentTarget, goalCommunityCommentTargetSchema } from "./goal-network-delete-contract.mjs";
import { isUuid, isTimestamp } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
/** Read-only implementation contract, not a retention policy or an account-wide
 * data-rights claim. References are exported as references; no linked file fetch. */
export const GOAL_DATA_EXPORT_CONTRACT = "aidesk-goal-data-export-v1";
export const GOAL_DATA_EXPORT_V2_CONTRACT = "aidesk-goal-data-export-v2";
export const GOAL_DATA_EXPORT_V3_CONTRACT = "aidesk-goal-data-export-v3";
export const GOAL_DATA_EXPORT_V4_CONTRACT = "aidesk-goal-data-export-v4";
export const GOAL_DATA_EXPORT_V5_CONTRACT = "aidesk-goal-data-export-v5";
export const GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT = "aidesk-goal-community-report-export-v1";
export const GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT = "aidesk-goal-community-notification-export-v1";
export const GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT = "aidesk-goal-community-comment-export-v1";
export const GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT = "aidesk-goal-community-relationship-export-v1";
const exportContract = (v) => v === GOAL_DATA_EXPORT_CONTRACT || v === GOAL_DATA_EXPORT_V2_CONTRACT || v === GOAL_DATA_EXPORT_V3_CONTRACT || v === GOAL_DATA_EXPORT_V4_CONTRACT || v === GOAL_DATA_EXPORT_V5_CONTRACT;
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
    if (action !== "read" || !teachingObject(p) || !(p.contract === GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT
        ? exact(p, ["contract", "target", "snapshot", "offset", "chunkBytes"]) && validGoalCommunityReportDataTarget(p.target)
        : p.contract === GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT
            ? exact(p, ["contract", "target", "snapshot", "offset", "chunkBytes"]) && validGoalCommunityNotificationTarget(p.target)
            : p.contract === GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT
                ? exact(p, ["contract", "target", "snapshot", "offset", "chunkBytes"]) && validGoalCommunityCommentTarget(p.target)
                : p.contract === GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT
                    ? exact(p, ["contract", "target", "snapshot", "offset", "chunkBytes"]) && validGoalCommunityRelationshipTarget(p.target)
                    : exact(p, ["contract", "goalId", "snapshot", "offset", "chunkBytes"]) && exportContract(p.contract) && uuid(p.goalId))
        || !(p.snapshot === null || hash(p.snapshot)) || !int(p.offset, 0, GOAL_DATA_EXPORT_LIMITS.documentBytes - 1) || p.snapshot === null && p.offset !== 0
        || !int(p.chunkBytes, 1024, GOAL_DATA_EXPORT_LIMITS.chunkBytes))
        throw new GoalDataExportError("invalid_input");
    return p;
}
export function validGoalDataExportResult(_action, v, p) {
    const targeted = "target" in p, field = targeted ? "target" : "goalId";
    if (!teachingObject(v) || v.contract !== p.contract || (targeted ? !(p.contract === GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT ? validGoalCommunityReportDataTarget(v.target) : p.contract === GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT ? validGoalCommunityNotificationTarget(v.target) : p.contract === GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT ? validGoalCommunityCommentTarget(v.target) : validGoalCommunityRelationshipTarget(v.target))
        || canonicalTeachingJson(v.target) !== canonicalTeachingJson(p.target) : v.goalId !== p.goalId))
        return false;
    if (v.status === "not_found")
        return p.snapshot === null && exact(v, ["contract", "status", field]);
    if (!exact(v, ["contract", "status", field, "snapshot", "totalBytes", "offset", "nextOffset", "data", "chunkSha256"])
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
const finalizationKinds = ["finalization_lifecycle", "finalization", "finalization_operation"];
const communityKinds = ["community_binding", "community_revision", "community_operation"];
const commentKinds = ["community_comment", "community_comment_operation"];
const adoptionKinds = ["community_adoption", "community_adoption_operation"];
const tools = { community_operation: ["aidesk_goal_community_publish", "aidesk_goal_community_close", "aidesk_goal_community_reopen"], finalization_operation: ["aidesk_goal_finalization_finalize"], draft_operation: ["aidesk_goal_draft_save"], service_operation: ["aidesk_goal_service_cooperate"],
    task_operation: ["aidesk_goal_task_reserve", "aidesk_goal_task_record"], adoption_operation: ["aidesk_goal_network_adopt"], community_adoption_operation: ["aidesk_goal_community_interaction_adopt"] };
export function validGoalExportDocument(v, goalId) {
    if (!exact(v, ["contract", "goalId", "exclusions", "records"]) || !exportContract(v.contract) || v.goalId !== goalId
        || canonicalTeachingJson(v.exclusions) !== canonicalTeachingJson(GOAL_DATA_EXPORT_EXCLUSIONS) || !Array.isArray(v.records)
        || v.records.length < 2 || v.records.length > GOAL_DATA_EXPORT_LIMITS.records)
        return false;
    const seen = new Set(), ops = new Set();
    let goals = 0;
    for (const r of v.records) {
        if (!exact(r, ["kind", "id", "data", "localOperation"]) || typeof r.kind !== "string" || !(kinds.includes(r.kind)
            || v.contract !== GOAL_DATA_EXPORT_CONTRACT && finalizationKinds.includes(r.kind)
            || [GOAL_DATA_EXPORT_V3_CONTRACT, GOAL_DATA_EXPORT_V4_CONTRACT, GOAL_DATA_EXPORT_V5_CONTRACT].includes(v.contract) && communityKinds.includes(r.kind)
            || [GOAL_DATA_EXPORT_V4_CONTRACT, GOAL_DATA_EXPORT_V5_CONTRACT].includes(v.contract) && adoptionKinds.includes(r.kind)
            || v.contract === GOAL_DATA_EXPORT_V5_CONTRACT && commentKinds.includes(r.kind)) || typeof r.id !== "string"
            || !/^[a-z0-9-]{1,64}$/u.test(r.id) || !teachingObject(r.data) || seen.has(`${r.kind}:${r.id}`))
            return false;
        seen.add(`${r.kind}:${r.id}`);
        if (commentKinds.includes(r.kind))
            continue; // Validated together against the actual own binding below.
        if (["draft_operation", "task_link", "task_operation", "adoption", ...finalizationKinds, ...communityKinds, ...adoptionKinds].includes(r.kind) && r.data.goal_id !== goalId)
            return false;
        if (r.kind === "revision" && (r.data.goalId !== goalId || String(r.data.version) !== r.id))
            return false;
        if (["service_operation", "adoption_operation"].includes(r.kind)
            && (!teachingObject(r.data.request) || !teachingObject(r.data.request.goalRef) || r.data.request.goalRef.goalId !== goalId))
            return false;
        if (r.kind === "parent_link" && (r.data.role !== "owner" || !teachingObject(r.data.goalRef) || r.data.goalRef.goalId !== goalId))
            return false;
        if (["draft_operation", "service_operation", "task_operation", "finalization_operation", "community_operation"].includes(r.kind)
            && (!teachingObject(r.data.request) || teachingRequestSha256(r.data.request) !== r.data.request_sha256))
            return false;
        if (r.kind === "finalization_lifecycle" && (!exact(r.data, ["goal_id", "creation_operation_id", "created_at"])
            || r.id !== goalId || !uuid(r.data.creation_operation_id) || !isTimestamp(r.data.created_at)))
            return false;
        if (r.kind === "finalization" && (!exact(r.data, ["goal_id", "version", "goal_version", "sharing", "projection_sha256", "finalized_at"])
            || String(r.data.version) !== r.id || !int(r.data.version, 1, 2147483647) || !int(r.data.goal_version, 1, 2147483647)
            || !validGoalFinalizationResult("read", { contract: GOAL_FINALIZATION_CONTRACT, status: "found", goalId, defaultEligible: false,
                latestGoalVersion: r.data.goal_version, finalization: { goalId, version: r.data.version, goalVersion: r.data.goal_version,
                    sharing: r.data.sharing, projectionSha256: r.data.projection_sha256, finalizedAt: r.data.finalized_at } }, { contract: GOAL_FINALIZATION_CONTRACT, goalId, version: r.data.version })))
            return false;
        if (r.kind === "finalization_operation") {
            if (!exact(r.data, ["operation_id", "goal_id", "request_sha256", "request", "receipt", "created_at"]) || !isTimestamp(r.data.created_at))
                return false;
            try {
                const input = parseGoalFinalizationInput("finalize", r.data.request);
                if (input.goalId !== goalId || input.operationId !== r.id || !validGoalFinalizationResult("finalize", r.data.receipt, input))
                    return false;
            }
            catch {
                return false;
            }
        }
        if (r.kind === "community_binding" && (!exact(r.data, ["goal_id", "public_id", "state", "state_version", "current_version", "created_at", "updated_at", "closed_at"])
            || r.id !== r.data.public_id || !uuid(r.data.public_id) || !int(r.data.state_version, 1, 2147483647)
            || !int(r.data.current_version, 0, 2147483647) || !isTimestamp(r.data.created_at) || !isTimestamp(r.data.updated_at)
            || !(r.data.state === "published" && r.data.current_version > 0 && r.data.closed_at === null
                || r.data.state === "closed" && isTimestamp(r.data.closed_at))))
            return false;
        if (r.kind === "community_revision" && (!exact(r.data, ["goal_id", "version", "finalization_version", "state_version", "projection", "projection_sha256", "published_at", "content_erased_at"])
            || String(r.data.version) !== r.id || !int(r.data.version, 1, 2147483647) || !int(r.data.finalization_version, 1, 2147483647)
            || !int(r.data.state_version, 1, 2147483647) || !hash(r.data.projection_sha256) || !isTimestamp(r.data.published_at)
            || r.data.content_erased_at !== null || !exact(r.data.projection, ["title", "text"])
            || teachingRequestSha256(r.data.projection) !== r.data.projection_sha256))
            return false;
        if (r.kind === "community_operation") {
            if (!exact(r.data, ["operation_id", "goal_id", "action", "request_sha256", "request", "receipt", "created_at"]) || !isTimestamp(r.data.created_at)
                || !(r.data.action === "publish" || r.data.action === "close" || r.data.action === "reopen"))
                return false;
            try {
                const input = parseGoalCommunityInput(r.data.action, r.data.request);
                if (input.goalId !== goalId || input.operationId !== r.id || !validGoalCommunityResult(r.data.action, { contract: GOAL_COMMUNITY_CONTRACT, status: "recorded", receipt: r.data.receipt }, input)
                    || !teachingObject(r.localOperation) || r.localOperation.tool !== `aidesk_goal_community_${r.data.action}`)
                    return false;
            }
            catch {
                return false;
            }
        }
        if (r.kind === "community_adoption" && (!validAdoptionData(r.data) || r.data.adoption_id !== r.id))
            return false;
        if (r.kind === "community_adoption_operation" && (!validInteractionOperation(r.data, "adopt") || r.data.operation_id !== r.id
            || !teachingObject(r.data.request) || !teachingObject(r.data.request.goalRef) || r.data.request.goalRef.goalId !== goalId))
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
                || !uuid(o.operationId) || o.operationId !== r.id || !hash(o.requestSha256) || ops.has(v.contract !== GOAL_DATA_EXPORT_CONTRACT ? `${o.tool}:${o.operationId}` : o.operationId)
                || r.data.operation_id !== o.operationId || r.data.request_sha256 !== o.requestSha256)
                return false;
            ops.add(v.contract !== GOAL_DATA_EXPORT_CONTRACT ? `${o.tool}:${o.operationId}` : o.operationId);
        }
    }
    return goals === 1 && validCommunityRecords(v.records) && validAdoptionRecords(v.records)
        && validCommentRecords(v.records.filter(r => commentKinds.includes(r.kind)), v.records.find(r => r.kind === "community_binding")?.data.public_id ?? null);
}
function adoptionValue(d) {
    return { adoptionId: d.adoption_id, source: { publicId: d.public_id, publicVersion: d.public_version, projectionSha256: d.projection_sha256 },
        authorId: d.author_id, goalRef: { goalId: d.goal_id, finalizationVersion: d.finalization_version }, usage: d.usage, createdAt: d.created_at };
}
function validAdoptionData(d) {
    return exact(d, ["adoption_id", "goal_id", "finalization_version", "public_id", "public_version", "author_id", "projection_sha256", "usage", "created_at", "erased_at"])
        && d.erased_at === null && validGoalCommunityInteractionAdoption(adoptionValue(d));
}
function validInteractionOperation(d, action) {
    if (!exact(d, ["operation_id", "action", "goal_id", "public_id", "generation", "request_sha256", "request", "receipt", "created_at", "erased_at"])
        || d.action !== action || !uuid(d.operation_id) || !hash(d.request_sha256) || !isTimestamp(d.created_at) || d.erased_at !== null
        || !validGoalCommunityInteractionReceipt(d.receipt, d.operation_id, d.request_sha256) || d.receipt.action !== action
        || canonicalTeachingJson(d.request) !== canonicalTeachingJson(d.receipt.request) || Date.parse(d.created_at) !== Date.parse(String(d.receipt.recordedAt)))
        return false;
    const p = d.request;
    return action === "adopt" ? uuid(d.goal_id) && d.generation === null && teachingObject(p.goalRef) && p.goalRef.goalId === d.goal_id
        && teachingObject(p.source) && p.source.publicId === d.public_id
        : d.goal_id === null && p.publicId === d.public_id && p.expectedGeneration === d.generation;
}
function validAdoptionRecords(records) {
    const facts = new Map(records.filter(r => r.kind === "community_adoption").map(r => [r.id, r.data]));
    const covered = new Set(), finalizations = new Set(records.filter(r => r.kind === "finalization").map(r => r.data.version));
    for (const d of facts.values())
        if (!finalizations.has(d.finalization_version))
            return false;
    for (const r of records.filter(r => r.kind === "community_adoption_operation")) {
        const receipt = r.data.receipt, a = receipt.adoption, fact = facts.get(String(a.adoptionId));
        if (!fact || canonicalTeachingJson(a) !== canonicalTeachingJson(adoptionValue(fact)))
            return false;
        covered.add(String(a.adoptionId));
    }
    return covered.size === facts.size;
}
function validCommunityRecords(records) {
    const bindings = records.filter(r => r.kind === "community_binding"), revisions = records.filter(r => r.kind === "community_revision"), operations = records.filter(r => r.kind === "community_operation");
    if (bindings.length === 0)
        return revisions.length === 0 && operations.length === 0;
    if (bindings.length !== 1)
        return false;
    const binding = bindings[0].data;
    if (revisions.length !== binding.current_version)
        return false;
    const finalizations = new Map(records.filter(r => r.kind === "finalization").map(r => [r.data.version, r.data]));
    for (const revision of revisions) {
        const r = revision.data, source = finalizations.get(r.finalization_version);
        if (!source || !teachingObject(source.sharing) || source.sharing.enabled !== true || source.projection_sha256 !== r.projection_sha256
            || canonicalTeachingJson(source.sharing.projection) !== canonicalTeachingJson(r.projection)
            || Number(r.version) > Number(binding.current_version) || Number(r.state_version) > Number(binding.state_version))
            return false;
    }
    for (const operation of operations) {
        // The receipt is a historical publication snapshot, never a present grant.
        const result = operation.data.receipt;
        if (!teachingObject(result) || !teachingObject(result.publication)
            || result.publication.publicId !== binding.public_id
            || Number(result.publication.publicVersion) > Number(binding.current_version)
            || Number(result.publication.stateVersion) > Number(binding.state_version))
            return false;
    }
    return true;
}
/** Pages have already passed same-account MCP transport verification. A full
 * digest is verified before interpreting or writing any goal/body data. */
export function assembleGoalExport(pages) {
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 4096)
        throw new GoalDataExportError("invalid_input");
    const chunks = [];
    let offset = 0, snapshot = null, total = 0;
    const goalId = pages[0].input.goalId, contract = pages[0].input.contract;
    for (const [index, page] of pages.entries()) {
        const p = parseGoalDataExportInput("read", page.input), r = page.result;
        if (p.contract !== contract || p.goalId !== goalId || p.offset !== offset || p.snapshot !== snapshot || !validGoalDataExportResult("read", r, p) || r.status !== "chunk"
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
    if (offset !== total || !validGoalExportDocument(document, goalId) || document.contract !== contract || teachingRequestSha256(document) !== snapshot
        || !bytes.equals(Buffer.from(canonicalTeachingJson(document))))
        throw new GoalDataExportError("version_conflict");
    return { document, bytes, snapshot: snapshot };
}
function relationshipValue(d) {
    return { publicId: d.public_id, generation: d.generation, kind: d.kind, version: d.version, enabled: d.enabled,
        source: d.enabled === true ? { publicId: d.public_id, publicVersion: d.source_public_version, projectionSha256: d.source_projection_sha256 } : null,
        updatedAt: d.updated_at };
}
export function validGoalRelationshipExportDocument(v, target) {
    try {
        if (!validGoalCommunityRelationshipTarget(target) || !exact(v, ["contract", "target", "scope", "exclusions", "records"])
            || v.contract !== GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT || canonicalTeachingJson(v.target) !== canonicalTeachingJson(target)
            || v.scope !== GOAL_COMMUNITY_RELATIONSHIP_SCOPE || canonicalTeachingJson(v.exclusions) !== canonicalTeachingJson(GOAL_COMMUNITY_RELATIONSHIP_EXCLUSIONS)
            || !Array.isArray(v.records) || v.records.length < 1 || v.records.length > GOAL_DATA_EXPORT_LIMITS.records)
            return false;
        let scopes = 0;
        const seen = new Set(), relations = new Map(), operations = [];
        for (const r of v.records) {
            if (!exact(r, ["kind", "id", "data", "localOperation"]) || typeof r.id !== "string" || !teachingObject(r.data) || seen.has(`${r.kind}:${r.id}`))
                return false;
            seen.add(`${r.kind}:${r.id}`);
            const d = r.data;
            if (r.kind === "relationship_scope") {
                if (r.localOperation !== null || r.id !== target.publicId || !exact(d, ["publicId", "generation", "createdAt", "updatedAt"])
                    || d.publicId !== target.publicId || d.generation !== target.generation
                    || !(d.createdAt === null && d.updatedAt === null && target.generation === 1
                        || isTimestamp(d.createdAt) && isTimestamp(d.updatedAt) && Date.parse(d.createdAt) <= Date.parse(d.updatedAt)))
                    return false;
                scopes++;
                continue;
            }
            if (d.public_id !== target.publicId || d.generation !== target.generation)
                return false;
            if (r.kind === "community_relationship") {
                if (r.localOperation !== null || r.id !== d.kind
                    || !exact(d, ["public_id", "generation", "kind", "version", "enabled", "source_public_version", "source_projection_sha256", "created_at", "updated_at"])
                    || !isTimestamp(d.created_at) || !isTimestamp(d.updated_at) || Date.parse(d.created_at) > Date.parse(d.updated_at)
                    || d.enabled === false && (d.source_public_version !== null || d.source_projection_sha256 !== null)
                    || !validGoalCommunityInteractionRelation(relationshipValue(d)))
                    return false;
                relations.set(String(d.kind), d);
            }
            else if (r.kind === "community_relationship_operation") {
                if (!validInteractionOperation(d, "relation_set") || r.id !== d.operation_id
                    || !exact(r.localOperation, ["tool", "operationId", "requestSha256"]) || r.localOperation.tool !== "aidesk_goal_community_interaction_relation_set"
                    || r.localOperation.operationId !== r.id || r.localOperation.requestSha256 !== d.request_sha256)
                    return false;
                operations.push(d);
            }
            else
                return false;
        }
        if (scopes !== 1)
            return false;
        const versions = new Map();
        for (const op of operations) {
            const r = op.receipt.relation, row = relations.get(String(r.kind));
            if (!row || Number(r.version) > Number(row.version))
                return false;
            if (r.version === row.version && canonicalTeachingJson(r) !== canonicalTeachingJson(relationshipValue(row)))
                return false;
            const set = versions.get(String(r.kind)) ?? new Set();
            if (set.has(Number(r.version)))
                return false;
            set.add(Number(r.version));
            versions.set(String(r.kind), set);
        }
        return [...relations].every(([kind, row]) => versions.get(kind)?.size === row.version);
    }
    catch {
        return false;
    }
}
function assembleTargetExport(pages) {
    if (!Array.isArray(pages) || pages.length === 0 || pages.length > 4096)
        throw new GoalDataExportError("invalid_input");
    const chunks = [];
    let offset = 0, snapshot = null, total = 0;
    const target = pages[0].input.target, contract = pages[0].input.contract;
    for (const [index, page] of pages.entries()) {
        const p = parseGoalDataExportInput("read", page.input), r = page.result;
        if (p.contract !== contract || !("target" in p) || canonicalTeachingJson(p.target) !== canonicalTeachingJson(target)
            || p.offset !== offset || p.snapshot !== snapshot || !validGoalDataExportResult("read", r, p) || r.status !== "chunk"
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
    if (offset !== total || !(contract === GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT
        ? validGoalCommunityReportDataTarget(target) && validGoalReportExportDocument(document, target)
        : contract === GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT
            ? validGoalCommunityNotificationTarget(target) && validGoalNotificationExportDocument(document, target)
            : contract === GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT
                ? validGoalCommunityCommentTarget(target) && validGoalCommentExportDocument(document, target)
                : validGoalCommunityRelationshipTarget(target) && validGoalRelationshipExportDocument(document, target)) || teachingRequestSha256(document) !== snapshot
        || !bytes.equals(Buffer.from(canonicalTeachingJson(document))))
        throw new GoalDataExportError("version_conflict");
    return { document: document, bytes, snapshot: snapshot };
}
export function assembleGoalRelationshipExport(pages) {
    const result = assembleTargetExport(pages);
    return { ...result, document: result.document };
}
export function assembleGoalCommentExport(pages) {
    const result = assembleTargetExport(pages);
    return { ...result, document: result.document };
}
export const goalDataExportToolAction = (name) => name === "aidesk_goal_data_export" ? "read" : undefined;
export const goalDataExportToolDefinitions = [{ name: "aidesk_goal_data_export", description: "只读导出本人准确目标的历史修订、任务记录及明确关联副本。分段必须同一snapshot并核完整摘要；不含独立发表回应、订单、宿主历史或引用文件字节，不删除或改变原件。",
        inputSchema: { type: "object", additionalProperties: false, required: ["contract", "goalId", "snapshot", "offset", "chunkBytes"], properties: {
                contract: { const: GOAL_DATA_EXPORT_CONTRACT }, goalId: { type: "string", format: "uuid" }, snapshot: { anyOf: [{ type: "string", pattern: "^[a-f0-9]{64}$" }, { type: "null" }] },
                offset: { type: "integer", minimum: 0, maximum: 4194303 }, chunkBytes: { type: "integer", minimum: 1024, maximum: 8192 }
            } },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }];
// Only the V2.2 directory advertises the expanded complete export. Older
// directories retain their byte-identical descriptor and explicit v1 contract.
export const goalDataExportV2ToolDefinitions = goalDataExportToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v2 包含目标定稿、分享预览及其原操作；不证明已公开。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { enum: [GOAL_DATA_EXPORT_CONTRACT, GOAL_DATA_EXPORT_V2_CONTRACT] } } },
}));
export const goalDataExportV3ToolDefinitions = goalDataExportToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v3 还完整包含关联公开编号、每次公开修订及原操作；当前可见范围另核。",
    inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
            contract: { enum: [GOAL_DATA_EXPORT_CONTRACT, GOAL_DATA_EXPORT_V2_CONTRACT, GOAL_DATA_EXPORT_V3_CONTRACT] } } },
}));
export const goalDataExportV4ToolDefinitions = goalDataExportToolDefinitions.map(tool => ({ ...tool,
    description: tool.description + " v4 含本人目的目标的社区引用采用；独立关系合同只导出本人准确 publicId/generation 的赞藏状态及完整元数据原件，无他人正文。",
    inputSchema: { type: "object", oneOf: [{ ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
                    contract: { enum: [GOAL_DATA_EXPORT_CONTRACT, GOAL_DATA_EXPORT_V2_CONTRACT, GOAL_DATA_EXPORT_V3_CONTRACT, GOAL_DATA_EXPORT_V4_CONTRACT] } } },
            { type: "object", additionalProperties: false, required: ["contract", "target", "snapshot", "offset", "chunkBytes"], properties: {
                    contract: { const: GOAL_COMMUNITY_RELATIONSHIP_EXPORT_CONTRACT }, target: goalCommunityRelationshipTargetSchema,
                    snapshot: tool.inputSchema.properties.snapshot, offset: tool.inputSchema.properties.offset, chunkBytes: tool.inputSchema.properties.chunkBytes
                } }] },
}));
export const goalDataExportV5ToolDefinitions = goalDataExportToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " v5 含本人在该关联公开目标下的评论及取消／擦除薄原号；独立评论合同只导出准确本人评论及原件，不含源或他人正文。",
    inputSchema: { type: "object", oneOf: [{ ...tool.inputSchema, properties: { ...tool.inputSchema.properties,
                    contract: { enum: [GOAL_DATA_EXPORT_CONTRACT, GOAL_DATA_EXPORT_V2_CONTRACT, GOAL_DATA_EXPORT_V3_CONTRACT, GOAL_DATA_EXPORT_V4_CONTRACT, GOAL_DATA_EXPORT_V5_CONTRACT] } } },
            goalDataExportV4ToolDefinitions[index].inputSchema.oneOf[1],
            { type: "object", additionalProperties: false, required: ["contract", "target", "snapshot", "offset", "chunkBytes"], properties: {
                    contract: { const: GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT }, target: goalCommunityCommentTargetSchema,
                    snapshot: tool.inputSchema.properties.snapshot, offset: tool.inputSchema.properties.offset, chunkBytes: tool.inputSchema.properties.chunkBytes
                } }] },
}));
const sameCommentValue = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
function validCommentRecords(records, publicId) {
    try {
        if (records.length === 0)
            return true;
        if (!uuid(publicId))
            return false;
        const facts = new Map(), operations = new Map(), seen = new Set();
        for (const r of records) {
            if (!exact(r, ["kind", "id", "data", "localOperation"]) || !uuid(r.id) || !teachingObject(r.data) || seen.has(`${r.kind}:${r.id}`))
                return false;
            seen.add(`${r.kind}:${r.id}`);
            const d = r.data;
            if (d.public_id !== publicId || !uuid(d.comment_id) || !(d.parent_comment_id === null || uuid(d.parent_comment_id))
                || d.parent_comment_id === d.comment_id || !isTimestamp(d.created_at) || !(d.erased_at === null || isTimestamp(d.erased_at)))
                return false;
            if (r.kind === "community_comment") {
                if (!exact(d, ["comment_id", "author_id", "public_id", "public_version", "projection_sha256", "parent_comment_id", "text", "text_sha256", "created_at", "erased_at"])
                    || r.id !== d.comment_id || r.localOperation !== null || !uuid(d.author_id) || !int(d.public_version, 1, 2147483647) || !hash(d.projection_sha256))
                    return false;
                if (d.erased_at !== null) {
                    if (d.text !== null || d.text_sha256 !== null)
                        return false;
                }
                else {
                    const p = parseGoalCommunityCommentInput("create", { contract: GOAL_COMMUNITY_COMMENT_CONTRACT, operationId: r.id, commentId: r.id,
                        source: { publicId, publicVersion: d.public_version, projectionSha256: d.projection_sha256 }, parentCommentId: d.parent_comment_id, text: d.text });
                    if (goalCommunityCommentMetadata(p).contentSha256 !== d.text_sha256)
                        return false;
                }
                facts.set(r.id, d);
            }
            else if (r.kind === "community_comment_operation") {
                if (!exact(d, ["operation_id", "comment_id", "public_id", "parent_comment_id", "request_sha256", "status", "request", "receipt", "created_at", "erased_at"])
                    || r.id !== d.operation_id || !hash(d.request_sha256) || !(d.status === "recorded" || d.status === "cancelled") || operations.has(d.comment_id))
                    return false;
                if (d.erased_at !== null) {
                    if (!exact(d.request, []) || !exact(d.receipt, []) || r.localOperation !== null)
                        return false;
                }
                else {
                    if (!validGoalCommunityCommentReceipt(d.receipt, r.id, d.request_sha256)
                        || d.receipt.status !== d.status || !sameCommentValue(d.request, d.receipt.request)
                        || d.receipt.request.commentId !== d.comment_id || d.receipt.request.source.publicId !== publicId
                        || d.receipt.request.parentCommentId !== d.parent_comment_id || Date.parse(d.receipt.recordedAt) !== Date.parse(d.created_at)
                        || !exact(r.localOperation, ["tool", "operationId", "requestSha256"]) || r.localOperation.tool !== "aidesk_goal_community_comment_create"
                        || r.localOperation.operationId !== r.id || r.localOperation.requestSha256 !== d.request_sha256)
                        return false;
                }
                operations.set(d.comment_id, d);
            }
            else
                return false;
        }
        for (const [id, op] of operations) {
            const fact = facts.get(id);
            if (op.status === "cancelled") {
                if (fact)
                    return false;
                continue;
            }
            if (!fact || fact.parent_comment_id !== op.parent_comment_id || (fact.erased_at === null) !== (op.erased_at === null))
                return false;
            if (op.erased_at !== null)
                continue;
            const c = op.receipt, metadata = op.request;
            const p = parseGoalCommunityCommentInput("create", { contract: GOAL_COMMUNITY_COMMENT_CONTRACT, operationId: op.operation_id, commentId: id,
                source: { publicId, publicVersion: fact.public_version, projectionSha256: fact.projection_sha256 }, parentCommentId: fact.parent_comment_id, text: fact.text });
            if (teachingRequestSha256(p) !== op.request_sha256 || !sameCommentValue(goalCommunityCommentMetadata(p), metadata)
                || fact.author_id !== c.authorId || Date.parse(String(fact.created_at)) !== Date.parse(String(c.recordedAt)))
                return false;
        }
        return [...facts.keys()].every(id => operations.get(id)?.status === "recorded");
    }
    catch {
        return false;
    }
}
export function validGoalCommentExportDocument(v, target) {
    try {
        return validGoalCommunityCommentTarget(target) && exact(v, ["contract", "target", "scope", "exclusions", "records"])
            && v.contract === GOAL_COMMUNITY_COMMENT_EXPORT_CONTRACT && sameCommentValue(v.target, target) && v.scope === GOAL_COMMUNITY_COMMENT_SCOPE
            && sameCommentValue(v.exclusions, GOAL_COMMUNITY_COMMENT_EXCLUSIONS) && Array.isArray(v.records) && v.records.length >= 1 && v.records.length <= 2
            && v.records.every(r => teachingObject(r) && teachingObject(r.data) && r.data.comment_id === target.commentId && r.data.erased_at === null)
            && validCommentRecords(v.records, target.publicId);
    }
    catch {
        return false;
    }
}
export const goalDataExportV6ToolDefinitions = goalDataExportToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " 通知合同独立导出准确本人单条消息，或准确代际的全部通知设置及原件；无源正文、他人消息或全账号导出承诺。",
    inputSchema: { type: "object", oneOf: [...goalDataExportV5ToolDefinitions[index].inputSchema.oneOf,
            { type: "object", additionalProperties: false, required: ["contract", "target", "snapshot", "offset", "chunkBytes"], properties: {
                    contract: { const: GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT }, target: goalCommunityNotificationTargetSchema,
                    snapshot: tool.inputSchema.properties.snapshot, offset: tool.inputSchema.properties.offset, chunkBytes: tool.inputSchema.properties.chunkBytes
                } }] },
}));
export function assembleGoalNotificationExport(pages) {
    const result = assembleTargetExport(pages);
    return { ...result, document: result.document };
}
function validNotificationOperation(r, target) {
    const d = r.data;
    if (!uuid(r.id) || !exact(d, ["operation_id", "action", "notification_id", "generation", "public_id", "request_sha256", "request", "receipt", "created_at", "erased_at"])
        || r.id !== d.operation_id || d.erased_at !== null || !isTimestamp(d.created_at) || !hash(d.request_sha256)
        || !validGoalCommunityNotificationReceipt(d.receipt, r.id, d.request_sha256)
        || !sameCommentValue(d.request, d.receipt.request) || d.action !== d.receipt.request.action
        || Date.parse(d.created_at) !== Date.parse(d.receipt.recordedAt)
        || !exact(r.localOperation, ["tool", "operationId", "requestSha256"])
        || r.localOperation.operationId !== r.id || r.localOperation.requestSha256 !== d.request_sha256
        || r.localOperation.tool !== `aidesk_goal_community_notification_${String(d.action)}`)
        return false;
    const p = d.receipt.request;
    return target.kind === "community_notification"
        ? p.action === "mark_read" && p.notificationId === target.notificationId && d.notification_id === target.notificationId && d.generation === null && d.public_id === null
        : p.action !== "mark_read" && p.expectedGeneration === target.generation && d.generation === target.generation && d.notification_id === null
            && (p.action === "mute_set" ? d.public_id === p.publicId : d.public_id === null);
}
export function validGoalNotificationExportDocument(v, target) {
    try {
        const settings = target.kind === "community_notification_settings";
        if (!validGoalCommunityNotificationTarget(target) || !exact(v, ["contract", "target", "scope", "exclusions", "records"])
            || v.contract !== GOAL_COMMUNITY_NOTIFICATION_EXPORT_CONTRACT || !sameCommentValue(v.target, target)
            || v.scope !== (settings ? GOAL_COMMUNITY_NOTIFICATION_SETTINGS_SCOPE : GOAL_COMMUNITY_NOTIFICATION_SCOPE)
            || !sameCommentValue(v.exclusions, settings ? GOAL_COMMUNITY_NOTIFICATION_SETTINGS_EXCLUSIONS : GOAL_COMMUNITY_NOTIFICATION_EXCLUSIONS)
            || !Array.isArray(v.records) || v.records.length < 1 || v.records.length > GOAL_DATA_EXPORT_LIMITS.records)
            return false;
        const seen = new Set(), events = new Map(), mutes = new Map();
        const ops = [];
        let notification, scope;
        for (const r of v.records) {
            if (!exact(r, ["kind", "id", "data", "localOperation"]) || typeof r.kind !== "string" || typeof r.id !== "string" || !teachingObject(r.data)
                || seen.has(`${r.kind}:${r.id}`))
                return false;
            seen.add(`${r.kind}:${r.id}`);
            const d = r.data;
            if (r.kind === "notification_operation") {
                if (!validNotificationOperation(r, target))
                    return false;
                ops.push(r);
                continue;
            }
            if (r.localOperation !== null)
                return false;
            if (r.kind === "community_notification") {
                if (settings || notification || !validGoalCommunityNotificationItem(d) || r.id !== d.notificationId
                    || target.kind !== "community_notification" || d.notificationId !== target.notificationId)
                    return false;
                notification = d;
            }
            else if (r.kind === "notification_event") {
                if (target.kind !== "community_notification" || !/^[1-9][0-9]*$/u.test(r.id) || !int(Number(r.id), 1, GOAL_DATA_EXPORT_LIMITS.records)
                    || !exact(d, ["notificationId", "kind", "publicId", "commentId", "parentCommentId", "createdAt"])
                    || d.notificationId !== target.notificationId || !uuid(d.publicId) || !isTimestamp(d.createdAt)
                    || !(d.kind === "reply" ? uuid(d.commentId) && uuid(d.parentCommentId) && d.commentId !== d.parentCommentId
                        : d.kind === "comment" ? uuid(d.commentId) && d.parentCommentId === null
                            : (d.kind === "like" || d.kind === "adoption") && d.commentId === null && d.parentCommentId === null))
                    return false;
                events.set(Number(r.id), d);
            }
            else if (r.kind === "notification_settings") {
                if (target.kind !== "community_notification_settings" || scope || r.id !== "settings"
                    || !exact(d, ["generation", "proactive", "createdAt", "updatedAt"]) || d.generation !== target.generation
                    || !validGoalCommunityNotificationProactive(d.proactive) || d.proactive.generation !== target.generation
                    || !(d.createdAt === null && d.updatedAt === null && d.proactive.version === 0
                        || isTimestamp(d.createdAt) && isTimestamp(d.updatedAt) && Date.parse(d.createdAt) <= Date.parse(d.updatedAt)))
                    return false;
                scope = d;
            }
            else if (r.kind === "notification_mute") {
                if (target.kind !== "community_notification_settings" || !exact(d, ["publicId", "generation", "muted", "version", "createdAt", "updatedAt"])
                    || r.id !== d.publicId || d.generation !== target.generation || !isTimestamp(d.createdAt)
                    || !validGoalCommunityNotificationMute({ publicId: d.publicId, generation: d.generation, muted: d.muted, version: d.version, updatedAt: d.updatedAt })
                    || d.version === 0 || Date.parse(d.createdAt) > Date.parse(String(d.updatedAt)))
                    return false;
                mutes.set(r.id, d);
            }
            else
                return false;
        }
        const versions = new Map();
        if (!settings) {
            if (!notification || scope || mutes.size || events.size !== notification.revision)
                return false;
            for (let i = 1; i <= events.size; i++) {
                const event = events.get(i);
                if (!event || event.kind !== notification.kind || event.publicId !== notification.publicId
                    || event.commentId !== notification.commentId || event.parentCommentId !== notification.parentCommentId
                    || Date.parse(String(event.createdAt)) < Date.parse(String(notification.createdAt)) || Date.parse(String(event.createdAt)) > Date.parse(String(notification.updatedAt)))
                    return false;
            }
            let greatestReadThrough = 0;
            for (const op of ops) {
                const c = op.data.receipt, n = c.result.readVersion;
                const known = versions.get("read") ?? new Set();
                if (known.has(n) || n > Number(notification.readVersion) || c.result.readThroughRevision > Number(notification.revision))
                    return false;
                known.add(n);
                versions.set("read", known);
                greatestReadThrough = Math.max(greatestReadThrough, c.result.readThroughRevision);
            }
            return ops.length === notification.readVersion && greatestReadThrough === notification.readThroughRevision;
        }
        if (!scope || notification || events.size)
            return false;
        const proactive = scope.proactive;
        for (const op of ops) {
            const c = op.data.receipt, n = c.result.version;
            const key = c.request.action === "mute_set" ? c.request.publicId : "proactive", current = key === "proactive" ? proactive : mutes.get(key);
            const known = versions.get(key) ?? new Set();
            if (!current || known.has(n) || n > Number(current.version))
                return false;
            if (n === current.version && !sameCommentValue(c.result, key === "proactive" ? current
                : { publicId: current.publicId, generation: current.generation, muted: current.muted, version: current.version, updatedAt: current.updatedAt }))
                return false;
            known.add(n);
            versions.set(key, known);
        }
        return (versions.get("proactive")?.size ?? 0) === proactive.version && [...mutes].every(([id, mute]) => versions.get(id)?.size === mute.version);
    }
    catch {
        return false;
    }
}
export const goalDataExportV7ToolDefinitions = goalDataExportToolDefinitions.map((tool, index) => ({ ...tool,
    description: tool.description + " 举报合同独立导出本人准确单条举报；删除后只导出保留的案件、处理状态和薄原号事实，不撤销运营限制，不导出源正文或运营原件。",
    inputSchema: { type: "object", oneOf: [...goalDataExportV6ToolDefinitions[index].inputSchema.oneOf,
            { type: "object", additionalProperties: false, required: ["contract", "target", "snapshot", "offset", "chunkBytes"], properties: {
                    contract: { const: GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT }, target: goalCommunityReportDataTargetSchema,
                    snapshot: tool.inputSchema.properties.snapshot, offset: tool.inputSchema.properties.offset, chunkBytes: tool.inputSchema.properties.chunkBytes
                } }] },
}));
export function assembleGoalReportExport(pages) {
    const result = assembleTargetExport(pages);
    return { ...result, document: result.document };
}
export function validGoalReportExportDocument(v, target) {
    try {
        if (!validGoalCommunityReportDataTarget(target) || !exact(v, ["contract", "target", "scope", "exclusions", "records"])
            || v.contract !== GOAL_COMMUNITY_REPORT_EXPORT_CONTRACT || !sameCommentValue(v.target, target) || v.scope !== GOAL_COMMUNITY_REPORT_SCOPE
            || !sameCommentValue(v.exclusions, GOAL_COMMUNITY_REPORT_EXCLUSIONS) || !Array.isArray(v.records) || v.records.length !== 2)
            return false;
        const report = v.records.find(r => teachingObject(r) && r.kind === "community_report");
        const op = v.records.find(r => teachingObject(r) && r.kind === "community_report_operation");
        if (!exact(report, ["kind", "id", "data", "localOperation"]) || report.id !== target.reportId || report.localOperation !== null
            || !validGoalCommunityReportItem(report.data) || report.data.reportId !== target.reportId
            || !exact(op, ["kind", "id", "data", "localOperation"]) || op.id !== target.reportId
            || !exact(op.data, ["operation_id", "report_id", "request_sha256", "request", "receipt", "created_at", "erased_at"]))
            return false;
        const r = report.data, d = op.data;
        if (d.operation_id !== target.reportId || d.report_id !== target.reportId || !hash(d.request_sha256) || !isTimestamp(d.created_at)
            || Date.parse(d.created_at) !== Date.parse(r.createdAt))
            return false;
        if (r.erasedAt !== null)
            return isTimestamp(d.erased_at) && Date.parse(d.erased_at) === Date.parse(r.erasedAt)
                && exact(d.request, []) && exact(d.receipt, []) && op.localOperation === null;
        if (d.erased_at !== null || !validGoalCommunityReportReceipt(d.receipt, "submit")
            || d.receipt.operationId !== target.reportId || d.receipt.requestSha256 !== d.request_sha256
            || !teachingObject(d.receipt.request) || d.receipt.request.action !== "submit" || !validGoalCommunityReportItem(d.receipt.result)
            || !sameCommentValue(d.request, d.receipt.request) || Date.parse(d.receipt.recordedAt) !== Date.parse(d.created_at)
            || !exact(op.localOperation, ["tool", "operationId", "requestSha256"]) || op.localOperation.tool !== "aidesk_goal_community_report_submit"
            || op.localOperation.operationId !== target.reportId || op.localOperation.requestSha256 !== d.request_sha256)
            return false;
        const initial = d.receipt.result;
        return initial.reportId === r.reportId && sameCommentValue(initial.target, r.target) && initial.reason === r.reason
            && Date.parse(initial.createdAt) === Date.parse(r.createdAt) && initial.version <= r.version
            && Date.parse(initial.updatedAt) <= Date.parse(r.updatedAt);
    }
    catch {
        return false;
    }
}
/** Fresh retained facts can be exported after erasure; this never authorizes
 * unlinking local files or including residual submit originals. */
export function isErasedGoalReportExport(v) {
    return teachingObject(v) && validGoalCommunityReportDataTarget(v.target) && validGoalReportExportDocument(v, v.target)
        && v.records.every(r => r.localOperation === null) && v.records.some(r => r.kind === "community_report" && r.data.erasedAt !== null);
}
