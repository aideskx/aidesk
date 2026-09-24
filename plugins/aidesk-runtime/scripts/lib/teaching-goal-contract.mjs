// Generated from services/authority-api/src/teaching-goal-contract.ts; source SHA-256 8688df19d3421f2f3c42a15af519a779f6bea3051129f96535e45c834722bfd9.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { validGoalAccess } from "./goal-access.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingSameUuid, teachingRequestSha256, teachingUtf8Bytes, teachingSha256, validTeachingSources, TeachingInputError, TEACHING_BUSINESS_LIMITS } from "./teaching-business-contract.mjs";
/** Non-authoritative implementation of the finite learning/result goal loop.
 * v1 bytes and parsers remain unchanged. SQL owns scope, versions and admission;
 * neither a valid package digest nor a structured observation proves host use or learning. */
export const GOAL_BUSINESS_CONTRACT = "aidesk-teaching-business-v2";
export const GOAL_RECORD_KINDS = ["task_v2", "goal_v2", "checkpoint_v2"];
export const GOAL_BUSINESS_RPCS = Object.freeze({ start: "aidesk_private.aidesk_teaching_start_v2",
    commit: "aidesk_private.aidesk_teaching_commit_v2", context: "aidesk_private.aidesk_teaching_context_v2",
    operation: "aidesk_private.aidesk_teaching_operation_v2", end: "aidesk_private.aidesk_teaching_end_v2" });
export const GOAL_TEXT_RESULT_BYTES = 12288;
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const oneOf = (v, values) => typeof v === "string" && values.includes(v);
const text = (v, max = 4096) => typeof v === "string" && v.isWellFormed() && v.trim().length > 0
    && teachingUtf8Bytes(v) <= max && Array.from(v).every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127 || "\t\n\r".includes(ch));
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const list = (v, check, max = 16) => Array.isArray(v) && v.length <= max && v.every(check);
const unique = (values) => new Set(values.map(v => v.toLowerCase())).size === values.length;
const uuids = (v) => list(v, isUuid) && unique(v);
const nullable = (v, check) => v === null || check(v);
const binding = (v) => exact(v, ["bindingId", "epoch"]) && isUuid(v.bindingId) && integer(v.epoch, 1);
const task = (v) => exact(v, ["taskId", "revision"]) && isUuid(v.taskId) && integer(v.revision, 1);
const scope = (v) => exact(v, ["familyId", "learnerId"]) && text(v.familyId, 256) && text(v.learnerId, 256);
const selected = (v) => exact(v, ["familyId", "learnerId", "selectionAttemptId"])
    && text(v.familyId, 256) && text(v.learnerId, 256) && isUuid(v.selectionAttemptId);
const ref = (v) => exact(v, ["kind", "id", "version"])
    && oneOf(v.kind, GOAL_RECORD_KINDS) && isUuid(v.id) && integer(v.version, 1);
const goalRef = (v) => ref(v) && v.kind === "goal_v2";
const contextKinds = { tasks: "task_v2", goals: "goal_v2", checkpoints: "checkpoint_v2", results: "checkpoint_v2" };
const contextView = (v) => oneOf(v, Object.keys(contextKinds));
const sameNullableUuid = (a, b) => a === null || b === null ? a === b : teachingSameUuid(a, b);
const contextCursor = (v) => exact(v, ["snapshotSequence", "executionId", "taskId", "view", "before"])
    && integer(v.snapshotSequence, 1) && isUuid(v.executionId) && nullable(v.taskId, isUuid) && contextView(v.view)
    && ref(v.before) && v.before.kind === contextKinds[v.view];
const cursorMatchesQuery = (c, q) => teachingSameUuid(c.executionId, q.executionId) && sameNullableUuid(c.taskId, q.taskId) && q.views.length === 1 && c.view === q.views[0];
const refs = (v) => list(v, ref) && unique(v.map(r => `${r.kind}:${r.id}:${r.version}`));
const status = (v) => oneOf(v, ["active", "paused", "completed", "cancelled"]);
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const sameTask = (a, b) => a === null || b === null ? a === b
    : teachingSameUuid(a.taskId, b.taskId) && a.revision === b.revision;
