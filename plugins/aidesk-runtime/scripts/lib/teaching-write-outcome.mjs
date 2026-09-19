// Generated from services/authority-api/src/teaching-write-outcome.ts; source SHA-256 af603932914798540b498634c86af05632c756391faf1251e646c0af91cd603e.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, teachingObject, teachingRequestSha256, teachingSameUuid, TEACHING_CORRECTION_BASIS_CONTRACT } from "./teaching-business-contract.mjs";
import { unpackTeachingPluginRequest } from "./teaching-plugin-transport.mjs";
/** Terminal rejection is backed by the original owner durable denial fence.
 * It is never a completed 03 receipt or a learning fact. */
export const TEACHING_WRITE_OUTCOME_CONTRACT = "aidesk-teaching-write-outcome-v1";
export const TEACHING_WRITE_REJECTION_KINDS = ["invalid_input", "payload_too_large", "contract_incompatible",
    "scope_denied", "entry_denied", "feature_unavailable", "binding_stale", "version_conflict", "operation_conflict",
    "source_missing", "source_mismatch", "dependency_invalid", "content_invalid", "content_missing",
    "content_incompatible", "content_retired", "cancelled_by_user"];
export const TEACHING_DENIAL_CONTRACT = "aidesk-teaching-denial-v1";
const commits = ["select_mode", "adopt_mode", "goal", "checkpoint", "correction", "advance_corrections"];
const exact = (value, keys) => teachingObject(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const signedShape = (value, keys) => exact(value, keys)
    || exact(value, [...keys, "correctionContract"]) && value.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT;
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const b64 = (v, size) => typeof v === "string" && /^[A-Za-z0-9_-]+$/u.test(v)
    && Buffer.from(v, "base64url").length === size && Buffer.from(v, "base64url").toString("base64url") === v;
const context = (v) => exact(v, ["subject", "familyId", "learnerId", "selectionAttemptId", "clientContextId"])
    && typeof v.subject === "string" && /^cb_[A-Za-z0-9_-]{43}$/u.test(v.subject)
    && [v.familyId, v.learnerId].every(x => typeof x === "string" && x.length > 0 && Buffer.byteLength(x) <= 256 && !/[\p{Cc}\p{Cf}]/u.test(x))
    && isUuid(v.selectionAttemptId) && isUuid(v.clientContextId);
function writeAction(tool) {
    if (tool === "aidesk_teaching_start")
        return "start";
    if (tool === "aidesk_teaching_end")
        return "end";
    return commits.some(action => tool === `aidesk_teaching_${action}`) ? "commit" : null;
}
export function isTeachingWriteRejectionKind(value) {
    return TEACHING_WRITE_REJECTION_KINDS.some(kind => kind === value);
}
/** Mechanical correlation only, NOT signature verification, admission or a
 * terminal proof. Even a syntactically valid bad signature can correlate;
 * the service must verify current authority before creating any durable denial. */
export function correlateTeachingWriteAttempt(tool, args, authenticatedSubject) {
    try {
        const action = writeAction(tool), wire = args._aidesk;
        if (!action || !signedShape(wire, ["protocol", "kind", "challengeId", "nonce", "keyId", "context", "callId", "tool",
            "argumentsSha256", "issuedAt", "payload", "signature", "resultContract"])
            || wire.protocol !== "aidesk-teaching-plugin-v1" || wire.kind !== "signed" || wire.resultContract !== TEACHING_WRITE_OUTCOME_CONTRACT
            || !context(wire.context) || wire.context.subject !== authenticatedSubject || !isUuid(wire.challengeId) || !b64(wire.nonce, 32)
            || !hash(wire.keyId) || !isUuid(wire.callId) || wire.tool !== tool || !isTimestamp(wire.issuedAt) || !b64(wire.signature, 64)
            || !exact(wire.payload, ["businessRequest", "contentRequest", "sourcePage", "localOperations"])
            || wire.payload.contentRequest !== null || wire.payload.sourcePage !== null
            || !Array.isArray(wire.payload.localOperations) || wire.payload.localOperations.length !== 0)
            return null;
        const argsOnly = { ...args };
        delete argsOnly._aidesk;
        if (wire.argumentsSha256 !== teachingRequestSha256(argsOnly))
            return null;
        const request = unpackTeachingPluginRequest(action, wire.payload.businessRequest, argsOnly);
        if (action === "start") {
            const r = request;
            if (!exact(argsOnly, ["taskAction"]) || !same(r.taskAction, argsOnly.taskAction)
                || !teachingSameUuid(r.clientContextId, wire.context.clientContextId)
                || !same(r.selected, { familyId: wire.context.familyId, learnerId: wire.context.learnerId, selectionAttemptId: wire.context.selectionAttemptId }))
                return null;
        }
        else if (action === "commit") {
            const r = request, payload = { ...argsOnly };
            delete payload.dependencies;
            delete payload.taskRef;
            delete payload.expectedSequence;
            if (tool !== `aidesk_teaching_${r.action}` || !same(r.payload, payload) || !same(r.expected.dependencies, argsOnly.dependencies)
                || Object.hasOwn(argsOnly, "taskRef") && !same(argsOnly.taskRef, r.taskRef)
                || Object.hasOwn(argsOnly, "expectedSequence") && argsOnly.expectedSequence !== r.expected.learnerSequence)
                return null;
        }
        else {
            const r = request;
            if (!exact(argsOnly, []) || r.action !== "end" || r.target !== null || r.expectedEpoch !== r.binding.epoch)
                return null;
        }
        return { operationId: request.operationId, rpcAction: action, requestSha256: teachingRequestSha256(request), callId: wire.callId,
            tool, argumentsSha256: wire.argumentsSha256, signedEnvelopeSha256: teachingRequestSha256(wire), context: structuredClone(wire.context) };
    }
    catch {
        return null;
    }
}
/** Mechanical call correlation only; no signature/admission claim. */
export function correlateTeachingCall(tool, args, authenticatedSubject) {
    try {
        const wire = args._aidesk;
        if (!signedShape(wire, ["protocol", "kind", "challengeId", "nonce", "keyId", "context", "callId", "tool", "argumentsSha256", "issuedAt", "payload", "signature", "resultContract"])
            || wire.protocol !== "aidesk-teaching-plugin-v1" || wire.kind !== "signed" || wire.resultContract !== TEACHING_WRITE_OUTCOME_CONTRACT
            || !context(wire.context) || wire.context.subject !== authenticatedSubject || wire.tool !== tool || !isUuid(wire.callId)
            || !isUuid(wire.challengeId) || !b64(wire.nonce, 32) || !hash(wire.keyId) || !b64(wire.signature, 64) || !isTimestamp(wire.issuedAt))
            return null;
        const plain = { ...args };
        delete plain._aidesk;
        if (wire.argumentsSha256 !== teachingRequestSha256(plain))
            return null;
        return { callId: wire.callId, tool, argumentsSha256: wire.argumentsSha256,
            signedEnvelopeSha256: teachingRequestSha256(wire), context: structuredClone(wire.context) };
    }
    catch {
        return null;
    }
}
export function validTeachingDenialProof(v) {
    return exact(v, ["contract", "status", "terminal", "operationId", "rpcAction", "requestSha256", "kind", "scope", "proofId", "rejectedAt"])
        && v.contract === TEACHING_DENIAL_CONTRACT && v.status === "rejected" && v.terminal === true
        && isUuid(v.operationId) && ["start", "commit", "end"].includes(String(v.rpcAction)) && hash(v.requestSha256)
        && isTeachingWriteRejectionKind(v.kind) && isUuid(v.proofId) && isTimestamp(v.rejectedAt)
        && exact(v.scope, ["familyId", "learnerId"]) && [v.scope.familyId, v.scope.learnerId].every(x => typeof x === "string" && x.length > 0 && Buffer.byteLength(x) <= 256 && !/[\p{Cc}\p{Cf}]/u.test(x));
}
/** Hook consumers must supply the actual recorded call AND independently bind
 * proof.operationId/requestSha256/rpcAction/scope to the immutable old outbox. */
export function validTeachingWriteRejected(value, call) {
    try {
        if (!exact(value, ["protocol", "resultContract", "status", "terminal", "effect", "proof", "callId", "tool", "argumentsSha256", "signedEnvelopeSha256", "context"])
            || value.protocol !== "aidesk-teaching-plugin-v1" || value.resultContract !== TEACHING_WRITE_OUTCOME_CONTRACT
            || value.status !== "rejected" || value.terminal !== true || value.effect !== "operation_fenced" || !validTeachingDenialProof(value.proof)
            || !isUuid(value.callId) || typeof value.tool !== "string" || !(writeAction(value.tool) || ["aidesk_teaching_operation", "aidesk_teaching_cancel_operation"].includes(value.tool))
            || !hash(value.argumentsSha256) || !hash(value.signedEnvelopeSha256) || !context(value.context)
            || !same(value.proof.scope, { familyId: value.context.familyId, learnerId: value.context.learnerId }))
            return false;
        return !call || teachingSameUuid(value.callId, call.callId) && value.tool === call.tool && value.argumentsSha256 === call.argumentsSha256
            && value.signedEnvelopeSha256 === call.signedEnvelopeSha256 && same(value.context, call.context);
    }
    catch {
        return false;
    }
}
export function createTeachingWriteRejected(call, proof) {
    const result = { callId: call.callId, tool: call.tool, argumentsSha256: call.argumentsSha256,
        signedEnvelopeSha256: call.signedEnvelopeSha256, context: structuredClone(call.context), protocol: "aidesk-teaching-plugin-v1",
        resultContract: TEACHING_WRITE_OUTCOME_CONTRACT, status: "rejected", terminal: true, effect: "operation_fenced", proof: structuredClone(proof) };
    if (!validTeachingWriteRejected(result, call))
        throw new Error("Invalid teaching denial correlation");
    return result;
}
