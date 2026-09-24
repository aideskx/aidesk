// Generated from services/authority-api/src/goal-mcp-transport.ts; source SHA-256 bdd6898620659429b9ef00b456458bb9b06d30ec40f3ca8caf03e96c5abe2f77.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject } from "./teaching-business-contract.mjs";
export class GoalMcpTransportError extends Error {
    kind;
    constructor(kind) {
        super(({ invalid_input: "目标请求缺少有效的原件账号信息。", account_changed: "当前账号与原件所属账号不同，本次未派发；原件和未知操作仍保留在原账号。",
            invalid_account_metadata: "目标回执的账号信息无法核验。", invalid_tool_result: "目标工具回执无法核验。" })[kind]);
        this.kind = kind;
        this.name = "GoalMcpTransportError";
    }
}
export const validGoalAccountSubject = (value) => typeof value === "string" && /^cb_[A-Za-z0-9_-]{43}$/u.test(value);
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
function plain(value, kind) {
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        const parsed = parseTeachingJson(wire, 65536);
        if (!teachingObject(parsed))
            throw new Error("Object required");
        return parsed;
    }
    catch {
        throw new GoalMcpTransportError(kind);
    }
}
export function withExpectedGoalAccount(businessInput, subject) {
    const input = plain(businessInput, "invalid_input");
    if (!validGoalAccountSubject(subject) || Object.hasOwn(input, "expectedAccountSubject"))
        throw new GoalMcpTransportError("invalid_input");
    return { ...input, expectedAccountSubject: subject };
}
export function splitGoalMcpRequest(value) {
    const input = plain(value, "invalid_input");
    const expectedAccountSubject = input.expectedAccountSubject;
    if (!validGoalAccountSubject(expectedAccountSubject))
        throw new GoalMcpTransportError("invalid_input");
    delete input.expectedAccountSubject;
    return { expectedAccountSubject, businessInput: input };
}
/** Call only after the original server authentication, before extension/SQL
 * dispatch. A rejection describes this attempt, not an old unknown operation. */
export function assertExpectedGoalAccount(expected, actual) {
    if (!validGoalAccountSubject(expected) || !validGoalAccountSubject(actual))
        throw new GoalMcpTransportError("invalid_input");
    if (expected !== actual)
        throw new GoalMcpTransportError("account_changed");
}
export function withGoalMcpAccountSchema(value) {
    const schema = plain(value, "invalid_input");
    if (schema.type !== "object")
        throw new GoalMcpTransportError("invalid_input");
    if (Array.isArray(schema.oneOf))
        return { ...schema, oneOf: schema.oneOf.map(withGoalMcpAccountSchema) };
    if (!teachingObject(schema.properties) || !Array.isArray(schema.required)
        || schema.required.some(k => typeof k !== "string") || schema.additionalProperties !== false
        || Object.hasOwn(schema.properties, "expectedAccountSubject"))
        throw new GoalMcpTransportError("invalid_input");
    return { ...schema, properties: { ...schema.properties, expectedAccountSubject: { type: "string", pattern: "^cb_[A-Za-z0-9_-]{43}$",
                description: "原件所属账号的并发预条件；不选择或授予账号权限。" } }, required: [...schema.required, "expectedAccountSubject"] };
}
export function validGoalMcpAccount(value) {
    return exact(value, ["format", "subject", "checkedAt"]) && value.format === 1 && validGoalAccountSubject(value.subject) && isTimestamp(value.checkedAt);
}
/** Called only after the successful response's final currentSession check. */
export function withGoalMcpAccount(value, subject, checkedAt) {
    const result = plain(value, "invalid_tool_result");
    const account = { format: 1, subject, checkedAt };
    if (!validGoalMcpAccount(account) || Object.hasOwn(result, "_aideskAccount") || Object.hasOwn(result, "_aideskTransport"))
        throw new GoalMcpTransportError("invalid_account_metadata");
    return { ...result, _aideskAccount: account };
}
/** expectedSubject belongs to the immutable original request, never whichever
 * account happens to be current when a delayed response arrives. checkedAt is
 * an observation timestamp, not a lease or a reason to discard a late receipt. */
export function splitGoalMcpResult(value, expectedSubject) {
    const result = plain(value, "invalid_tool_result");
    const account = result._aideskAccount;
    if (!validGoalMcpAccount(account) || !validGoalAccountSubject(expectedSubject))
        throw new GoalMcpTransportError("invalid_account_metadata");
    if (account.subject !== expectedSubject)
        throw new GoalMcpTransportError("invalid_account_metadata");
    delete result._aideskAccount;
    let transportBytes = null;
    if (Object.hasOwn(result, "_aideskTransport")) {
        const measurement = result._aideskTransport;
        if (!exact(measurement, ["format", "finalJsonRpcUtf8Bytes"]) || measurement.format !== 1
            || !Number.isSafeInteger(measurement.finalJsonRpcUtf8Bytes) || Number(measurement.finalJsonRpcUtf8Bytes) < 1
            || Number(measurement.finalJsonRpcUtf8Bytes) > 65536)
            throw new GoalMcpTransportError("invalid_tool_result");
        transportBytes = Number(measurement.finalJsonRpcUtf8Bytes);
        delete result._aideskTransport;
    }
    return { businessResult: result, account: { ...account }, transportBytes };
}
export function readGoalMcpToolResult(value, expectedSubject) {
    const response = plain(value, "invalid_tool_result");
    if (response.isError !== false || !teachingObject(response.structuredContent) || !Array.isArray(response.content) || response.content.length !== 1
        || !exact(response.content[0], ["type", "text"]) || response.content[0].type !== "text" || typeof response.content[0].text !== "string")
        throw new GoalMcpTransportError("invalid_tool_result");
    const text = plain(response.content[0].text, "invalid_tool_result");
    if (canonicalTeachingJson(text) !== canonicalTeachingJson(response.structuredContent))
        throw new GoalMcpTransportError("invalid_tool_result");
    const result = splitGoalMcpResult(response.structuredContent, expectedSubject);
    if (teachingObject(response._meta) && Object.hasOwn(response._meta, "aidesk/finalJsonRpcUtf8Bytes")
        && response._meta["aidesk/finalJsonRpcUtf8Bytes"] !== result.transportBytes)
        throw new GoalMcpTransportError("invalid_tool_result");
    return result;
}