export const validGoalPackageRef = (v) => exact(v, ["pluginName", "pluginVersion", "packageDigest", "skillPath", "skillSha256"])
    && v.pluginName === "aidesk-runtime" && text(v.pluginVersion, 128) && /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(v.pluginVersion) && hash(v.packageDigest)
    && v.skillPath === "skills/aidesk-entry/SKILL.md" && hash(v.skillSha256);
const help = (v) => exact(v, ["inputAssistance", "contentHelp", "sourceRefs", "notes"])
    && oneOf(v.inputAssistance, ["none", "reported", "transcription", "unknown"])
    && oneOf(v.contentHelp, ["none_reported", "hint", "answer_shown", "mixed", "unknown"]) && uuids(v.sourceRefs) && nullable(v.notes, text);
const requirement = (v) => exact(v, ["requirementId", "kind", "statement", "allowedHelp"])
    && isUuid(v.requirementId) && oneOf(v.kind, ["learning", "result"]) && text(v.statement) && text(v.allowedHelp, 1024);
const definition = (v) => exact(v, ["goalId", "expectedVersion", "statement", "requirements", "sourceRefs", "quote", "revisionReason"])
    && isUuid(v.goalId) && integer(v.expectedVersion) && text(v.statement) && list(v.requirements, requirement) && v.requirements.length > 0
    && unique(v.requirements.map(r => r.requirementId)) && uuids(v.sourceRefs) && v.sourceRefs.length > 0 && text(v.quote)
    && (v.expectedVersion === 0 ? v.revisionReason === null : text(v.revisionReason));
const sourceObservation = (v) => exact(v, ["observationId", "kind", "sourceRefs", "quote", "helpConditions"])
    && isUuid(v.observationId) && oneOf(v.kind, ["learner_performance", "delivered_text", "reported_result"])
    && uuids(v.sourceRefs) && v.sourceRefs.length > 0 && text(v.quote) && help(v.helpConditions);
const textReview = (v) => exact(v, ["observationId", "kind", "basis", "quote"])
    && isUuid(v.observationId) && v.kind === "text_review" && text(v.quote)
    && (exact(v.basis, ["kind"]) && v.basis.kind === "current_text"
        || exact(v.basis, ["kind", "ref"]) && v.basis.kind === "saved_text" && ref(v.basis.ref) && v.basis.ref.kind === "checkpoint_v2");
const observation = (v) => sourceObservation(v) || textReview(v);
const check = (v) => exact(v, ["requirementId", "verdict", "observationIds", "rationale"])
    && isUuid(v.requirementId) && oneOf(v.verdict, ["met", "not_met", "unknown"])
    && uuids(v.observationIds) && (v.verdict !== "met" || v.observationIds.length > 0) && text(v.rationale);
const textResult = (v) => exact(v, ["kind", "text", "sha256"])
    && v.kind === "generated_text" && text(v.text, GOAL_TEXT_RESULT_BYTES) && hash(v.sha256) && v.sha256 === teachingSha256(v.text);
/** Public tools accept only the original text; adapters compute its byte digest. */
export function goalTextResultFromPublic(v) {
    if (!exact(v, ["text"]) || !text(v.text, GOAL_TEXT_RESULT_BYTES))
        throw new TeachingInputError();
    return { kind: "generated_text", text: v.text, sha256: teachingSha256(v.text) };
}
const checkpoint = (v) => teachingObject(v)
    && exact(v, ["goalRef", "progress", "nextStep", "observations", "checks", "taskStatus", "goalStatus", ...(Object.hasOwn(v, "textResult") ? ["textResult"] : [])])
    && (!Object.hasOwn(v, "textResult") || textResult(v.textResult))
    && nullable(v.goalRef, goalRef) && text(v.progress) && nullable(v.nextStep, text)
    && list(v.observations, observation, 8) && unique(v.observations.map(o => o.observationId))
    && v.observations.every(o => o.kind !== "text_review" || o.basis.kind !== "current_text"
        || textResult(v.textResult) && v.textResult.text.includes(o.quote))
    && list(v.checks, check) && unique(v.checks.map(c => c.requirementId)) && status(v.taskStatus) && nullable(v.goalStatus, status)
    && (v.goalRef !== null || v.checks.length === 0 && v.goalStatus === null)
    && v.checks.every(c => c.observationIds.every(id => v.observations.some(o => teachingSameUuid(id, o.observationId))));
