// Generated from services/authority-api/src/teaching-content-contract.ts; source SHA-256 b5e3e3860c5752a5269cf2541fbe009ff207bc7b337962a0fe01c0f0e7a55632.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { createHash } from "node:crypto";
import { isTextId, isUuid } from "./domain-inputs.mjs";
/** Non-authoritative implementation contract for gate 01 only. No teaching
 * task, learner state, goal or mode is created by this content mechanism. */
export const CONTENT_CONTRACT = "aidesk-content-v1";
export const CONTENT_LIMITS = Object.freeze({ resourceBytes: 4096, candidateBytes: 32768,
    resources: 32, dependencies: 4, catalogPage: 8, readBatch: 4, mcpResponseBytes: 65536,
    statusWindowMs: 30000, requestTimeoutMs: 10000 });
export const TEACHING_SKILL_LIMITS = Object.freeze({ files: 16, expandedBytes: 16384, pathBytes: 128 });
export const CONTENT_TOOL_NAMES = ["aidesk_read_content_catalog", "aidesk_read_content",
    "aidesk_record_content_adoption", "aidesk_content_operation_status", "aidesk_load_teaching_skill"];
export const isContentObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
export const contentSha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
export const isContentSha256 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const bytes = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v), "utf8");
const exact = (v, keys) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const id = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(v);
const positive = (v) => Number.isSafeInteger(v) && Number(v) > 0;
// PostgreSQL renders typed UUIDs in lowercase; compare their values without rewriting immutable inputs.
const sameUuid = (left, right) => isUuid(left) && isUuid(right) && left.toLowerCase() === right.toLowerCase();
const text = (v, max) => typeof v === "string" && v.isWellFormed() && !!v.trim() && bytes(v) <= max
    && !Array.from(v).some(c => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)) || c.charCodeAt(0) === 127);
const evidence = (v) => isContentObject(v) && exact(v, ["verdict", "sha256"])
    && ["passed", "failed", "pending"].includes(String(v.verdict)) && isContentSha256(v.sha256);
