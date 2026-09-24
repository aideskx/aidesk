// Generated from services/authority-api/src/domain-inputs.ts; source SHA-256 4606a9e91be67f2de3d8b2e95584dfa32540fe6d2c9d472f425fde0ead43a08c.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
export const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/u;
export const isUuid = (value) => typeof value === "string" && uuidPattern.test(value);
export const isTextId = (value) => typeof value === "string" && value.trim().length > 0
    && Array.from(value).length <= 256
    && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
export const isName = (value) => isTextId(value) && Array.from(value).length <= 128;
export const isVersion = (value) => Number.isSafeInteger(value) && Number(value) > 0;
export const isProfilePurpose = (value) => value === "child" || value === "adult" || value === "unknown";
export const isRole = (value) => value === "adult" || value === "guardian";
export const isLearnerIds = (value) => Array.isArray(value) && value.length <= 100
    && value.every(isTextId) && new Set(value).size === value.length;
export function isTimestamp(value) {
    if (typeof value !== "string")
        return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/iu.exec(value);
    if (!match || !Number.isFinite(Date.parse(value)))
        return false;
    const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
        && hour <= 23 && minute <= 59 && second <= 59 && (!match[7] || Number(match[8]) <= 23 && Number(match[9]) <= 59);
}
const fieldChecks = {
    contract: value => value === "aidesk-teaching-business-v2",
    operationId: isUuid, attemptId: isUuid, familyId: isTextId, name: isName, requestId: isUuid, memberId: isUuid,
    role: isRole, canManage: value => typeof value === "boolean", learnerIds: isLearnerIds, expectedVersion: isVersion,
    decision: value => value === "approve" || value === "reject", learnerId: isTextId, profilePurpose: isProfilePurpose,
    action: value => typeof value === "string" && ["issue", "suspend", "resume", "renew"].includes(value),
    entitlementId: value => value === null || isTextId(value), expiresAt: value => value === null || isTimestamp(value),
};
/** Both MCP and direct client calls reject malformed targets. SQL remains the
 * authorization owner and evaluates versions, membership, scope and time.
 */
export function validInputFields(input, keys) {
    if (!keys.every(key => Object.hasOwn(input, key) && fieldChecks[key]?.(input[key])))
        return false;
    if (keys.includes("decision") && input.decision === "reject"
        && (input.role !== "adult" || input.canManage !== false || input.learnerIds.length !== 0))
        return false;
    if (keys.includes("action")) {
        if (input.action === "issue")
            return input.entitlementId === null && isTimestamp(input.expiresAt);
        if (!isTextId(input.entitlementId))
            return false;
        return input.action === "renew" ? isTimestamp(input.expiresAt) : input.expiresAt === null;
    }
    return true;
}
