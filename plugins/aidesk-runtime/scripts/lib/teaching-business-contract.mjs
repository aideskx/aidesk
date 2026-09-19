// Generated from services/authority-api/src/teaching-business-contract.ts; source SHA-256 c041b17e4cb746d317274cb033150cde97e2c242f9907fa03b965431c3121fa1.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { createHash } from "node:crypto";
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { CONTENT_CONTRACT, parseTeachingSkillManifest } from "./teaching-content-contract.mjs";
/** Non-authoritative implementation of the 02 business contract. SQL owns
 * authorization and transaction decisions. No public MCP is registered here. */
export const TEACHING_BUSINESS_CONTRACT = "aidesk-teaching-business-v1";
/** Optional, explicitly negotiated 07 extension; it does not change identity or source authority. */
export const TEACHING_CORRECTION_BASIS_CONTRACT = "aidesk-teaching-correction-basis-v1";
export const TEACHING_BUSINESS_LIMITS = Object.freeze({ requestBytes: 24576, resultBytes: 24576,
    sourceBytes: 4096, sources: 4, sourceTotalBytes: 12288, references: 16, events: 8,
    pageDefault: 8, pageMaximum: 16, pageBytesDefault: 12288, cursorBytes: 512,
    requestTimeoutMs: 10000, jsonDepth: 24, transportBytes: 65536 });
export class TeachingInputError extends Error {
    kind;
    constructor(kind = "invalid_input") {
        super(kind === "payload_too_large" ? "Teaching payload exceeds its byte budget"
            : kind === "contract_incompatible" ? "Unsupported teaching business contract" : "Invalid teaching business input");
        this.kind = kind;
        this.name = "TeachingInputError";
    }
}
const requireValue = condition => { if (!condition)
    throw new TeachingInputError(); };
export const teachingObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const teachingSameUuid = (a, b) => isUuid(a) && isUuid(b) && a.toLowerCase() === b.toLowerCase();
export const teachingSha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
export const teachingUtf8Bytes = (value) => Buffer.byteLength(value, "utf8");
const scalarString = (value) => value.isWellFormed() && !value.includes("\0");
/** UTF-8 byte ordering matches PostgreSQL COLLATE "C"; never localeCompare.
 * All machine numbers are safe integers. Text/UUID spelling and array order
 * remain unchanged, so identity equality never changes a replay's payload. */
