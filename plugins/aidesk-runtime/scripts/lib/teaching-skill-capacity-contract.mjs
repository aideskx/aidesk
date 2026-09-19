// Generated from services/authority-api/src/teaching-skill-capacity-contract.ts; source SHA-256 76262b3de648787045098d43f9af9ce6000fd874cded77f4d19e548242aea32a.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTextId, isUuid } from "./domain-inputs.mjs";
import { CONTENT_CONTRACT, contentSha256, isContentObject, isContentSha256, parseContentReleaseCandidate, parseTeachingSkillManifest, teachingSkillPackageProjection, teachingSkillPackageSha256, validContentToolInput, validContentResult } from "./teaching-content-contract.mjs";
/** Versioned teaching delivery contract, not a product quota or a delivery/comprehension attestation. */
export const CAPACITY_CONTRACT = "aidesk-teaching-skill-capacity-v1";
export const CAPACITY_PROFILE = "skill64-v1";
export const CAPACITY_LIMITS = Object.freeze({ files: 16, fileBytes: 16384, expandedBytes: 65536,
    candidateBytes: 262144, pageBytes: 4096, pages: 32, responseBytes: 65536,
    stageCalls: 40, stageResponseBytes: 524288, stageMs: 180000, retries: 2, restarts: 1,
    uploadBytes: 4096, uploadParts: 256, draftMs: 86400000, loadMs: 180000 });
