// Generated from services/authority-api/src/plugin-update.ts; source SHA-256 88db900102ebbb0ccc6d10120cd7b31d53b54e78c197569cd18381d96f222c92.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
/** Public package compatibility information only; never an account authorization decision. */
export const PLUGIN_RELEASE_SOURCE = "https://raw.githubusercontent.com/aideskx/aidesk/main/release.json";
function version(value) {
    if (typeof value !== "string" || value.length > 128)
        return;
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+codex\.(\d{14}))?$/u.exec(value);
    if (!match)
        return;
    const build = match[4] ?? null;
    if (build !== null) {
        const iso = `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6, 8)}T${build.slice(8, 10)}:${build.slice(10, 12)}:${build.slice(12, 14)}.000Z`;
        const date = new Date(iso);
        if (!Number.isFinite(date.getTime()) || date.toISOString() !== iso)
            return;
    }
    return { core: [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])], build };
}
/** Codex cachebuster dates order builds of the same core; unfamiliar versions are not guessed. */
export function comparePluginVersions(left, right) {
    const a = version(left);
    const b = version(right);
    if (!a || !b)
        return;
    for (const index of [0, 1, 2]) {
        if (a.core[index] < b.core[index])
            return -1;
        if (a.core[index] > b.core[index])
            return 1;
    }
    if (a.build === b.build)
        return 0;
    if (a.build === null)
        return -1;
    if (b.build === null)
        return 1;
    return a.build < b.build ? -1 : 1;
}
/** Strict release contract. Error text intentionally excludes untrusted response content. */
export function parsePluginRelease(value, now = Date.now()) {
    const invalid = () => { throw new Error("Invalid public plugin release"); };
    if (!value || typeof value !== "object" || Array.isArray(value))
        return invalid();
    const item = value;
    const fields = ["schemaVersion", "plugin", "repository", "channel", "latestVersion", "minimumSupportedVersion", "packageDigest", "publishedAt", "notes"];
    if (Reflect.ownKeys(item).length !== fields.length || fields.some(key => !Object.hasOwn(item, key))
        || item.schemaVersion !== 1 || item.plugin !== "aidesk-runtime" || item.repository !== "aideskx/aidesk" || item.channel !== "stable"
        || typeof item.latestVersion !== "string" || typeof item.minimumSupportedVersion !== "string"
        || !version(item.latestVersion) || !version(item.minimumSupportedVersion)
        || comparePluginVersions(item.minimumSupportedVersion, item.latestVersion) === 1
        || typeof item.packageDigest !== "string" || !/^[a-fA-F0-9]{64}$/u.test(item.packageDigest)
        || typeof item.notes !== "string" || item.notes.length > 500
        || typeof item.publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(item.publishedAt))
        return invalid();
    const published = new Date(item.publishedAt);
    const canonical = item.publishedAt.includes(".") ? item.publishedAt : item.publishedAt.replace("Z", ".000Z");
    if (!Number.isFinite(now) || !Number.isFinite(published.getTime()) || published.toISOString() !== canonical
        || published.getTime() > now + 5 * 60_000)
        return invalid();
    return {
        schemaVersion: 1, plugin: "aidesk-runtime", repository: "aideskx/aidesk", channel: "stable",
        latestVersion: item.latestVersion, minimumSupportedVersion: item.minimumSupportedVersion,
        packageDigest: item.packageDigest, publishedAt: item.publishedAt, notes: item.notes,
    };
}
class InvalidReleaseResponse extends Error {
}
class RetryableReleaseResponse extends Error {
    retryAfterMs;
    constructor(retryAfterMs = 0) {
        super("Public plugin release temporarily unavailable");
        this.retryAfterMs = retryAfterMs;
    }
}
function retryAfter(response, now) {
    const value = response.headers.get("retry-after");
    if (value === null)
        return 0;
    if (/^\d+$/u.test(value))
        return Number(value) * 1_000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}
async function pause(ms, signal) {
    let timer;
    try {
        await bounded(new Promise(resolve => { timer = setTimeout(resolve, ms); }), signal);
    }
    finally {
        clearTimeout(timer);
    }
}
function bounded(work, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(new Error("Public plugin release request timed out"));
        signal.addEventListener("abort", abort, { once: true });
        work.then(value => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted)
                abort();
            else
                resolve(value);
        }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
        if (signal.aborted)
            abort();
    });
}
/**
 * Lazy, process-local shared cache: no background polling, identity, credentials or persistent state.
 * At most two attempts, 250 ms minimum backoff; Retry-After must fit the remaining total budget.
 * Transport/timeout, HTTP 408/429, rate-limited 403 and 5xx failures may retry. Source, redirect,
 * size, UTF-8, JSON and release-contract violations never retry. Failure discards expired metadata
 * and remains unavailable (not current or update_required); account/usage authorization is separate.
 */