export function canonicalTeachingJson(value) {
    const visiting = new Set();
    const encode = (v, depth) => {
        requireValue(depth <= TEACHING_BUSINESS_LIMITS.jsonDepth);
        if (v === null || typeof v === "boolean")
            return JSON.stringify(v);
        if (typeof v === "number") {
            requireValue(Number.isSafeInteger(v));
            return JSON.stringify(v);
        }
        if (typeof v === "string") {
            requireValue(scalarString(v));
            return JSON.stringify(v);
        }
        requireValue(typeof v === "object" && v !== null && !visiting.has(v));
        requireValue(Object.getOwnPropertySymbols(v).length === 0);
        visiting.add(v);
        let out;
        if (Array.isArray(v)) {
            requireValue(Object.getPrototypeOf(v) === Array.prototype && Object.getOwnPropertyNames(v).length === v.length + 1);
            requireValue(Object.keys(v).length === v.length && Object.keys(v).every((k, i) => k === String(i)));
            out = `[${Array.from({ length: v.length }, (_, i) => {
                const property = Object.getOwnPropertyDescriptor(v, String(i));
                requireValue(property && Object.hasOwn(property, "value"));
                return encode(property.value, depth + 1);
            }).join(",")}]`;
        }
        else {
            requireValue(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
            const keys = Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
            requireValue(Object.getOwnPropertyNames(v).length === keys.length);
            out = `{${keys.map(key => {
                requireValue(scalarString(key));
                const property = Object.getOwnPropertyDescriptor(v, key);
                requireValue(property && Object.hasOwn(property, "value"));
                return `${JSON.stringify(key)}:${encode(property.value, depth + 1)}`;
            }).join(",")}}`;
        }
        visiting.delete(v);
        return out;
    };
    return encode(value, 0);
}
export const teachingRequestSha256 = (value) => teachingSha256(canonicalTeachingJson(value));
/** Check bytes before parsing; reject silent duplicate-key overwrite (including
 * escaped spellings), invalid Unicode and numbers that cannot round-trip to PG. */
export function parseTeachingJson(raw, maxBytes = TEACHING_BUSINESS_LIMITS.requestBytes) {
    if (typeof raw !== "string" || teachingUtf8Bytes(raw) > maxBytes)
        throw new TeachingInputError("payload_too_large");
    let at = 0;
    const space = () => { while (/[\x20\t\r\n]/u.test(raw[at] ?? "!"))
        at++; };
    const string = () => {
        requireValue(raw[at] === '"');
        const start = at++;
        while (at < raw.length) {
            const ch = raw[at++];
            if (ch === "\\")
                at++;
            else if (ch === '"') {
                const v = JSON.parse(raw.slice(start, at));
                requireValue(typeof v === "string" && scalarString(v));
                return v;
            }
        }
        throw new TeachingInputError();
    };
    const value = (depth) => {
        requireValue(depth <= TEACHING_BUSINESS_LIMITS.jsonDepth);
        space();
        const ch = raw[at];
        if (ch === '"') {
            string();
            return;
        }
        if (ch === "{" || ch === "[") {
            at++;
            space();
            const end = ch === "{" ? "}" : "]";
            const keys = new Set();
            if (raw[at] === end) {
                at++;
                return;
            }
            for (;;) {
                space();
                if (ch === "{") {
                    const key = string();
                    requireValue(!keys.has(key));
                    keys.add(key);
                    space();
                    requireValue(raw[at++] === ":");
                }
                value(depth + 1);
                space();
                if (raw[at] === end) {
                    at++;
                    return;
                }
                requireValue(raw[at++] === ",");
            }
        }
        const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u.exec(raw.slice(at));
        requireValue(token);
        at += token[0].length;
    };
    try {
        value(0);
        space();
        requireValue(at === raw.length);
        const parsed = JSON.parse(raw);
        canonicalTeachingJson(parsed);
        return parsed;
    }
    catch (error) {
        if (error instanceof TeachingInputError)
            throw error;
        throw new TeachingInputError();
    }
}
export const TEACHING_RECORD_KINDS = ["task", "mode", "goal", "material", "anchor", "event", "candidate", "decision", "state", "plan", "correction"];
export const TEACHING_BUSINESS_RPCS = Object.freeze({ start: "aidesk_private.aidesk_teaching_start_v1",
    commit: "aidesk_private.aidesk_teaching_commit_v1", context: "aidesk_private.aidesk_teaching_context_v1",
    evidence: "aidesk_private.aidesk_teaching_evidence_v1", operation: "aidesk_private.aidesk_teaching_operation_v1",
    discover: "aidesk_private.aidesk_teaching_discover_v1", end: "aidesk_private.aidesk_teaching_end_v1" });
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const optional = (v, keys, extra) => exact(v, keys) || exact(v, [...keys, extra]);
const oneOf = (v, values) => typeof v === "string" && values.includes(v);
const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v, max = 4096) => typeof v === "string" && scalarString(v) && v.trim().length > 0
    && teachingUtf8Bytes(v) <= max && Array.from(v).every(ch => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127 || "\t\n\r".includes(ch));
const sha256 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const list = (v, check, max = 16) => Array.isArray(v) && v.length <= max && v.every(x => check(x));
const uuidList = (v) => list(v, isUuid) && new Set(v.map(x => x.toLowerCase())).size === v.length;
const nullable = (v, check) => v === null || check(v);
const ref = (v) => exact(v, ["kind", "id", "version"]) && oneOf(v.kind, TEACHING_RECORD_KINDS) && isUuid(v.id) && integer(v.version, 1);
const goalRef = (v) => ref(v) && v.kind === "goal";
const planStepRef = (v) => exact(v, ["planRef", "stepId"])
    && ref(v.planRef) && v.planRef.kind === "plan" && isUuid(v.stepId);
const refs = (v) => list(v, ref) && new Set(v.map(x => `${x.kind}:${x.id.toLowerCase()}:${x.version}`)).size === v.length;
const kindRefs = (v, kind) => refs(v) && v.every(r => r.kind === kind);
const skillRuleRef = (v) => exact(v, ["resourceId", "revision", "sha256"])
    && typeof v.resourceId === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(v.resourceId) && integer(v.revision, 1) && sha256(v.sha256);
export const validTeachingSkillRuleRefs = (v) => list(v, skillRuleRef)
    && v.length > 0 && new Set(v.map(r => `${r.resourceId}:${r.revision}`)).size === v.length;
export function validTeachingEvidenceBasis(v) {
    if (!teachingObject(v))
        return false;
    if (v.kind === "skill_rule")
        return exact(v, ["kind", "resourceId", "revision", "sha256"])
            && skillRuleRef({ resourceId: v.resourceId, revision: v.revision, sha256: v.sha256 });
    if (v.kind === "evaluation_method")
        return exact(v, ["kind", "id", "version", "sha256"])
            && text(v.id, 128) && text(v.version, 64) && sha256(v.sha256);
    return v.kind === "skill_release" && exact(v, ["kind", "releaseId", "teachingSkillSha256"])
        && isUuid(v.releaseId) && sha256(v.teachingSkillSha256);
}
const taskRef = (v) => exact(v, ["taskId", "revision"]) && isUuid(v.taskId) && integer(v.revision, 1);
const bindingRef = (v) => exact(v, ["bindingId", "epoch"]) && isUuid(v.bindingId) && integer(v.epoch, 1);
const selected = (v) => exact(v, ["familyId", "learnerId", "selectionAttemptId"])
    && text(v.familyId, 256) && text(v.learnerId, 256) && isUuid(v.selectionAttemptId);
