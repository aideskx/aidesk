// Generated from tooling/s1-plugin-candidate-contract.ts; source SHA-256 0a829c425211931e45c5c883a385b559cebecceab455ae7955424e016f3b3b78.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
/// <reference types="node" />
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
export const S1_PLUGIN_ROOT = "plugins/aidesk-runtime";
export const S1_VERSION = "0.1.1";
// Historical release identity, not a whitelist or capability contract for later versions.
export const S1_PACKAGE_DIGEST = "5923b7a6b3280e4138822346c433d58140e5540b035b74e804b6e571c6cd0b5c";
export class PluginPackageValidationError extends Error {
    errors;
    constructor(errors) {
        super(`Plugin package is invalid:\n- ${errors.join("\n- ")}`);
        this.errors = errors;
        this.name = "PluginPackageValidationError";
    }
}
const SENSITIVE_PATTERNS = [
    {
        label: "private-key material",
        pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE\s+KEY-----/u,
    },
    {
        label: "high-confidence token",
        pattern: /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})\b/u,
    },
    {
        label: "credential assignment",
        pattern: /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|credential)\b["']?\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{8,}/iu,
    },
];
const LOCAL_ONLY_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.git|node_modules|logs)(?:\/|$)|\.(?:pem|key|p12|pfx|token|tokens|credentials|log)$/iu;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
function fail(errors) {
    throw new PluginPackageValidationError(errors);
}
function sha256(content) {
    return createHash("sha256").update(content).digest("hex");
}
function comparePaths(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
/** Stable across checkout roots and non-executable platform permissions. */
export function computePluginPackageDigest(files) {
    const normalized = files
        .map(({ path, gitMode, sha256 }) => ({ path, gitMode, sha256 }))
        .sort((left, right) => comparePaths(left.path, right.path));
    return sha256(JSON.stringify(normalized));
}
function asObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : undefined;
}
function validateRoot(root) {
    if (!isAbsolute(root) || resolve(root) !== root) {
        fail(["plugin root must be an absolute normalized path"]);
    }
    try {
        if (lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) {
            fail(["plugin root must be a regular directory"]);
        }
        if (realpathSync(root) !== root) {
            fail(["plugin root and ancestors must not use symbolic links"]);
        }
    }
    catch (error) {
        if (error instanceof PluginPackageValidationError)
            throw error;
        fail(["plugin root must exist and be readable"]);
    }
}
function validateDeclaredPath(root, value, field, directories, contents, errors) {
    if (typeof value !== "string") {
        errors.push(`manifest.${field} must be a package-relative path`);
        return undefined;
    }
    const path = value.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (path === "" || isAbsolute(path) || /^[A-Za-z]:/u.test(path) || path.includes("\\") ||
        path.includes("\0") || path.split("/").some((part) => part === "" || part === "." || part === "..") ||
        relative(root, resolve(root, path)).split(sep).join("/") !== path) {
        errors.push(`manifest.${field} must stay inside the package`);
        return undefined;
    }
    if (!(field === "skills" ? directories.has(path) : contents.has(path))) {
        errors.push(`manifest.${field} references a missing package ${field === "skills" ? "directory" : "file"}`);
        return undefined;
    }
    return path;
}
/** Local integrity checks only; this does not install a Plugin or prove host behavior. */
export function validatePluginPackage(root, options = {}) {
    validateRoot(root);
    const errors = [];
    const files = [];
    const contents = new Map();
    const directories = new Set();
    function walk(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const absolutePath = join(directory, entry.name);
            const path = relative(root, absolutePath).split(sep).join("/");
            const stats = lstatSync(absolutePath);
            if (stats.isSymbolicLink()) {
                errors.push(`${path}: symbolic links are forbidden`);
                continue;
            }
            if (LOCAL_ONLY_PATH.test(path)) {
                errors.push(`${path}: local-only or sensitive material must not be packaged`);
                continue;
            }
            if (stats.isDirectory()) {
                directories.add(path);
                walk(absolutePath);
                continue;
            }
            if (!stats.isFile()) {
                errors.push(`${path}: special filesystem entries are forbidden`);
                continue;
            }
            const content = readFileSync(absolutePath);
            contents.set(path, content);
            files.push({ path, gitMode: (stats.mode & 0o111) === 0 ? "100644" : "100755", sha256: sha256(content) });
            for (const { label, pattern } of SENSITIVE_PATTERNS) {
                if (pattern.test(content.toString("utf8")))
                    errors.push(`${path}: contains ${label}`);
            }
        }
    }
    walk(root);
    let manifest;
    try {
        manifest = asObject(JSON.parse(contents.get(".codex-plugin/plugin.json")?.toString("utf8") ?? ""));
    }
    catch {
        errors.push(".codex-plugin/plugin.json must contain valid JSON");
    }
    if (manifest === undefined)
        fail([...errors, "plugin manifest must be an object"]);
    if (manifest.name !== "aidesk-runtime")
        errors.push("manifest.name must equal aidesk-runtime");
    const version = manifest.version;
    if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
        fail([...errors, "manifest.version must be a three-part numeric version with optional build metadata"]);
    }
    if (options.expectedVersion !== undefined && version !== options.expectedVersion) {
        errors.push(`manifest.version must equal ${options.expectedVersion}`);
    }
    const skillPath = validateDeclaredPath(root, manifest.skills, "skills", directories, contents, errors);
    // A future release may declare MCP connections; only local file references are checked here.
    if (typeof manifest.mcpServers === "string") {
        validateDeclaredPath(root, manifest.mcpServers, "mcpServers", directories, contents, errors);
    }
    const skillFiles = [...contents.entries()].filter(([path]) => skillPath !== undefined && path.startsWith(`${skillPath}/`) && path.endsWith("/SKILL.md"));
    if (skillPath !== undefined && skillFiles.length === 0)
        errors.push("manifest.skills must contain a SKILL.md");
    for (const [path, content] of skillFiles) {
        const text = content.toString("utf8");
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
        if (frontmatter === undefined || !/^name:\s*\S.+$/mu.test(frontmatter) || !/^description:\s*\S.+$/mu.test(frontmatter)) {
            errors.push(`${path}: Skill frontmatter must include name and description`);
        }
        // If a Skill shows a release marker, it must agree with the package version.
        for (const match of text.matchAll(/\bV\d+\s*\/\s*(\d+\.\d+\.\d+)\b/gu)) {
            if (match[1] !== version.split("+")[0])
                errors.push(`${path}: release marker must agree with manifest.version`);
        }
    }
    files.sort((left, right) => comparePaths(left.path, right.path));
    const packageDigest = computePluginPackageDigest(files);
    if (version === S1_VERSION && packageDigest !== S1_PACKAGE_DIGEST) {
        errors.push("published S1 0.1.1 content must retain its recorded package digest; changes require a new version");
    }
    if (errors.length > 0)
        fail(errors);
    return { root, version, files, packageDigest };
}
/**
 * Release-time gate layered on top of the reusable package contract.
 * The base contract intentionally permits future versions and MCP declarations;
 * this gate binds one candidate to the operator-approved release metadata.
 */