function canonical(v) {
    if (Array.isArray(v))
        return `[${v.map(canonical).join(",")}]`;
    if (isContentObject(v))
        return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
    return JSON.stringify(v);
}
export const contentReleaseSha256 = (candidate) => contentSha256(canonical(candidate));
/** Text-only, bounded complete package. Paths are logical names, never filesystem destinations. */
export function parseTeachingSkillManifest(value, format = 1) {
    if (!isContentObject(value) || !exact(value, ["format", "packageId", "version", "entry", "files"])
        || value.format !== format || !id(value.packageId) || typeof value.version !== "string" || bytes(value.version) > 64
        || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[a-z0-9.-]+)?$/u.test(value.version)
        || value.entry !== "SKILL.md" || !Array.isArray(value.files) || value.files.length < 1 || value.files.length > TEACHING_SKILL_LIMITS.files)
        throw new Error("Invalid teaching Skill manifest");
    const paths = new Set();
    const resources = new Set();
    for (const file of value.files) {
        if (!isContentObject(file) || !exact(file, ["path", "resourceId"]) || !id(file.resourceId)
            || typeof file.path !== "string" || bytes(file.path) > TEACHING_SKILL_LIMITS.pathBytes
            || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/u.test(file.path)
            || paths.has(file.path.toLowerCase()) || resources.has(file.resourceId))
            throw new Error("Invalid teaching Skill path");
        paths.add(file.path.toLowerCase());
        resources.add(file.resourceId);
    }
    if (value.files.filter(f => f.path === "SKILL.md").length !== 1)
        throw new Error("Unique SKILL.md entry required");
    return structuredClone(value);
}
export function teachingSkillPackageProjection(candidate, metadataOnly = false) {
    const capacity = candidate.teachingSkill?.format === 2;
    const teachingSkill = parseTeachingSkillManifest(candidate.teachingSkill, capacity ? 2 : 1);
    const ids = new Set(teachingSkill.files.map(f => f.resourceId));
    const files = teachingSkill.files.map(f => {
        const r = candidate.resources.find(r => r.resourceId === f.resourceId);
        if (!r || !text(r.body, capacity ? 16384 : CONTENT_LIMITS.resourceBytes) || contentSha256(r.body) !== r.sha256
            || r.dependencies.some(dep => !ids.has(dep)))
            throw new Error("Complete teaching Skill files and dependencies required");
        return { path: f.path, resourceId: r.resourceId, revision: r.revision, sha256: r.sha256, bytes: bytes(r.body), body: r.body };
    });
    const paths = new Set(files.map(f => f.path));
    for (const file of files)
        for (const match of file.body.matchAll(/\[[^\]\r\n]*\]\(([^)\r\n]+)\)/gu)) {
            const link = match[1];
            if (/^(?:https?:|mailto:)/iu.test(link) || link.startsWith("#"))
                continue; // Citations are not package loading.
            const target = link.split("#")[0];
            if (!target || target.startsWith("/") || /[%:?\\\s]/u.test(target))
                throw new Error("Invalid teaching Skill file link");
            const parts = file.path.split("/").slice(0, -1);
            for (const part of target.split("/")) {
                if (part === ".")
                    continue;
                if (part === "..") {
                    if (!parts.length)
                        throw new Error("Teaching Skill file link escapes package");
                    parts.pop();
                }
                else
                    parts.push(part);
            }
            if (!paths.has(parts.join("/")))
                throw new Error("Teaching Skill file link missing from manifest");
        }
    if (bytes(canonical({ teachingSkill, files })) > (capacity ? 65536 : TEACHING_SKILL_LIMITS.expandedBytes))
        throw new Error("Teaching Skill package exceeds bounded size");
    return { teachingSkill, files: files.map(({ body, ...file }) => metadataOnly ? file : { ...file, body }) };
}
/** Covers manifest/path/version plus every file revision/hash/UTF-8 size; bodies are hashed individually. */
export const teachingSkillPackageSha256 = (candidate) => contentSha256(canonical(teachingSkillPackageProjection(candidate, true)));
export function validTeachingSkillResult(value, request) {
    try {
        if (!exact(value, ["contract", "releaseId", "candidateSha256", "activeVersion", "lifecycle", "checkedAt", "recheckAfterMs", "purpose", "metadataOnly", "useAllowed", "teachingSkill", "teachingSkillSha256", "files"])
            || value.contract !== CONTENT_CONTRACT || !isUuid(value.releaseId) || (request.releaseId !== null && !sameUuid(value.releaseId, request.releaseId))
            || !isContentSha256(value.candidateSha256) || !positive(value.activeVersion)
            || !["available", "retired", "invalid"].includes(String(value.lifecycle)) || typeof value.checkedAt !== "string" || !Number.isFinite(Date.parse(value.checkedAt))
            || value.recheckAfterMs !== CONTENT_LIMITS.statusWindowMs || value.purpose !== request.purpose || value.metadataOnly !== request.metadataOnly
            || value.useAllowed !== (request.purpose !== "review" && value.lifecycle !== "invalid")
            || request.purpose === "new" && value.lifecycle !== "available" || request.purpose !== "review" && value.lifecycle === "invalid")
            return false;
        const teachingSkill = parseTeachingSkillManifest(value.teachingSkill);
        if (!Array.isArray(value.files) || value.files.length !== teachingSkill.files.length)
            return false;
        const files = [];
        for (const [i, file] of value.files.entries()) {
            const ref = teachingSkill.files[i];
            if (!isContentObject(file) || !exact(file, ["path", "resourceId", "revision", "sha256", "bytes", ...(value.metadataOnly ? [] : ["body"])])
                || file.path !== ref.path || file.resourceId !== ref.resourceId || !positive(file.revision) || !isContentSha256(file.sha256)
                || !positive(file.bytes) || Number(file.bytes) > CONTENT_LIMITS.resourceBytes
                || !value.metadataOnly && (!text(file.body, CONTENT_LIMITS.resourceBytes) || bytes(file.body) !== file.bytes || contentSha256(file.body) !== file.sha256))
                return false;
            files.push({ path: ref.path, resourceId: ref.resourceId, revision: Number(file.revision), sha256: file.sha256, bytes: Number(file.bytes) });
        }
        return value.teachingSkillSha256 === contentSha256(canonical({ teachingSkill, files }))
            && (value.metadataOnly === true || bytes(canonical({ teachingSkill, files: value.files })) <= TEACHING_SKILL_LIMITS.expandedBytes);
    }
    catch {
        return false;
    }
}
export function parseContentReleaseCandidate(value) {
    const capacity = isContentObject(value) && isContentObject(value.teachingSkill) && value.teachingSkill.format === 2;
    const manifest = capacity ? parseTeachingSkillManifest(value.teachingSkill, 2) : null;
    const mandatory = new Set(manifest?.files.map(f => f.resourceId));
    if (!isContentObject(value) || !exact(value, ["releaseId", "coreContract", "contentContract", "serviceContract", "resources", "review", "tests", ...(Object.hasOwn(value, "teachingSkill") ? ["teachingSkill"] : [])])
        || !isUuid(value.releaseId) || ![value.coreContract, value.contentContract, value.serviceContract].every(v => v === CONTENT_CONTRACT)
        || !evidence(value.review) || !evidence(value.tests) || !Array.isArray(value.resources)
        || value.resources.length < 1 || value.resources.length > CONTENT_LIMITS.resources || bytes(value) > (capacity ? 262144 : CONTENT_LIMITS.candidateBytes))
        throw new Error("Invalid content release candidate");
    const ids = new Set();
    for (const r of value.resources) {
        if (!isContentObject(r) || !exact(r, ["resourceId", "revision", "sha256", "title", "applicability", "source", "license", "body", "dependencies"])
            || !id(r.resourceId) || ids.has(r.resourceId) || !positive(r.revision) || !text(r.title, 256)
            || !text(r.applicability, 512) || !text(r.source, 512) || !text(r.license, 256)
            || !text(r.body, capacity && mandatory.has(String(r.resourceId)) ? 16384 : CONTENT_LIMITS.resourceBytes) || !isContentSha256(r.sha256) || contentSha256(r.body) !== r.sha256
            || /<script\b|javascript:|data:text\/html/iu.test(r.body)
            || !Array.isArray(r.dependencies) || r.dependencies.length > CONTENT_LIMITS.dependencies
            || !r.dependencies.every(id) || new Set(r.dependencies).size !== r.dependencies.length || r.dependencies.includes(r.resourceId))
            throw new Error("Invalid content resource");
        ids.add(r.resourceId);
    }
    const candidate = value;
    const byId = new Map(candidate.resources.map(r => [r.resourceId, r]));
    const visiting = new Set();
    const visited = new Set();
    const visit = (key) => {
        if (visiting.has(key) || !byId.has(key))
            throw new Error("Invalid content dependency closure");
        if (visited.has(key))
            return;
        visiting.add(key);
        for (const dep of byId.get(key).dependencies)
            visit(dep);
        visiting.delete(key);
        visited.add(key);
    };
    for (const key of ids)
        visit(key);
    for (const key of ids) {
        const closure = new Set();
        const collect = (node) => { if (closure.has(node))
            return; closure.add(node); for (const dep of byId.get(node).dependencies)
            collect(dep); };
        collect(key);
        if (closure.size > CONTENT_LIMITS.readBatch)
            throw new Error("Content dependency closure exceeds one adopted batch");
    }
    if (Object.hasOwn(value, "teachingSkill"))
        teachingSkillPackageProjection(candidate);
    return structuredClone(candidate);
}
export function parseContentManagementCommand(value) {
    if (!isContentObject(value) || !isUuid(value.operationId) || !Number.isSafeInteger(value.expectedVersion)
        || Number(value.expectedVersion) < 0 || !text(value.reason, 512))
        throw new Error("Invalid content management command");
    if (value.action === "publish" && exact(value, ["operationId", "action", "expectedVersion", "reason", "candidate"])) {
        const candidate = parseContentReleaseCandidate(value.candidate);
        if (candidate.teachingSkill?.format === 2)
            throw new Error("Capacity candidate requires segmented management");
        return { ...value, candidate };
    }
    if (value.action === "invalidate") {
        if (!isUuid(value.releaseId) || !exact(value, ["operationId", "action", "expectedVersion", "reason", "releaseId", "resourceIds"])
            || !Array.isArray(value.resourceIds) || value.resourceIds.length < 1 || value.resourceIds.length > CONTENT_LIMITS.resources
            || !value.resourceIds.every(id) || new Set(value.resourceIds).size !== value.resourceIds.length)
            throw new Error("Invalid resource invalidation command");
        return structuredClone(value);
    }
    if (!["activate", "retire", "restore"].includes(String(value.action)) || !isUuid(value.releaseId)
        || !exact(value, ["operationId", "action", "expectedVersion", "reason", "releaseId"]))
        throw new Error("Invalid content management command");
    return structuredClone(value);
}
export function validContentToolInput(name, v) {
    if (!isContentObject(v))
        return false;
    if (name === "aidesk_content_operation_status")
        return exact(v, ["operationId"]) && isUuid(v.operationId);
    if (!isTextId(v.familyId) || !isTextId(v.learnerId) || typeof v.coreContract !== "string" || !text(v.coreContract, 64))
        return false;
    const scope = ["familyId", "learnerId", "coreContract"];
    if (name === "aidesk_load_teaching_skill")
        return exact(v, [...scope, "releaseId", "runId", "purpose", "metadataOnly"])
            && (v.releaseId === null && v.purpose === "new" || isUuid(v.releaseId)) && isUuid(v.runId)
            && ["new", "continue", "review"].includes(String(v.purpose)) && typeof v.metadataOnly === "boolean";
    if (name === "aidesk_read_content_catalog")
        return exact(v, [...scope, "releaseId", "cursor", "limit"])
            && (v.releaseId === null || isUuid(v.releaseId)) && (v.cursor === null || id(v.cursor)) && positive(v.limit) && v.limit <= CONTENT_LIMITS.catalogPage;
    if (name === "aidesk_read_content")
        return exact(v, [...scope, "releaseId", "resourceIds", "purpose", "runId", "metadataOnly"])
            && isUuid(v.releaseId) && isUuid(v.runId) && ["new", "continue", "review"].includes(String(v.purpose)) && typeof v.metadataOnly === "boolean"
            && Array.isArray(v.resourceIds) && v.resourceIds.length > 0 && v.resourceIds.length <= CONTENT_LIMITS.readBatch
            && v.resourceIds.every(id) && new Set(v.resourceIds).size === v.resourceIds.length;
    if (name === "aidesk_record_content_adoption")
        return exact(v, [...scope, "operationId", "runId", "releaseId", "resources", "outputText", ...(Object.hasOwn(v, "teachingSkillSha256") ? ["teachingSkillSha256"] : [])])
            && (!Object.hasOwn(v, "teachingSkillSha256") || isContentSha256(v.teachingSkillSha256))
            && isUuid(v.operationId) && isUuid(v.runId) && isUuid(v.releaseId) && text(v.outputText, 2048)
            && Array.isArray(v.resources) && v.resources.length > 0 && v.resources.length <= CONTENT_LIMITS.readBatch
            && v.resources.every(r => isContentObject(r) && exact(r, ["resourceId", "revision", "sha256"]) && id(r.resourceId) && positive(r.revision) && isContentSha256(r.sha256))
            && new Set(v.resources.map(r => r.resourceId)).size === v.resources.length;
    return false;
}
/** Validate received transport evidence. Authorization remains in SQL. */
export function validContentResult(name, value, request) {
    if (name === "aidesk_load_teaching_skill")
        return validTeachingSkillResult(value, request);
    const timestamp = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
    const refs = (v) => Array.isArray(v) && v.length > 0 && v.length <= CONTENT_LIMITS.readBatch
        && v.every(r => isContentObject(r) && id(r.resourceId) && positive(r.revision) && isContentSha256(r.sha256))
        && new Set(v.map(r => r.resourceId)).size === v.length;
    if (name === "aidesk_content_operation_status" || name === "aidesk_record_content_adoption") {
        if (!sameUuid(value.operationId, request.operationId) || Object.hasOwn(value, "teachingSkillSha256") && !isContentSha256(value.teachingSkillSha256))
            return false;
        if (name === "aidesk_content_operation_status" && value.status === "not_found")
            return exact(value, ["operationId", "status"]);
        if (value.status !== "completed" || !isUuid(value.runId) || !isUuid(value.releaseId) || !refs(value.resources)
            || !isContentSha256(value.outputSha256) || !timestamp(value.recordedAt))
            return false;
        return name === "aidesk_content_operation_status" || (sameUuid(value.runId, request.runId) && sameUuid(value.releaseId, request.releaseId)
            && value.teachingSkillSha256 === request.teachingSkillSha256
            && canonical(value.resources) === canonical(request.resources) && value.outputSha256 === contentSha256(String(request.outputText)));
    }
    if (value.contract !== CONTENT_CONTRACT || !isUuid(value.releaseId) || !isContentSha256(value.candidateSha256)
        || !positive(value.activeVersion) || !["available", "retired", "invalid"].includes(String(value.lifecycle))
        || !timestamp(value.checkedAt) || value.recheckAfterMs !== CONTENT_LIMITS.statusWindowMs || !Array.isArray(value.resources))
        return false;
    if (request.releaseId !== null && !sameUuid(value.releaseId, request.releaseId))
        return false;
    if (name === "aidesk_read_content_catalog") {
        if (value.lifecycle !== "available" || value.resources.length > Number(request.limit)
            || !(value.nextCursor === null || id(value.nextCursor)))
            return false;
    }
    else if (value.purpose !== request.purpose || value.metadataOnly !== request.metadataOnly
        || value.useAllowed !== (request.purpose !== "review" && value.lifecycle !== "invalid")
        || value.resources.length !== request.resourceIds.length)
        return false;
    const seen = new Set();
    for (const r of value.resources) {
        if (!isContentObject(r) || !id(r.resourceId) || seen.has(r.resourceId) || !positive(r.revision) || !isContentSha256(r.sha256)
            || !text(r.title, 256) || !text(r.applicability, 512) || !text(r.source, 512) || !text(r.license, 256)
            || !Array.isArray(r.dependencies) || r.dependencies.length > CONTENT_LIMITS.dependencies || !r.dependencies.every(id))
            return false;
        seen.add(r.resourceId);
        if (name === "aidesk_read_content" && !request.resourceIds.includes(r.resourceId))
            return false;
        if (name === "aidesk_read_content" && request.metadataOnly === false) {
            if (!text(r.body, CONTENT_LIMITS.resourceBytes) || contentSha256(r.body) !== r.sha256)
                return false;
        }
        else if ("body" in r)
            return false;
    }
    return true;
}
const uuid = { type: "string", format: "uuid" };
const scopeSchema = { familyId: { type: "string", minLength: 1, maxLength: 256 }, learnerId: { type: "string", minLength: 1, maxLength: 256 },
    coreContract: { type: "string", maxLength: 64, description: `本核心支持的内容合同：${CONTENT_CONTRACT}；兼容声明不授予权限。` } };