const source = (v) => exact(v, ["sourceId", "channel", "claimClass", "role", "text", "sha256", "observedAt", "clientContextId", "bindingPhase", "executionId"])
    && isUuid(v.sourceId) && v.channel === "text" && oneOf(v.claimClass, ["client_observed", "user_reported", "model_proposed", "unverified"])
    && oneOf(v.role, ["user", "assistant"]) && text(v.text) && sha256(v.sha256) && teachingSha256(v.text) === v.sha256
    && isTimestamp(v.observedAt) && isUuid(v.clientContextId) && (v.bindingPhase === "selected_pending_execution"
    ? v.executionId === null : v.bindingPhase === "bound" && isUuid(v.executionId));
const sources = (v) => list(v, source, 4) && new Set(v.map(x => x.sourceId.toLowerCase())).size === v.length
    && v.reduce((n, x) => n + teachingUtf8Bytes(x.text), 0) <= TEACHING_BUSINESS_LIMITS.sourceTotalBytes;
/** Same bounded source validator for the signed Plugin page and SQL inputs. */
export const validTeachingSources = sources;
const help = (v) => exact(v, ["inputAssistance", "contentHelp", "sourceRefs", "notes"])
    && oneOf(v.inputAssistance, ["none", "reported", "transcription", "unknown"])
    && oneOf(v.contentHelp, ["none_reported", "hint", "answer_shown", "mixed", "unknown"]) && uuidList(v.sourceRefs) && nullable(v.notes, text);
const event = (v) => exact(v, ["eventId", "kind", "sourceRefs", "quote", "helpConditions", "occurredAt", "materialRefs"])
    && isUuid(v.eventId) && oneOf(v.kind, ["performance", "prompt", "answer_shown", "revision", "unfinished", "question", "response"])
    && uuidList(v.sourceRefs) && text(v.quote) && help(v.helpConditions) && nullable(v.occurredAt, isTimestamp) && kindRefs(v.materialRefs, "material");
const material = (v) => exact(v, ["materialId", "expectedVersion", "text", "sha256", "sourceClass", "sourceRefs", "resourceRef"])
    && isUuid(v.materialId) && integer(v.expectedVersion) && text(v.text) && sha256(v.sha256) && teachingSha256(v.text) === v.sha256
    && oneOf(v.sourceClass, ["user_reported", "model_proposed", "published"]) && uuidList(v.sourceRefs)
    && (v.sourceClass !== "published" ? v.resourceRef === null : exact(v.resourceRef, ["releaseId", "resourceId", "revision", "sha256"])
        && isUuid(v.resourceRef.releaseId) && text(v.resourceRef.resourceId, 64) && integer(v.resourceRef.revision, 1) && sha256(v.resourceRef.sha256));
const anchor = (v) => exact(v, ["anchorId", "expectedVersion", "label", "description", "relatedRefs"])
    && isUuid(v.anchorId) && integer(v.expectedVersion) && text(v.label, 256) && text(v.description) && refs(v.relatedRefs);
const assessment = (v) => optional(v, ["candidateId", "anchorRef", "eventRefs", "materialRefs", "interpretation", "proposedState", "evaluationMethodRef", "counterRefs", "updateState"], "skillRuleRefs")
    && isUuid(v.candidateId) && ref(v.anchorRef) && v.anchorRef.kind === "anchor" && kindRefs(v.eventRefs, "event") && kindRefs(v.materialRefs, "material") && text(v.interpretation)
    && oneOf(v.proposedState, ["observed_support", "observed_difficulty", "unknown"])
    && exact(v.evaluationMethodRef, ["id", "version", "sha256", "text"]) && text(v.evaluationMethodRef.id, 128)
    && text(v.evaluationMethodRef.version, 64) && text(v.evaluationMethodRef.text) && sha256(v.evaluationMethodRef.sha256)
    && teachingSha256(v.evaluationMethodRef.text) === v.evaluationMethodRef.sha256 && refs(v.counterRefs)
    && 1 + v.eventRefs.length + v.materialRefs.length + v.counterRefs.length <= 15 && typeof v.updateState === "boolean"
    && (!Object.hasOwn(v, "skillRuleRefs") || validTeachingSkillRuleRefs(v.skillRuleRefs));