export function validatePluginReleaseCandidate(root, options) {
    const result = validatePluginPackage(root, { expectedVersion: options.expectedVersion });
    const errors = [];
    if (options.expectedDigest !== undefined && result.packageDigest !== options.expectedDigest) {
        errors.push(`packageDigest must equal ${options.expectedDigest}`);
    }
    if (options.expectedMcpUrl !== undefined || options.requirePluginVersionHeader === true) {
        const mcpPath = join(root, ".mcp.json");
        let parsed;
        try {
            parsed = asObject(JSON.parse(readFileSync(mcpPath, "utf8")));
        }
        catch {
            errors.push(".mcp.json must contain valid JSON for the release gate");
        }
        const servers = parsed === undefined ? undefined : asObject(parsed.mcpServers);
        const authority = servers === undefined ? undefined : asObject(servers["aidesk-authority"]);
        if (options.expectedMcpUrl !== undefined && authority?.url !== options.expectedMcpUrl) {
            errors.push(`mcpServers.aidesk-authority.url must equal ${options.expectedMcpUrl}`);
        }
        if (options.requirePluginVersionHeader === true) {
            const manifest = asObject(JSON.parse(readFileSync(join(root, ".codex-plugin/plugin.json"), "utf8")));
            const headers = asObject(authority?.http_headers);
            const versionHeaders = Object.entries(headers ?? {}).filter(([name]) => name.toLowerCase() === "x-aidesk-plugin-version");
            if (manifest?.mcpServers !== "./.mcp.json" && manifest?.mcpServers !== ".mcp.json") {
                errors.push("versioned release must declare .mcp.json as manifest.mcpServers");
            }
            if (versionHeaders.length !== 1 || headers?.["X-Aidesk-Plugin-Version"] !== result.version) {
                errors.push("mcpServers.aidesk-authority.http_headers must contain one X-Aidesk-Plugin-Version equal to manifest.version");
            }
        }
    }
    if (errors.length > 0)
        fail(errors);
    return result;
}