export function createPluginUpdateChecker(options = {}) {
    const fetchRelease = options.fetch ?? globalThis.fetch;
    const now = options.now ?? Date.now;
    const timeoutMs = options.timeoutMs ?? 3_000;
    const totalTimeoutMs = options.totalTimeoutMs ?? 6_500;
    const ttlMs = options.ttlMs ?? 5 * 60_000;
    const failureTtlMs = options.failureTtlMs ?? 30_000;
    for (const [duration, max] of [[timeoutMs, 5_000], [totalTimeoutMs, 10_000], [ttlMs, 3_600_000], [failureTtlMs, 300_000]]) {
        if (!Number.isSafeInteger(duration) || duration < 1 || duration > max)
            throw new Error("Invalid plugin update cache configuration");
    }
    let cached;
    let pending;
    async function attempt(signal) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted)
            abort();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            const request = Promise.resolve().then(() => {
                controller.signal.throwIfAborted();
                return fetchRelease(PLUGIN_RELEASE_SOURCE, {
                    method: "GET", redirect: "manual", credentials: "omit", signal: controller.signal,
                    headers: { accept: "application/json" },
                });
            }).then(value => {
                if (controller.signal.aborted) {
                    void value.body?.cancel().catch(() => { });
                    controller.signal.throwIfAborted();
                }
                return value;
            });
            response = await bounded(request, controller.signal);
            // GitHub's fixed raw JSON endpoint serves text/plain; both types still require strict JSON/schema validation.
            const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
            if (response.redirected || response.url && response.url !== PLUGIN_RELEASE_SOURCE)
                throw new InvalidReleaseResponse("Invalid release source");
            if (response.status === 408 || response.status === 429 || response.status >= 500 && response.status <= 599
                || response.status === 403 && (response.headers.has("retry-after") || response.headers.get("x-ratelimit-remaining") === "0")) {
                throw new RetryableReleaseResponse(retryAfter(response, now()));
            }
            if (response.status !== 200 || !["application/json", "text/plain"].includes(contentType ?? "") || !response.body) {
                throw new InvalidReleaseResponse("Invalid release response");
            }
            const length = response.headers.get("content-length");
            if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 16_384))
                throw new InvalidReleaseResponse("Invalid release size");
            const reader = response.body.getReader();
            const parts = [];
            let size = 0;
            try {
                for (;;) {
                    const part = await bounded(reader.read(), controller.signal);
                    if (part.done)
                        break;
                    size += part.value.byteLength;
                    if (size > 16_384)
                        throw new InvalidReleaseResponse("Invalid release size");
                    parts.push(part.value);
                }
            }
            finally {
                void reader.cancel().catch(() => { });
                reader.releaseLock();
            }
            controller.signal.throwIfAborted();
            const checkedAt = now();
            try {
                const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, size)));
                return { checkedAt, release: parsePluginRelease(data, checkedAt) };
            }
            catch {
                throw new InvalidReleaseResponse("Invalid public plugin release");
            }
        }
        finally {
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            controller.abort();
            if (response?.body && !response.body.locked)
                void response.body.cancel().catch(() => { });
        }
    }
    async function read() {
        const controller = new AbortController();
        // Monotonic time: wall-clock changes affect metadata timestamps, never extend a request budget.
        const deadline = performance.now() + totalTimeoutMs;
        const timer = setTimeout(() => controller.abort(), totalTimeoutMs);
        try {
            for (let index = 0; index < 2; index++) {
                try {
                    const result = await attempt(controller.signal);
                    if (!controller.signal.aborted && performance.now() < deadline)
                        return result;
                    break;
                }
                catch (error) {
                    if (error instanceof InvalidReleaseResponse || index === 1 || controller.signal.aborted)
                        break;
                    const delay = Math.max(250, error instanceof RetryableReleaseResponse ? error.retryAfterMs : 0);
                    if (delay >= deadline - performance.now())
                        break;
                    await pause(delay, controller.signal);
                    if (controller.signal.aborted || performance.now() >= deadline)
                        break;
                }
            }
        }
        catch {
            // Total deadline can expire during backoff. Never expose upstream errors or stale metadata.
        }
        finally {
            clearTimeout(timer);
            controller.abort();
        }
        return { checkedAt: now() };
    }
    async function latest() {
        const current = now();
        if (cached && current >= cached.checkedAt && current < cached.checkedAt + (cached.release ? ttlMs : failureTtlMs))
            return cached;
        if (!pending) {
            pending = read().then(result => { cached = result; return result; }).finally(() => { pending = undefined; });
        }
        return pending;
    }
    return {
        async check(installedVersion) {
            if (!version(installedVersion))
                return { status: "unknown", installedVersion: null, checkedAt: null };
            const installed = installedVersion;
            const result = await latest();
            const checkedAt = new Date(result.checkedAt).toISOString();
            if (!result.release)
                return { status: "unavailable", installedVersion: installed, checkedAt };
            const release = result.release;
            const status = comparePluginVersions(installed, release.minimumSupportedVersion) === -1 ? "update_required"
                : comparePluginVersions(installed, release.latestVersion) === -1 ? "update_available"
                    : comparePluginVersions(installed, release.latestVersion) === 1 ? "ahead" : "current";
            return {
                status, installedVersion: installed, checkedAt, latestVersion: release.latestVersion,
                minimumSupportedVersion: release.minimumSupportedVersion, notes: release.notes,
                packageDigest: release.packageDigest, publishedAt: release.publishedAt, source: PLUGIN_RELEASE_SOURCE,
            };
        },
    };
}