const plan = (v) => optional(v, ["planId", "expectedVersion", "goalRef", "modeVersion", "stateRefs", "steps", "reason"], "conditionRefs")
    && isUuid(v.planId) && integer(v.expectedVersion) && nullable(v.goalRef, goalRef) && integer(v.modeVersion, 1) && kindRefs(v.stateRefs, "state")
    && Array.isArray(v.steps) && v.steps.length >= 1 && v.steps.length <= 8 && v.steps.every(s => exact(s, ["stepId", "purpose", "anchorRefs"])
    && isUuid(s.stepId) && text(s.purpose) && kindRefs(s.anchorRefs, "anchor")) && new Set(v.steps.map(s => s.stepId.toLowerCase())).size === v.steps.length && text(v.reason)
    && (!Object.hasOwn(v, "conditionRefs") || kindRefs(v.conditionRefs, "event"))
    && new Set([...v.stateRefs, ...(v.conditionRefs ?? []),
        ...v.steps.flatMap(s => s.anchorRefs), ...(v.goalRef ? [v.goalRef] : [])]
        .map(r => `${r.kind}:${r.id.toLowerCase()}:${r.version}`)).size + 1 <= TEACHING_BUSINESS_LIMITS.references;
const correction = (v) => exact(v, ["correctionId", "targetRefs", "sourceRefs", "reason"])
    && isUuid(v.correctionId) && refs(v.targetRefs) && v.targetRefs.length > 0 && uuidList(v.sourceRefs) && text(v.reason);
const checkpoint = (v) => exact(v, ["materials", "anchors", "events", "assessmentCandidates", "planCandidate", "corrections", "taskUpdate", "omissions"])
    && list(v.materials, material, 8) && list(v.anchors, anchor, 8) && list(v.events, event, 8) && list(v.assessmentCandidates, assessment, 8)
    && nullable(v.planCandidate, plan) && list(v.corrections, correction, 8)
    && (v.taskUpdate === null || exact(v.taskUpdate, ["status", "reason"]) && oneOf(v.taskUpdate.status, ["active", "waiting", "completed"]) && text(v.taskUpdate.reason))
    && list(v.omissions, text, 8);
function taskAction(v) {
    if (!teachingObject(v))
        return false;
    if (v.kind === "prepare")
        return exact(v, ["kind"]);
    if (v.kind === "resume" || v.kind === "switch")
        return exact(v, ["kind", "taskRef"]) && taskRef(v.taskRef);
    return v.kind === "new" && exact(v, ["kind", "taskId", "purpose", "purposeSourceRefs", "entryPath", "goalRef", "planStepRef", "originTaskRef"])
        && isUuid(v.taskId) && text(v.purpose) && uuidList(v.purposeSourceRefs) && v.purposeSourceRefs.length > 0
        && oneOf(v.entryPath, ["planned", "question"]) && nullable(v.goalRef, goalRef) && nullable(v.planStepRef, planStepRef) && nullable(v.originTaskRef, taskRef);
}
const page = (v) => integer(v.limit, 1, 16) && integer(v.budgetBytes, 1024, TEACHING_BUSINESS_LIMITS.resultBytes)
    && (v.cursor === null || text(v.cursor, TEACHING_BUSINESS_LIMITS.cursorBytes));