/** Payload-only read validation. Callers still bind IDs/versions and verify
 * scope, current status and provenance through their existing read owner. */
export { definition as validGoalDefinitionData, checkpoint as validGoalCheckpointData };
export const validGoalTaskData = (v) => exact(v, ["contract", "kind", "taskId", "purpose", "purposeSourceRefs", "goalRef", "status"])
    && v.contract === GOAL_BUSINESS_CONTRACT && v.kind === "new" && isUuid(v.taskId) && text(v.purpose)
    && uuids(v.purposeSourceRefs) && v.purposeSourceRefs.length > 0 && nullable(v.goalRef, goalRef) && status(v.status);
const taskAction = (v) => exact(v, ["kind"]) && v.kind === "prepare"
    || exact(v, ["kind", "taskId", "purpose", "purposeSourceRefs", "goalRef"]) && v.kind === "new" && isUuid(v.taskId)
        && text(v.purpose) && uuids(v.purposeSourceRefs) && v.purposeSourceRefs.length > 0 && nullable(v.goalRef, goalRef)
    || exact(v, ["kind", "taskRef"]) && v.kind === "resume" && task(v.taskRef);
function validInput(action, v) {
    if (action === "start")
        return exact(v, ["contract", "operationId", "clientContextId", "expectedBinding", "selected", "packageRef", "sources", "taskAction", ...(Object.hasOwn(v, "requestSourceId") ? ["requestSourceId"] : [])])
            && isUuid(v.operationId) && isUuid(v.clientContextId) && nullable(v.expectedBinding, binding) && selected(v.selected)
            && validGoalPackageRef(v.packageRef) && validTeachingSources(v.sources) && taskAction(v.taskAction)
            && (!Object.hasOwn(v, "requestSourceId") || v.taskAction.kind !== "prepare" && isUuid(v.requestSourceId));
    if (action === "commit")
        return exact(v, ["contract", "operationId", "binding", "executionId", "taskRef", "expected", "sources", "action", "payload", ...(Object.hasOwn(v, "requestAdmission") ? ["requestAdmission"] : [])])
            && isUuid(v.operationId) && binding(v.binding) && isUuid(v.executionId) && task(v.taskRef)
            && (!Object.hasOwn(v, "requestAdmission") || exact(v.requestAdmission, ["operationId", "requestSourceId"])
                && isUuid(v.requestAdmission.operationId) && isUuid(v.requestAdmission.requestSourceId))
            && exact(v.expected, ["learnerSequence", "dependencies"]) && integer(v.expected.learnerSequence) && refs(v.expected.dependencies)
            && validTeachingSources(v.sources) && (v.action === "goal" ? definition(v.payload) : v.action === "checkpoint" && checkpoint(v.payload));
    if (action === "end")
        return exact(v, ["contract", "operationId", "binding", "expectedEpoch", "action", "target"])
            && isUuid(v.operationId) && binding(v.binding) && v.expectedEpoch === v.binding.epoch
            && v.action === "end" && v.target === null;
    if (action === "context")
        return exact(v, ["contract", "binding", "executionId", "taskId", "views", "budgetBytes", ...(Object.hasOwn(v, "page") ? ["page"] : [])])
            && binding(v.binding) && isUuid(v.executionId) && nullable(v.taskId, isUuid) && Array.isArray(v.views) && v.views.length > 0 && v.views.length <= 4
            && v.views.every(contextView) && new Set(v.views).size === v.views.length && integer(v.budgetBytes, 1024, 24576)
            && (!Object.hasOwn(v, "page") || v.views.length === 1 && exact(v.page, ["cursor", "limit"]) && integer(v.page.limit, 1, 16)
                && (v.page.cursor === null || contextCursor(v.page.cursor) && cursorMatchesQuery(v.page.cursor, { executionId: v.executionId, taskId: v.taskId, views: v.views })));
    return action === "operation" && exact(v, ["contract", "operationId", "part", "offset", "budgetBytes"])
        && isUuid(v.operationId) && oneOf(v.part, ["receipt", "request"]) && integer(v.offset, 0, TEACHING_BUSINESS_LIMITS.requestBytes)
        && (v.part !== "receipt" || v.offset === 0) && integer(v.budgetBytes, 1024, 24576);
}
export function parseGoalBusinessInput(action, input) {
    const value = typeof input === "string" ? parseTeachingJson(input) : input;
    const raw = canonicalTeachingJson(value);
    if (teachingUtf8Bytes(raw) > TEACHING_BUSINESS_LIMITS.requestBytes)
        throw new TeachingInputError("payload_too_large");
    if (teachingObject(value) && value.contract !== GOAL_BUSINESS_CONTRACT)
        throw new TeachingInputError("contract_incompatible");
    if (!teachingObject(value) || !Object.hasOwn(GOAL_BUSINESS_RPCS, action) || !validInput(action, value))
        throw new TeachingInputError();
    return structuredClone(value);
}
function receipt(v) {
    return exact(v, ["contract", "operationId", "status", "requestSha256", "scope", "executionId", "taskRef", "committedSequence", "records", "decisions", "projection", "data"])
        && v.contract === GOAL_BUSINESS_CONTRACT && isUuid(v.operationId) && v.status === "completed" && hash(v.requestSha256)
        && scope(v.scope) && nullable(v.executionId, isUuid) && nullable(v.taskRef, task) && integer(v.committedSequence, 1)
        && list(v.records, ref, 64) && unique(v.records.map(r => `${r.kind}:${r.id}:${r.version}`))
        && Array.isArray(v.decisions) && v.decisions.length === 0
        && exact(v.projection, ["throughSequence", "status"]) && v.projection.status === "current" && v.projection.throughSequence === v.committedSequence
        && teachingObject(v.data);
}
function writeResult(action, v, input) {
    if (!receipt(v) || !teachingSameUuid(v.operationId, input.operationId) || v.requestSha256 !== teachingRequestSha256(input))
        return false;
    if (action === "commit") {
        const a = input;
        return teachingSameUuid(v.executionId, a.executionId) && v.committedSequence === a.expected.learnerSequence + 1 && exact(v.data, [])
            && sameTask(v.taskRef, { taskId: a.taskRef.taskId, revision: a.taskRef.revision + (a.action === "checkpoint" ? 1 : 0) })
            && (a.action === "goal" ? v.records.length === 1 && v.records.some(r => r.kind === "goal_v2"
                && teachingSameUuid(r.id, a.payload.goalId) && r.version === a.payload.expectedVersion + 1)
                : v.records.length === 2 && v.records.some(r => r.kind === "task_v2" && teachingSameUuid(r.id, a.taskRef.taskId) && r.version === a.taskRef.revision + 1)
                    && v.records.some(r => r.kind === "checkpoint_v2" && teachingSameUuid(r.id, a.operationId) && r.version === 1));
    }
    const d = v.data;
    if (action === "end") {
        const a = input;
        return v.executionId === null && v.taskRef === null && exact(d, ["bindingId", "epoch", "status", "target"])
            && teachingSameUuid(d.bindingId, a.binding.bindingId) && d.epoch === a.expectedEpoch + 1 && d.status === "ended" && same(d.target, a.target);
    }
    const a = input;
    // Older v2 originals retain their exact receipt bytes. New first-use
    // receipts include the server's access snapshot, never a client-issued term
    // or evidence that the host has already begun producing a reply.
    const entitlement = d.entitlement;
    if (entitlement !== undefined && (!validGoalAccess(entitlement)
        || !entitlement.eligibleLearnerIds.includes(a.selected.learnerId)
        || entitlement.state === "blocked"
        || a.taskAction.kind !== "prepare" && !["active", "annual"].includes(entitlement.state)))
        return false;
    const admission = d.requestAdmission;
    if (a.requestSourceId === undefined ? Object.hasOwn(d, "requestAdmission")
        : !exact(admission, ["requestSourceId", "admittedAt", "expiresAt"])
            || !isUuid(admission.requestSourceId) || !teachingSameUuid(admission.requestSourceId, a.requestSourceId)
            || !isTimestamp(admission.admittedAt) || !isTimestamp(admission.expiresAt)
            || !validGoalAccess(entitlement) || admission.admittedAt !== entitlement.checkedAt || admission.expiresAt !== entitlement.expiresAt
            || Date.parse(admission.admittedAt) >= Date.parse(admission.expiresAt))
        return false;
    if (!same(v.scope, { familyId: a.selected.familyId, learnerId: a.selected.learnerId })
        || !exact(d, ["binding", "execution", "taskCreated", "readiness", ...(entitlement === undefined ? [] : ["entitlement"]), ...(admission === undefined ? [] : ["requestAdmission"])])
        || !exact(d.binding, ["bindingId", "clientContextId", "epoch", "scope", "status", "checkedAt", "recheckAt"])
        || !binding({ bindingId: d.binding.bindingId, epoch: d.binding.epoch }) || !teachingSameUuid(d.binding.clientContextId, a.clientContextId)
        || !same(d.binding.scope, v.scope) || d.binding.status !== "active" || !isTimestamp(d.binding.checkedAt) || !isTimestamp(d.binding.recheckAt)
        || Date.parse(d.binding.recheckAt) <= Date.parse(d.binding.checkedAt)
        || (a.expectedBinding === null ? d.binding.epoch !== 1 : !teachingSameUuid(d.binding.bindingId, a.expectedBinding.bindingId)
            || d.binding.epoch !== a.expectedBinding.epoch && d.binding.epoch !== a.expectedBinding.epoch + 1)
        || !exact(d.execution, ["executionId", "bindingId", "bindingEpoch", "packageRef", "adoptedAt", "endedAt"])
        || !teachingSameUuid(d.execution.executionId, v.executionId) || !teachingSameUuid(d.execution.bindingId, d.binding.bindingId)
        || d.execution.bindingEpoch !== d.binding.epoch || !validGoalPackageRef(d.execution.packageRef) || !same(d.execution.packageRef, a.packageRef)
        || !isTimestamp(d.execution.adoptedAt) || d.execution.endedAt !== null || d.taskCreated !== (a.taskAction.kind === "new"))
        return false;
    if (a.taskAction.kind === "new")
        return d.readiness === "ready" && sameTask(v.taskRef, { taskId: a.taskAction.taskId, revision: 1 })
            && v.records.length === 1 && v.records.some(r => r.kind === "task_v2" && teachingSameUuid(r.id, a.taskAction.kind === "new" && a.taskAction.taskId) && r.version === 1);
    return v.records.length === 0 && (a.taskAction.kind === "prepare" ? v.taskRef === null && d.readiness === "prepared"
        : d.readiness === "ready" && sameTask(v.taskRef, a.taskAction.taskRef));
}
function record(v) {
    return exact(v, ["kind", "id", "version", "operationId", "sequence", "taskId", "executionId", "status", "invalidation", "data"])
        && ref({ kind: v.kind, id: v.id, version: v.version }) && isUuid(v.operationId) && integer(v.sequence, 1)
        && isUuid(v.taskId) && isUuid(v.executionId) && v.status === "valid" && v.invalidation === null && teachingObject(v.data)
        && (v.kind === "goal_v2" ? definition(v.data) && teachingSameUuid(v.data.goalId, v.id) && v.data.expectedVersion + 1 === v.version
            : v.kind === "checkpoint_v2" ? checkpoint(v.data) && teachingSameUuid(v.id, v.operationId) && v.version === 1
                : validGoalTaskData(v.data) && teachingSameUuid(v.data.taskId, v.id) && teachingSameUuid(v.taskId, v.id));
}
function contextResult(v, a) {
    if (!exact(v, ["contract", "scope", "executionId", "packageRef", "snapshotSequence", "projectedThrough", "views", "completeness", ...(a.page ? ["nextCursor"] : [])])
        || v.contract !== GOAL_BUSINESS_CONTRACT || !scope(v.scope) || !teachingSameUuid(v.executionId, a.executionId) || !validGoalPackageRef(v.packageRef)
        || !integer(v.snapshotSequence) || v.projectedThrough !== v.snapshotSequence || !exact(v.views, a.views)
        || !oneOf(v.completeness, ["complete_in_requested_scope", "partial_budget"]))
        return false;
    const validViews = Object.entries(v.views).every(([name, view]) => exact(view, ["availability", "items"]) && view.availability === "available"
        && list(view.items, record, a.page?.limit ?? 16) && view.items.every(r => r.kind === contextKinds[name] && r.sequence <= Number(v.snapshotSequence)
        && (a.taskId === null || name === "goals" || teachingSameUuid(r.taskId, a.taskId))
        && (name !== "results" || Object.hasOwn(r.data, "textResult")))
        && unique(view.items.map(r => `${r.kind}:${r.id}:${r.version}`)));
    if (!validViews)
        return false;
    if (!a.page)
        return true;
    if (a.page.cursor && v.snapshotSequence !== a.page.cursor.snapshotSequence)
        return false;
    const items = v.views[a.views[0]].items;
    if (items.some((r, i) => i > 0 && r.sequence > items[i - 1].sequence
        || a.page?.cursor && r.kind === a.page.cursor.before.kind && teachingSameUuid(r.id, a.page.cursor.before.id) && r.version === a.page.cursor.before.version))
        return false;
    if (v.nextCursor === null)
        return v.completeness === "complete_in_requested_scope";
    const c = v.nextCursor, last = items.at(-1);
    return v.completeness === "partial_budget" && last !== undefined && contextCursor(c) && cursorMatchesQuery(c, a)
        && c.snapshotSequence === v.snapshotSequence && c.before.kind === last.kind
        && teachingSameUuid(c.before.id, last.id) && c.before.version === last.version;
}
function operationResult(v, a) {
    if (!teachingObject(v) || v.contract !== GOAL_BUSINESS_CONTRACT || !teachingSameUuid(v.operationId, a.operationId))
        return false;
    if (v.status === "not_found")
        return exact(v, ["contract", "operationId", "status", "terminal"]) && v.terminal === false;
    if (!exact(v, ["contract", "operationId", "status", "requestSha256", "receipt", "request"]) || v.status !== "completed" || !hash(v.requestSha256))
        return false;
    if (a.part === "receipt")
        return v.request === null && receipt(v.receipt) && teachingSameUuid(v.receipt.operationId, a.operationId) && v.receipt.requestSha256 === v.requestSha256;
    if (v.receipt !== null || !exact(v.request, ["sha256", "totalBytes", "offset", "text", "nextOffset"]) || v.request.sha256 !== v.requestSha256
        || !integer(v.request.totalBytes, 1, TEACHING_BUSINESS_LIMITS.requestBytes) || v.request.offset !== a.offset
        || typeof v.request.text !== "string" || !v.request.text.isWellFormed() || v.request.text.includes("\0") || v.request.text.length === 0)
        return false;
    const end = a.offset + teachingUtf8Bytes(v.request.text);
    return end <= v.request.totalBytes && (end === v.request.totalBytes ? v.request.nextOffset === null : v.request.nextOffset === end);
}
export function validGoalBusinessResult(action, value, input) {
    try {
        canonicalTeachingJson(value);
        if (teachingUtf8Bytes(JSON.stringify(value)) > ("budgetBytes" in input ? input.budgetBytes : TEACHING_BUSINESS_LIMITS.resultBytes))
            return false;
        return action === "context" ? contextResult(value, input) : action === "operation" ? operationResult(value, input)
            : writeResult(action, value, input);
    }
    catch {
        return false;
    }
}