const resourceId = { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" };
const hashSchema = { type: "string", pattern: "^[a-f0-9]{64}$" };
const input = (properties, optional = []) => ({ type: "object", properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false });
const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const contentToolDescriptors = [{ name: "aidesk_load_teaching_skill", title: "完整加载AI书桌服务器教学Skill包",
        description: "教学前读完当前活动兼容Skill清单全文件，按SKILL.md工作。首读new/releaseId=null；metadataOnly仅复核非正文。continue/review须本人同run整包采用；缺失/失效/不兼容/不全则停止。",
        inputSchema: input({ ...scopeSchema, releaseId: { anyOf: [uuid, { type: "null" }] }, runId: uuid, purpose: { type: "string", enum: ["new", "continue", "review"] }, metadataOnly: { type: "boolean" } }), annotations: readAnnotations }, { name: "aidesk_read_content_catalog", title: "读取AI书桌版本化内容目录",
        description: "本人当前学习者权限内取有界目录；首读releaseId/cursor=null，续页固定releaseId；不证明绑定或采用。",
        inputSchema: input({ ...scopeSchema, releaseId: { anyOf: [uuid, { type: "null" }] }, cursor: { anyOf: [resourceId, { type: "null" }] }, limit: { type: "integer", minimum: 1, maximum: 8 } }), annotations: readAnnotations },
    { name: "aidesk_read_content", title: "读取或核验AI书桌内容",
        description: "按目录固定发布/资源读完必要依赖。metadataOnly=true核当前权限/状态/摘要，非正文。new首次；continue/review须本人原run采用。review仅历史复核，不重用失效内容；每30秒及采用前复核。",
        inputSchema: input({ ...scopeSchema, releaseId: uuid, resourceIds: { type: "array", items: resourceId, minItems: 1, maxItems: 4, uniqueItems: true }, purpose: { type: "string", enum: ["new", "continue", "review"] }, runId: uuid, metadataOnly: { type: "boolean" } }), annotations: readAnnotations },
    { name: "aidesk_record_content_adoption", title: "记录AI书桌合成内容采用依据",
        description: "仅01合成验证：稳定operationId记录本人run实际采用的准确版本/资源及输出摘要；服务重核权限/状态。回执只证明记录，非正确采用/学习效果；未知沿原号查，禁换号重试。",
        inputSchema: input({ ...scopeSchema, operationId: uuid, runId: uuid, releaseId: uuid,
            resources: { type: "array", minItems: 1, maxItems: 4, items: input({ resourceId, revision: { type: "integer", minimum: 1 }, sha256: hashSchema }) },
            outputText: { type: "string", minLength: 1, maxLength: 2048, description: "实际合成输出，UTF-8不超过2048字节；服务计算摘要。" },
            teachingSkillSha256: { ...hashSchema, description: "使用完整教学Skill包时必填其返回摘要；服务核本run整包处理回执与全部文件，resources仅为实际引用子集。" } }, ["teachingSkillSha256"]), annotations: { ...readAnnotations, readOnlyHint: false } },
    { name: "aidesk_content_operation_status", title: "查询AI书桌本人内容采用回执",
        description: "只查本人内容采用原号，重核当前账号/学习者记录权限；无记录不准换号；不读他人或维护发布记录。",
        inputSchema: input({ operationId: uuid }), annotations: readAnnotations }];