function validInput(action, v) {
    if (v.contract !== TEACHING_BUSINESS_CONTRACT)
        return false;
    if (action === "start")
        return exact(v, ["contract", "operationId", "clientContextId", "expectedBinding", "selected", "skillLoadRef", "sources", "taskAction"])
            && isUuid(v.operationId) && isUuid(v.clientContextId) && nullable(v.expectedBinding, bindingRef) && selected(v.selected)
            && exact(v.skillLoadRef, ["contentRunId", "releaseId", "teachingSkillSha256"]) && isUuid(v.skillLoadRef.contentRunId)
            && isUuid(v.skillLoadRef.releaseId) && sha256(v.skillLoadRef.teachingSkillSha256) && sources(v.sources) && taskAction(v.taskAction)
            && v.sources.every(s => teachingSameUuid(s.clientContextId, v.clientContextId));
    if (action === "commit") {
        if (!exact(v, ["contract", "operationId", "binding", "executionId", "taskRef", "expected", "sources", "action", "payload"])
            || !isUuid(v.operationId) || !bindingRef(v.binding) || !isUuid(v.executionId) || !nullable(v.taskRef, taskRef)
            || !exact(v.expected, ["learnerSequence", "dependencies"]) || !integer(v.expected.learnerSequence) || !refs(v.expected.dependencies)
            || !sources(v.sources) || !v.sources.every(s => s.bindingPhase === "bound" && teachingSameUuid(s.executionId, v.executionId)))
            return false;
        const p = v.payload;
        if (v.action === "select_mode")
            return exact(p, ["mode", "sourceRefs", "quote"]) && oneOf(p.mode, ["application", "exam"])
                && uuidList(p.sourceRefs) && p.sourceRefs.length > 0 && text(p.quote);
        if (v.action === "adopt_mode")
            return exact(p, ["modeVersion"]) && integer(p.modeVersion, 1);
        if (v.action === "goal")
            return exact(p, ["goalId", "expectedVersion", "statement", "status", "sourceRefs", "quote"])
                && isUuid(p.goalId) && integer(p.expectedVersion) && text(p.statement) && oneOf(p.status, ["proposed", "confirmed"])
                && uuidList(p.sourceRefs) && text(p.quote);
        if (v.action === "checkpoint")
            return v.taskRef !== null && checkpoint(p);
        if (v.action === "correction")
            return correction(p);
        if (v.action === "advance_corrections")
            return exact(p, ["correctionId", "limit"]) && isUuid(p.correctionId) && integer(p.limit, 1, 16);
        return false;
    }
    if (action === "end")
        return exact(v, ["contract", "operationId", "binding", "expectedEpoch", "action", "target"])
            && isUuid(v.operationId) && bindingRef(v.binding) && integer(v.expectedEpoch, 1) && v.expectedEpoch === v.binding.epoch
            && (v.action === "end" ? v.target === null : v.action === "switch" && selected(v.target));
    if (action === "context")
        return exact(v, ["contract", "binding", "executionId", "taskId", "views", "budgetBytes"])
            && bindingRef(v.binding) && isUuid(v.executionId) && nullable(v.taskId, isUuid) && integer(v.budgetBytes, 1024, TEACHING_BUSINESS_LIMITS.resultBytes)
            && Array.isArray(v.views) && v.views.length > 0 && v.views.length <= 5 && v.views.every(x => oneOf(x, ["tasks", "mode", "goals", "states", "plans"]))
            && new Set(v.views).size === v.views.length;
    if (action === "evidence")
        return exact(v, ["contract", "binding", "executionId", "filter", "cursor", "limit", "budgetBytes"])
            && bindingRef(v.binding) && isUuid(v.executionId) && optional(v.filter, ["taskIds", "anchorIds", "goalId", "kinds"], "basis")
            && uuidList(v.filter.taskIds) && uuidList(v.filter.anchorIds) && nullable(v.filter.goalId, isUuid)
            && list(v.filter.kinds, (x) => oneOf(x, TEACHING_RECORD_KINDS)) && new Set(v.filter.kinds).size === v.filter.kinds.length
            && (!Object.hasOwn(v.filter, "basis") || validTeachingEvidenceBasis(v.filter.basis)
                && v.filter.kinds.every(k => k === "candidate")) && page(v);
    if (action === "operation")
        return exact(v, ["contract", "operationId", "part", "offset", "budgetBytes"]) && isUuid(v.operationId)
            && (v.part === "receipt" ? v.offset === 0 : v.part === "request" && integer(v.offset))
            && integer(v.budgetBytes, 1024, TEACHING_BUSINESS_LIMITS.resultBytes);
    if (action === "discover")
        return exact(v, ["contract", "familyId", "learnerId", "clientContextId", "cursor", "limit", "budgetBytes"])
            && text(v.familyId, 256) && text(v.learnerId, 256) && nullable(v.clientContextId, isUuid) && page(v);
    return false;
}
export function parseTeachingBusinessInput(action, value) {
    canonicalTeachingJson(value); // Reject lossy/non-JSON callers before taking the immutable snapshot.
    if (teachingUtf8Bytes(JSON.stringify(value)) > TEACHING_BUSINESS_LIMITS.requestBytes)
        throw new TeachingInputError("payload_too_large");
    if (teachingObject(value) && value.contract !== TEACHING_BUSINESS_CONTRACT)
        throw new TeachingInputError("contract_incompatible");
    requireValue(teachingObject(value) && Object.hasOwn(TEACHING_BUSINESS_RPCS, action) && validInput(action, value));
    return structuredClone(value);
}
/** Used only after input parsing; omission retains the exact legacy contract. */
export function usesTeachingCorrectionBasis(action, input) {
    if (action === "evidence")
        return Object.hasOwn(input.filter, "basis");
    if (action !== "commit")
        return false;
    const command = input;
    return command.action === "checkpoint" && (command.payload.assessmentCandidates.some(a => Object.hasOwn(a, "skillRuleRefs"))
        || command.payload.planCandidate !== null && Object.hasOwn(command.payload.planCandidate, "conditionRefs"));
}
const scope = (v) => exact(v, ["familyId", "learnerId"]) && text(v.familyId, 256) && text(v.learnerId, 256);
const sameScope = (a, b) => a.familyId === b.familyId && a.learnerId === b.learnerId;
const sameTask = (a, b) => a === null || b === null ? a === b
    : teachingSameUuid(a.taskId, b.taskId) && a.revision === b.revision;