export const TEACHING_SKILL_CAPACITY_ACTIONS = ["begin", "page", "complete", "status"];
const exact = (v, keys) => isContentObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const int = (v, min, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const size = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
const timestamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const uuidEqual = (a, b) => isUuid(a) && isUuid(b) && a.toLowerCase() === b.toLowerCase();
export function canonicalTeachingSkillCapacity(v) {
    if (Array.isArray(v))
        return `[${v.map(canonicalTeachingSkillCapacity).join(",")}]`;
    if (isContentObject(v))
        return `{${Object.keys(v).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
            .map(k => `${JSON.stringify(k)}:${canonicalTeachingSkillCapacity(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
}
export function parseTeachingSkillCapacityCandidate(value) {
    const candidate = parseContentReleaseCandidate(value);
    if (candidate.teachingSkill?.format !== 2)
        throw new Error("Capacity profile requires manifest format 2");
    teachingSkillCapacityPages(candidate);
    return candidate;
}
/** A page contains one file fragment. Deterministic Unicode-scalar boundaries; no normalization or separator insertion. */
export function teachingSkillCapacityPages(candidate) {
    if (candidate.teachingSkill?.format !== 2)
        throw new Error("Capacity profile requires manifest format 2");
    const projection = teachingSkillPackageProjection(candidate), pages = [];
    for (const [fileIndex, file] of projection.files.entries()) {
        let offset = 0, fragment = "", count = 0;
        const emit = () => {
            if (!count)
                return;
            pages.push({ pageIndex: pages.length, fileIndex, offset, bytes: count,
                sha256: contentSha256(fragment), text: fragment });
            offset += count;
            fragment = "";
            count = 0;
        };
        for (const scalar of file.body) {
            const n = size(scalar);
            if (count + n > CAPACITY_LIMITS.pageBytes)
                emit();
            fragment += scalar;
            count += n;
        }
        emit();
    }
    if (pages.length < 1 || pages.length > CAPACITY_LIMITS.pages)
        throw new Error("Capacity page count exceeds bound");
    return pages;
}
const inputKeys = ["familyId", "learnerId", "coreContract", "profile", "runId", "loadId"];
export function validTeachingSkillCapacityInput(action, value) {
    if (action === "catalog" || action === "read") {
        if (!isContentObject(value) || value.profile !== CAPACITY_PROFILE)
            return false;
        const { profile: _profile, ...legacy } = value;
        void _profile;
        return value.coreContract === CONTENT_CONTRACT && validContentToolInput(action === "catalog" ? "aidesk_read_content_catalog" : "aidesk_read_content", legacy);
    }
    if (!TEACHING_SKILL_CAPACITY_ACTIONS.includes(action) || !exact(value, [...inputKeys,
        ...(action === "begin" ? ["releaseId", "purpose"] : ["teachingSkillSha256", ...(action === "page" ? ["pageIndex"] : action === "status" ? ["purpose"] : [])])])
        || value.coreContract !== CONTENT_CONTRACT || value.profile !== CAPACITY_PROFILE || !isTextId(value.familyId) || !isTextId(value.learnerId)
        || !isUuid(value.runId) || !isUuid(value.loadId) || size(value) > 8192)
        return false;
    return action === "begin" ? ["new", "continue", "review"].includes(String(value.purpose))
        && (isUuid(value.releaseId) || value.releaseId === null && value.purpose === "new")
        : isContentSha256(value.teachingSkillSha256) && (action !== "status" || ["new", "continue", "review"].includes(String(value.purpose))) && (action !== "page" || int(value.pageIndex, 0, 31));
}
const identityKeys = ["contract", "profile", "scope", "runId", "loadId", "releaseId", "teachingSkillSha256"];
const manifestKeys = [...identityKeys, "candidateSha256", "activeVersion", "purpose", "lifecycle", "useAllowed", "checkedAt", "recheckAfterMs",
    "expiresAt", "status", "completedAt", "teachingSkill", "files", "expandedBytes", "pages", "processedPages"];
function identity(value, input) {
    return value.contract === CAPACITY_CONTRACT && value.profile === CAPACITY_PROFILE
        && exact(value.scope, ["familyId", "learnerId"]) && value.scope.familyId === input.familyId && value.scope.learnerId === input.learnerId
        && uuidEqual(value.runId, input.runId) && uuidEqual(value.loadId, input.loadId) && isUuid(value.releaseId) && isContentSha256(value.teachingSkillSha256);
}
function validManifest(value) {
    if (!exact(value, manifestKeys) || !isContentSha256(value.candidateSha256) || !int(value.activeVersion, 0)
        || !["new", "continue", "review"].includes(String(value.purpose)) || !["available", "retired", "invalid"].includes(String(value.lifecycle))
        || typeof value.useAllowed !== "boolean" || (value.purpose === "review" || value.lifecycle === "invalid" || value.purpose === "new" && value.lifecycle !== "available") && value.useAllowed !== false
        || !timestamp(value.checkedAt) || value.recheckAfterMs !== 30000 || !timestamp(value.expiresAt)
        || !["loading", "complete"].includes(String(value.status)) || !(value.status === "complete" ? timestamp(value.completedAt) : value.completedAt === null)
        || !int(value.expandedBytes, 1, 65536))
        return false;
    const manifest = parseTeachingSkillManifest(value.teachingSkill, 2);
    if (!Array.isArray(value.files) || value.files.length !== manifest.files.length || !value.files.every((f, i) => exact(f, ["path", "resourceId", "revision", "sha256", "bytes"]) && f.path === manifest.files[i].path
        && f.resourceId === manifest.files[i].resourceId && int(f.revision, 1) && isContentSha256(f.sha256) && int(f.bytes, 1, 16384)))
        return false;
    if (contentSha256(canonicalTeachingSkillCapacity({ teachingSkill: manifest, files: value.files })) !== value.teachingSkillSha256
        || !Array.isArray(value.pages) || !int(value.pages.length, 1, 32))
        return false;
    let previousFile = 0, offset = 0;
    for (const [i, p] of value.pages.entries()) {
        if (!exact(p, ["pageIndex", "fileIndex", "offset", "bytes", "sha256"]) || p.pageIndex !== i || !int(p.fileIndex, 0, value.files.length - 1)
            || !int(p.offset, 0, 16383) || !int(p.bytes, 1, 4096) || !isContentSha256(p.sha256))
            return false;
        if (p.fileIndex !== previousFile) {
            if (p.fileIndex !== previousFile + 1 || offset !== value.files[previousFile].bytes)
                return false;
            previousFile = p.fileIndex;
            offset = 0;
        }
        if (p.offset !== offset)
            return false;
        offset += p.bytes;
    }
    if (previousFile !== value.files.length - 1 || offset !== value.files[previousFile].bytes
        || !Array.isArray(value.processedPages) || !value.processedPages.every((v, i) => int(v, 0, value.pages.length - 1)
        && (i === 0 || Number(value.processedPages instanceof Array ? value.processedPages[i - 1] : -1) < v)))
        return false;
    return value.status !== "complete" || value.processedPages.length === value.pages.length;
}
export function validTeachingSkillCapacityResult(action, value, input, anchor) {
    try {
        if (action === "catalog" || action === "read") {
            if (!validTeachingSkillCapacityInput(action, input) || !isContentObject(value))
                return false;
            const { profile: _profile, ...legacy } = input;
            void _profile;
            return validContentResult(action === "catalog" ? "aidesk_read_content_catalog" : "aidesk_read_content", value, legacy);
        }
        if (!validTeachingSkillCapacityInput(action, input) || !isContentObject(value) || size(value) > 30000)
            return false;
        if (action === "begin" && value.status === "legacy_available") {
            const request = input;
            return request.purpose === "new" && request.releaseId === null && exact(value, ["contract", "profile", "scope", "runId", "loadId", "status", "legacyReleaseId", "legacyActiveVersion", "checkedAt", "recheckAfterMs"])
                && value.contract === CAPACITY_CONTRACT && value.profile === CAPACITY_PROFILE && exact(value.scope, ["familyId", "learnerId"])
                && value.scope.familyId === request.familyId && value.scope.learnerId === request.learnerId
                && uuidEqual(value.runId, request.runId) && uuidEqual(value.loadId, request.loadId) && isUuid(value.legacyReleaseId)
                && int(value.legacyActiveVersion, 1) && timestamp(value.checkedAt) && value.recheckAfterMs === 30000;
        }
        if (action === "status" && value.status === "not_found")
            return exact(value, ["contract", "profile", "scope", "runId", "loadId", "teachingSkillSha256", "status"])
                && value.contract === CAPACITY_CONTRACT && value.profile === CAPACITY_PROFILE && exact(value.scope, ["familyId", "learnerId"])
                && value.scope.familyId === input.familyId && value.scope.learnerId === input.learnerId && uuidEqual(value.runId, input.runId)
                && uuidEqual(value.loadId, input.loadId) && value.teachingSkillSha256 === input.teachingSkillSha256;
        if (!identity(value, input) || action !== "begin" && value.teachingSkillSha256 !== input.teachingSkillSha256)
            return false;
        if (action === "begin") {
            const a = input;
            if (value.purpose !== a.purpose || a.releaseId !== null && !uuidEqual(a.releaseId, value.releaseId))
                return false;
        }
        if (action === "status" && value.purpose !== input.purpose)
            return false;
        if (action !== "page")
            return validManifest(value) && (action !== "complete" || value.status === "complete")
                && (action === "status" || (value.purpose === "review" || value.useAllowed === true) && (value.purpose !== "new" || value.lifecycle === "available"))
                && (!anchor || sameManifest(value, anchor));
        if (!exact(value, [...identityKeys, "pageIndex", "fileIndex", "path", "resourceId", "revision", "fileSha256", "offset", "bytes", "sha256", "text", "checkedAt", "recheckAfterMs"])
            || value.pageIndex !== input.pageIndex || !int(value.fileIndex, 0, 15)
            || typeof value.path !== "string" || size(value.path) > 128 || typeof value.resourceId !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/u.test(value.resourceId)
            || !int(value.revision, 1) || !isContentSha256(value.fileSha256) || !int(value.offset, 0, 16383) || !int(value.bytes, 1, 4096)
            || typeof value.text !== "string" || !value.text.isWellFormed() || value.text.includes("\0") || size(value.text) !== value.bytes
            || contentSha256(value.text) !== value.sha256 || !timestamp(value.checkedAt) || value.recheckAfterMs !== 30000)
            return false;
        if (!anchor)
            return true;
        const page = anchor.pages[value.pageIndex], file = anchor.files[value.fileIndex];
        return !!page && !!file && uuidEqual(value.releaseId, anchor.releaseId) && value.teachingSkillSha256 === anchor.teachingSkillSha256
            && page.fileIndex === value.fileIndex && page.offset === value.offset && page.bytes === value.bytes && page.sha256 === value.sha256
            && file.path === value.path && file.resourceId === value.resourceId && file.revision === value.revision && file.sha256 === value.fileSha256;
    }
    catch {
        return false;
    }
}
function sameManifest(a, b) {
    return uuidEqual(a.releaseId, b.releaseId) && a.candidateSha256 === b.candidateSha256 && a.teachingSkillSha256 === b.teachingSkillSha256
        && a.expandedBytes === b.expandedBytes && a.expiresAt === b.expiresAt
        && canonicalTeachingSkillCapacity(a.pages) === canonicalTeachingSkillCapacity(b.pages)
        && canonicalTeachingSkillCapacity(a.files) === canonicalTeachingSkillCapacity(b.files)
        && canonicalTeachingSkillCapacity(a.teachingSkill) === canonicalTeachingSkillCapacity(b.teachingSkill);
}
/** Requires each actual page exactly once, in manifest order. Completion still requires a separately validated server receipt. */
export function assembleTeachingSkillCapacity(manifest, pages) {
    if (!validManifest(manifest) || pages.length !== manifest.pages.length)
        throw new Error("Incomplete capacity pages");
    const files = manifest.files.map(f => ({ ...f, body: "" }));
    for (const [pageIndex, page] of pages.entries()) {
        const input = { ...manifest.scope, coreContract: CONTENT_CONTRACT,
            profile: CAPACITY_PROFILE, runId: manifest.runId, loadId: manifest.loadId, teachingSkillSha256: manifest.teachingSkillSha256, pageIndex };
        if (!validTeachingSkillCapacityResult("page", page, input, manifest))
            throw new Error("Invalid capacity page");
        files[page.fileIndex].body += page.text;
    }
    for (const file of files)
        if (size(file.body) !== file.bytes || contentSha256(file.body) !== file.sha256)
            throw new Error("Invalid complete file");
    const projection = { teachingSkill: manifest.teachingSkill, files };
    if (size(canonicalTeachingSkillCapacity(projection)) !== manifest.expandedBytes)
        throw new Error("Invalid complete package bytes");
    return projection;
}
export function teachingSkillCapacitySummary(candidate) {
    const parsed = parseTeachingSkillCapacityCandidate(candidate), projection = teachingSkillPackageProjection(parsed);
    return { profile: CAPACITY_PROFILE, teachingSkillSha256: teachingSkillPackageSha256(parsed), expandedBytes: size(canonicalTeachingSkillCapacity(projection)),
        pages: teachingSkillCapacityPages(parsed).map(({ text: _text, ...ref }) => ref), ...teachingSkillPackageProjection(parsed, true) };
}
// Public aliases consumed by the original service and generated Plugin contract bundle.
export const SKILL_CAPACITY_CONTRACT = CAPACITY_CONTRACT;
export const SKILL_CAPACITY_PROFILE = CAPACITY_PROFILE;
export const SKILL_CAPACITY_LIMITS = CAPACITY_LIMITS;
export const parseCapacityContentReleaseCandidate = parseTeachingSkillCapacityCandidate;
export const capacitySkillPackageProjection = (value, metadataOnly = false) => teachingSkillPackageProjection(parseTeachingSkillCapacityCandidate(value), metadataOnly);
export const capacitySkillPackageSha256 = (value) => teachingSkillPackageSha256(parseTeachingSkillCapacityCandidate(value));
