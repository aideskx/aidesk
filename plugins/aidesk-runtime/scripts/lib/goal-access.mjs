// Generated from services/authority-api/src/goal-access.ts; source SHA-256 49d5237d8f0731a84a481598307f2398d971870093a703edeca758f0f9d90a58.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTextId, isTimestamp } from "./domain-inputs.mjs";
/** Non-authoritative projection of the account SQL owner's goal access.
 * Selection and timestamps are evidence of a read, never business admission
 * or proof that a host reply has begun. Trial activation belongs to SQL start. */
export const GOAL_ACCESS_CONTRACT = "aidesk-goal-access-v1";
export function validGoalAccess(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const v = value;
    const keys = ["contract", "state", "checkedAt", "startsAt", "expiresAt", "learnerLimit", "eligibleLearnerIds"];
    if (Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k))
        || v.contract !== GOAL_ACCESS_CONTRACT || !isTimestamp(v.checkedAt) || v.learnerLimit !== 3
        || !Array.isArray(v.eligibleLearnerIds) || v.eligibleLearnerIds.length > 3
        || !v.eligibleLearnerIds.every(isTextId) || new Set(v.eligibleLearnerIds).size !== v.eligibleLearnerIds.length)
        return false;
    if (v.state === "eligible" || v.state === "unknown" || v.state === "blocked")
        return v.startsAt === null && v.expiresAt === null;
    if (!["active", "annual", "expired"].includes(String(v.state)) || !isTimestamp(v.startsAt) || !isTimestamp(v.expiresAt))
        return false;
    const start = Date.parse(v.startsAt), end = Date.parse(v.expiresAt), checked = Date.parse(v.checkedAt);
    return start < end && start <= checked && (v.state === "expired" ? end <= checked : checked < end);
}