const jsonObject = (v) => { try {
    if (!teachingObject(v))
        return false;
    canonicalTeachingJson(v);
    return true;
}
catch {
    return false;
} };
function skillRef(v) {
    if (!exact(v, ["releaseId", "candidateSha256", "teachingSkillSha256", "manifest", "fileRefs", "coreContract", "contentContract", "serviceContract"])
        || !isUuid(v.releaseId) || !sha256(v.candidateSha256) || !sha256(v.teachingSkillSha256)
        || ![v.coreContract, v.contentContract, v.serviceContract].every(x => x === CONTENT_CONTRACT))
        return false;
    const format = teachingObject(v.manifest) && v.manifest.format === 2 ? 2 : 1;
    const manifest = parseTeachingSkillManifest(v.manifest, format);
    if (!Array.isArray(v.fileRefs) || v.fileRefs.length !== manifest.files.length || !v.fileRefs.every((f, i) => exact(f, ["path", "resourceId", "revision", "sha256", "bytes"]) && f.path === manifest.files[i].path
        && f.resourceId === manifest.files[i].resourceId && integer(f.revision, 1) && sha256(f.sha256)
        && integer(f.bytes, 1, format === 2 ? 16384 : 4096)))
        return false;
    return teachingRequestSha256({ teachingSkill: manifest, files: v.fileRefs }) === v.teachingSkillSha256;
}
function receipt(v) {
    return exact(v, ["contract", "operationId", "status", "requestSha256", "scope", "executionId", "taskRef", "committedSequence", "records", "decisions", "projection", "data"])
        && v.contract === TEACHING_BUSINESS_CONTRACT && isUuid(v.operationId) && v.status === "completed" && sha256(v.requestSha256)
        && scope(v.scope) && nullable(v.executionId, isUuid) && nullable(v.taskRef, taskRef) && integer(v.committedSequence, 1)
        && list(v.records, ref, 64) && new Set(v.records.map(x => `${x.kind}:${x.id.toLowerCase()}:${x.version}`)).size === v.records.length
        && Array.isArray(v.decisions) && v.decisions.length <= 8 && v.decisions.every(d => exact(d, ["id", "disposition"])
        && isUuid(d.id) && oneOf(d.disposition, ["accepted", "rejected", "deferred"]))
        && new Set(v.decisions.map(d => d.id.toLowerCase())).size === v.decisions.length
        && exact(v.projection, ["throughSequence", "status"]) && integer(v.projection.throughSequence, 0, v.committedSequence)
        && (v.projection.status === "current" ? v.projection.throughSequence === v.committedSequence : v.projection.status === "pending" && v.projection.throughSequence < v.committedSequence)
        && jsonObject(v.data);
}
function writeResult(action, value, input) {
    if (!receipt(value) || !teachingSameUuid(value.operationId, input.operationId) || value.requestSha256 !== teachingRequestSha256(input))
        return false;
    if (action === "commit") {
        const a = input;
        const advancesTask = a.action === "select_mode" || a.action === "adopt_mode" || a.action === "checkpoint" && a.payload.taskUpdate !== null;
        const taskMatches = advancesTask && a.taskRef !== null ? value.taskRef !== null
            && teachingSameUuid(value.taskRef.taskId, a.taskRef.taskId) && value.taskRef.revision === a.taskRef.revision + 1
            && value.records.some(r => r.kind === "task" && teachingSameUuid(r.id, value.taskRef.taskId) && r.version === value.taskRef.revision)
            : sameTask(value.taskRef, a.taskRef);
        return teachingSameUuid(value.executionId, a.executionId) && taskMatches
            && value.committedSequence === a.expected.learnerSequence + 1 && exact(value.data, ["pendingCorrections"])
            && uuidList(value.data.pendingCorrections) && (value.projection.status === "current" ? value.data.pendingCorrections.length === 0 : value.data.pendingCorrections.length > 0);
    }
    if (action === "end") {
        const a = input;
        const d = value.data;
        return value.executionId === null && value.taskRef === null && exact(d, ["bindingId", "epoch", "status", "target"])
            && teachingSameUuid(d.bindingId, a.binding.bindingId) && d.epoch === a.expectedEpoch + 1 && d.status === "ended"
            && canonicalTeachingJson(d.target) === canonicalTeachingJson(a.target);
    }
    const a = input;
    const d = value.data;
    if (!sameScope(value.scope, a.selected) || !exact(d, ["binding", "execution", "taskCreated", "modeState", "readiness", "currentMode"])
        || !exact(d.binding, ["bindingId", "clientContextId", "epoch", "scope", "status", "checkedAt", "recheckAt"])
        || !bindingRef({ bindingId: d.binding.bindingId, epoch: d.binding.epoch }) || !teachingSameUuid(d.binding.clientContextId, a.clientContextId)
        || !scope(d.binding.scope) || !sameScope(d.binding.scope, a.selected) || d.binding.status !== "active"
        || (a.expectedBinding === null ? d.binding.epoch !== 1 : !teachingSameUuid(d.binding.bindingId, a.expectedBinding.bindingId)
            || d.binding.epoch !== a.expectedBinding.epoch && d.binding.epoch !== a.expectedBinding.epoch + 1)
        || !isTimestamp(d.binding.checkedAt) || !isTimestamp(d.binding.recheckAt) || Date.parse(d.binding.recheckAt) <= Date.parse(d.binding.checkedAt)
        || !exact(d.execution, ["executionId", "bindingId", "bindingEpoch", "contentRunId", "skillRef", "adoptedAt", "endedAt"])
        || !teachingSameUuid(d.execution.executionId, value.executionId) || !teachingSameUuid(d.execution.bindingId, d.binding.bindingId)
        || d.execution.bindingEpoch !== d.binding.epoch || !teachingSameUuid(d.execution.contentRunId, a.skillLoadRef.contentRunId)
        || !skillRef(d.execution.skillRef) || !teachingSameUuid(d.execution.skillRef.releaseId, a.skillLoadRef.releaseId)
        || d.execution.skillRef.teachingSkillSha256 !== a.skillLoadRef.teachingSkillSha256 || !isTimestamp(d.execution.adoptedAt) || d.execution.endedAt !== null
        || typeof d.taskCreated !== "boolean" || d.taskCreated !== (a.taskAction.kind === "new"))
        return false;
    if (a.taskAction.kind === "new" && !sameTask(value.taskRef, { taskId: a.taskAction.taskId, revision: 1 })
        || a.taskAction.kind === "prepare" && value.taskRef !== null
        || (a.taskAction.kind === "resume" || a.taskAction.kind === "switch") && !sameTask(value.taskRef, a.taskAction.taskRef))
        return false;
    return d.modeState === "unselected" ? d.currentMode === null && d.readiness === "clarification_required"
        : d.modeState === "selected" && d.readiness === "ready" && exact(d.currentMode, ["mode", "version"])
            && oneOf(d.currentMode.mode, ["application", "exam"]) && integer(d.currentMode.version, 1);
}
function record(v) {
    return exact(v, ["kind", "id", "version", "operationId", "sequence", "taskId", "executionId", "status", "invalidation", "data"])
        && ref({ kind: v.kind, id: v.id, version: v.version }) && isUuid(v.operationId) && integer(v.sequence, 1) && nullable(v.taskId, isUuid)
        && nullable(v.executionId, isUuid) && oneOf(v.status, ["valid", "invalid", "pending_review"])
        && (v.status === "invalid" ? exact(v.invalidation, ["sequence", "operationId"]) && integer(v.invalidation.sequence, 1)
            && isUuid(v.invalidation.operationId) : v.invalidation === null) && jsonObject(v.data);
}
function operationSummary(v) {
    return exact(v, ["operationId", "clientContextId", "executionId", "taskRef", "sequence", "status", "requestSha256", "requestBytes"])
        && isUuid(v.operationId) && isUuid(v.clientContextId) && nullable(v.executionId, isUuid) && nullable(v.taskRef, taskRef)
        && integer(v.sequence, 1) && v.status === "completed" && sha256(v.requestSha256) && integer(v.requestBytes, 1, TEACHING_BUSINESS_LIMITS.requestBytes);
}
function pageResult(action, v, a) {
    if (!exact(v, ["contract", "scope", "items", "snapshotSequence", "projectedThrough", "nextCursor", "completeness", "missingRange"])
        || v.contract !== TEACHING_BUSINESS_CONTRACT || !scope(v.scope) || !integer(v.snapshotSequence)
        || !integer(v.projectedThrough, 0, v.snapshotSequence) || !Array.isArray(v.items) || v.items.length > a.limit
        || !(v.nextCursor === null || text(v.nextCursor, TEACHING_BUSINESS_LIMITS.cursorBytes) && v.nextCursor !== a.cursor)
        || !oneOf(v.completeness, ["complete_in_requested_scope", "partial_budget", "projection_pending"]))
        return false;
    if (action === "discover" && !sameScope(v.scope, a))
        return false;
    const ids = new Set();
    let previousSequence = -1;
    for (const item of v.items) {
        if (action === "evidence" ? !record(item) : !operationSummary(item))
            return false;
        const row = item;
        const id = ("id" in row ? row.id : row.operationId).toLowerCase();
        const key = "kind" in row ? `${row.kind}:${id}:${row.version}` : id;
        // SQL uses its internal immutable row_id to order equal-sequence rows;
        // entity ids are not that tie-breaker and must not be falsely re-sorted.
        if (ids.has(key) || row.sequence > v.snapshotSequence || row.sequence < previousSequence)
            return false;
        ids.add(key);
        previousSequence = row.sequence;
        if ("kind" in row) {
            if (row.invalidation && row.invalidation.sequence > v.snapshotSequence)
                return false;
            const filter = a.filter;
            if (filter.taskIds.length && !filter.taskIds.some(x => teachingSameUuid(x, row.taskId)) || filter.kinds.length && !filter.kinds.includes(row.kind))
                return false;
        }
    }
    if (v.projectedThrough < v.snapshotSequence)
        return v.completeness === "projection_pending"
            && exact(v.missingRange, ["afterSequence", "throughSequence"]) && v.missingRange.afterSequence === v.projectedThrough && v.missingRange.throughSequence === v.snapshotSequence;
    return v.missingRange === null && (v.nextCursor === null ? v.completeness === "complete_in_requested_scope" : v.completeness === "partial_budget");
}
function contextResult(v, a) {
    if (!exact(v, ["contract", "scope", "executionId", "snapshotSequence", "projectedThrough", "views", "completeness"])
        || v.contract !== TEACHING_BUSINESS_CONTRACT || !scope(v.scope) || !teachingSameUuid(v.executionId, a.executionId)
        || !integer(v.snapshotSequence) || !integer(v.projectedThrough, 0, v.snapshotSequence) || !exact(v.views, a.views)
        || !oneOf(v.completeness, ["complete_in_requested_scope", "partial_budget", "projection_pending"]))
        return false;
    const views = v.views;
    const snapshot = v.snapshotSequence;
    const viewKinds = { tasks: "task", mode: "mode", goals: "goal", states: "state", plans: "plan" };
    for (const [name, view] of Object.entries(views)) {
        if (!exact(view, ["availability", "items"]) || !oneOf(view.availability, ["available", "feature_unavailable", "projection_pending"])
            || !list(view.items, record, 16) || view.items.some(x => x.kind !== viewKinds[name] || x.sequence > snapshot || x.invalidation !== null && x.invalidation.sequence > snapshot)
            || view.availability === "feature_unavailable" && view.items.length !== 0)
            return false;
        if (v.projectedThrough < v.snapshotSequence && ["states", "plans"].some(k => views[k] === view) && view.availability === "available")
            return false;
    }
    return v.projectedThrough < v.snapshotSequence ? v.completeness === "projection_pending" : v.completeness !== "projection_pending";
}
function operationResult(v, a) {
    if (!teachingObject(v) || v.contract !== TEACHING_BUSINESS_CONTRACT || !teachingSameUuid(v.operationId, a.operationId))
        return false;
    if (v.status === "not_found")
        return exact(v, ["contract", "operationId", "status", "terminal"]) && v.terminal === false;
    if (!exact(v, ["contract", "operationId", "status", "requestSha256", "receipt", "request"]) || v.status !== "completed" || !sha256(v.requestSha256))
        return false;
    if (a.part === "receipt")
        return v.request === null && receipt(v.receipt) && teachingSameUuid(v.receipt.operationId, a.operationId) && v.receipt.requestSha256 === v.requestSha256;
    if (v.receipt !== null || !exact(v.request, ["sha256", "totalBytes", "offset", "text", "nextOffset"]) || v.request.sha256 !== v.requestSha256
        || !integer(v.request.totalBytes, 1, TEACHING_BUSINESS_LIMITS.requestBytes) || v.request.offset !== a.offset
        || typeof v.request.text !== "string" || !scalarString(v.request.text) || v.request.text.length === 0)
        return false;
    const end = a.offset + teachingUtf8Bytes(v.request.text);
    return end <= v.request.totalBytes && (end === v.request.totalBytes ? v.request.nextOffset === null : v.request.nextOffset === end);
}
export function validTeachingBusinessResult(action, value, input) {
    try {
        canonicalTeachingJson(value);
        const byteLimit = "budgetBytes" in input ? input.budgetBytes : TEACHING_BUSINESS_LIMITS.resultBytes;
        if (teachingUtf8Bytes(JSON.stringify(value)) > byteLimit)
            return false;
        if (action === "start" || action === "commit" || action === "end")
            return writeResult(action, value, input);
        if (action === "operation")
            return operationResult(value, input);
        if (action === "context")
            return contextResult(value, input);
        return pageResult(action, value, input);
    }
    catch {
        return false;
    }
}
