// Generated from services/authority-api/src/goal-network-contract.ts; source SHA-256 5e687119a215c3f0b570c8baf37a5712918aca1ca3c58b9bb08afb7ce3822a6e.
// Run node tooling/build-plugin-runtime.mjs; do not edit this copy.
import { isTimestamp, isUuid } from "./domain-inputs.mjs";
import { canonicalTeachingJson, parseTeachingJson, teachingObject, teachingRequestSha256 } from "./teaching-business-contract.mjs";
import { GOAL_NETWORK_SCOPE_PURPOSE } from "./goal-network-scope-contract.mjs";
/** Synthetic cohort implementation contract, not public sharing/retention terms.
 * Content is selected reference data, never Plugin rules or a private-goal dump. */
export const GOAL_NETWORK_CONTRACT = "aidesk-goal-network-v1";
export const GOAL_NETWORK_USAGE = "synthetic-test-reuse-v1";
export const GOAL_NETWORK_LIMITS = Object.freeze({ requestBytes: 12288, transportBytes: 32768, minBudget: 1024, maxBudget: 24576, queryBytes: 128 });
export class GoalNetworkError extends Error {
    kind;
    operationId;
    constructor(kind, operationId) {
        super(({ goal_deleted: "该目标内容已删除，不能重放写入；保留原号核对旧操作。", invalid_input: "协作网络请求无效。", payload_too_large: "分享内容超过本次大小限制。", scope_denied: "当前账号无权访问此分享范围。",
            feature_unavailable: "当前没有新增书桌服务权益。", version_conflict: "分享内容或本人目标已变更。", idempotency_conflict: "原操作号对应的内容不一致。",
            budget_too_small: "读取预算不足以容纳此记录。", unavailable: "暂时无法读取协作网络。", outcome_unknown: "操作结果尚不确定，请沿原号对账。",
            cancelled: "读取或尚未发送的请求已取消。" })[kind]);
        this.kind = kind;
        this.operationId = operationId;
        this.name = "GoalNetworkError";
    }
}
const exact = (v, keys) => teachingObject(v)
    && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const uuid = (v) => isUuid(v) && v === v.toLowerCase();
const hash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const integer = (v, min = 1, max = 2147483647) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const text = (v, max) => typeof v === "string" && v.isWellFormed() && v.trim().length > 0
    && !/[\p{Cc}]/u.test(v) && Buffer.byteLength(v) <= max;
// Validate a same-byte-length copy only. The original body, content hash and
// operation digest retain every CR/LF/TAB; titles and private goal text stay strict.
const bodyText = (v, max) => typeof v === "string" && text(v.replace(/[\r\n\t]/gu, " "), max);
const goal = (v) => exact(v, ["goalId", "version"]) && uuid(v.goalId) && integer(v.version);
const prefix = ["contract", "action"];
const source = [...prefix, "operationId", "cohortId", "postId", "version"];
const scoped = (v) => uuid(v.cohortId) && uuid(v.postId) && uuid(v.operationId);
const historyCursor = (v) => exact(v, ["cohortId", "id"]) && uuid(v.cohortId) && uuid(v.id);
const historyKey = (v) => `${v.cohortId}/${v.id}`;
const budget = (v) => integer(v, GOAL_NETWORK_LIMITS.minBudget, GOAL_NETWORK_LIMITS.maxBudget);
export const goalNetworkIsWrite = (action, input) => action !== "operation" && action !== "discover" && !(action === "read" && input.view === "adoption");
export function parseGoalNetworkInput(action, value) {
    let v;
    try {
        const wire = typeof value === "string" ? value : canonicalTeachingJson(value);
        if (Buffer.byteLength(wire) > GOAL_NETWORK_LIMITS.requestBytes)
            throw new GoalNetworkError("payload_too_large");
        v = parseTeachingJson(wire, GOAL_NETWORK_LIMITS.requestBytes);
    }
    catch (e) {
        throw e instanceof GoalNetworkError ? e : new GoalNetworkError("invalid_input");
    }
    let valid = false;
    if (teachingObject(v) && v.contract === GOAL_NETWORK_CONTRACT && v.action === action) {
        if (action === "publish")
            valid = exact(v, [...prefix, "operationId", "cohortId", "postId", "expectedVersion", "title", "text", "usage"])
                && scoped(v) && integer(v.expectedVersion, 0, 2147483646) && text(v.title, 256) && bodyText(v.text, 8192) && v.usage === GOAL_NETWORK_USAGE;
        if (action === "discover")
            valid = (v.view === "own_posts" || v.view === "own_responses"
                ? exact(v, [...prefix, "view", "after", "limit", "budgetBytes"]) && (v.after === null || historyCursor(v.after))
                : (v.view === "scopes" ? exact(v, [...prefix, "view", "afterId", "limit", "budgetBytes", ...(Object.hasOwn(v, "purpose") ? ["purpose"] : [])])
                    && (!Object.hasOwn(v, "purpose") || v.purpose === GOAL_NETWORK_SCOPE_PURPOSE)
                    : exact(v, [...prefix, "cohortId", "view", "postId", "afterId", "limit", "budgetBytes", ...(Object.hasOwn(v, "query") ? ["query"] : [])])
                        && (!Object.hasOwn(v, "query") || text(v.query, GOAL_NETWORK_LIMITS.queryBytes))
                        && uuid(v.cohortId) && (v.view === "posts" && v.postId === null || v.view === "responses" && uuid(v.postId)))
                    && (v.afterId === null || uuid(v.afterId))) && integer(v.limit, 1, 16) && budget(v.budgetBytes);
        if (action === "read")
            valid = v.view === "adoption"
                ? exact(v, [...prefix, "view", "adoptionId", "budgetBytes"]) && uuid(v.adoptionId) && budget(v.budgetBytes)
                : exact(v, [...source, "view", "responseId", "budgetBytes"]) && scoped(v) && integer(v.version) && budget(v.budgetBytes)
                    && (v.view === "post" && v.responseId === null || v.view === "response" && uuid(v.responseId));
        if (action === "adopt")
            valid = exact(v, [...source, "adoptionId", "goalRef"]) && scoped(v) && integer(v.version) && uuid(v.adoptionId) && goal(v.goalRef);
        if (action === "respond")
            valid = exact(v, [...source, "responseId", "text"]) && scoped(v) && integer(v.version) && uuid(v.responseId) && bodyText(v.text, 2048);
        if (action === "withdraw")
            valid = exact(v, [...source, "target", "responseId"]) && scoped(v) && integer(v.version)
                && (v.target === "post" && v.responseId === null || v.target === "response" && uuid(v.responseId));
        if (action === "operation")
            valid = exact(v, [...prefix, "operationId", "requestSha256"]) && uuid(v.operationId) && hash(v.requestSha256);
    }
    if (!valid)
        throw new GoalNetworkError("invalid_input");
    return v;
}
/** A projection only: its digest is NOT the full request digest. The ledger's
 * request_sha256 binds the original action + actual user input, including text. */
export function goalNetworkMetadata(input) {
    const meta = { ...input };
    if (input.action === "publish") {
        delete meta.title;
        delete meta.text;
        meta.contentSha256 = teachingRequestSha256({ title: input.title, text: input.text, usage: input.usage });
    }
    else if (input.action === "respond") {
        delete meta.text;
        meta.contentSha256 = teachingRequestSha256({ text: input.text });
    }
    return meta;
}
function metadata(v) {
    if (!teachingObject(v))
        return false;
    const candidate = { ...v };
    if (v.action === "publish" || v.action === "respond") {
        if (!hash(v.contentSha256) || Object.hasOwn(v, "text") || v.action === "publish" && Object.hasOwn(v, "title"))
            return false;
        delete candidate.contentSha256;
        candidate.text = "synthetic";
        if (v.action === "publish")
            candidate.title = "synthetic";
    }
    try {
        parseGoalNetworkInput(v.action, candidate);
        return !["operation", "discover"].includes(String(v.action));
    }
    catch {
        return false;
    }
}
function receipt(v, operationId, digest) {
    if (!(exact(v, [...prefix, "status", "operationId", "requestSha256", "requestRepresentation", "request", "recordedAt", "entitlement", "entityId"])
        && v.contract === GOAL_NETWORK_CONTRACT && v.status === "recorded" && v.operationId === operationId && v.requestSha256 === digest
        && v.requestRepresentation === "metadata_only" && metadata(v.request) && v.action === v.request.action
        && v.request.operationId === operationId && uuid(v.entityId) && isTimestamp(v.recordedAt)))
        return false;
    const request = v.request;
    const entityId = request.action === "publish" || request.action === "read" && request.view === "post" || request.action === "withdraw" && request.target === "post"
        ? request.postId : request.action === "adopt" ? request.adoptionId : request.responseId;
    if (v.entityId !== entityId)
        return false;
    if (v.entitlement === null)
        return v.action === "withdraw";
    const a = v.entitlement;
    return exact(a, ["state", "checkedAt", "startsAt", "expiresAt"]) && (a.state === "active" || a.state === "annual")
        && isTimestamp(a.checkedAt) && a.checkedAt === v.recordedAt && isTimestamp(a.startsAt) && isTimestamp(a.expiresAt)
        && Date.parse(a.startsAt) <= Date.parse(a.checkedAt) && Date.parse(a.checkedAt) < Date.parse(a.expiresAt);
}
function item(v) {
    if (!(exact(v, ["kind", "id", "cohortId", "postId", "version", "authorId", "title", "text", "contentSha256", "usage", "createdAt", "sourceStatus", "goalRef"])
        && ["post", "response", "adoption"].includes(String(v.kind)) && uuid(v.id) && uuid(v.cohortId) && uuid(v.postId) && integer(v.version)
        && uuid(v.authorId) && bodyText(v.text, v.kind === "response" ? 2048 : 8192) && hash(v.contentSha256) && v.usage === GOAL_NETWORK_USAGE
        && isTimestamp(v.createdAt) && ["available", "withdrawn", "unavailable"].includes(String(v.sourceStatus))))
        return false;
    if (v.kind === "response")
        return v.title === null && v.goalRef === null && v.contentSha256 === teachingRequestSha256({ text: v.text });
    return text(v.title, 256) && (v.kind === "adoption" ? goal(v.goalRef) : v.goalRef === null && v.id === v.postId)
        && v.contentSha256 === teachingRequestSha256({ title: v.title, text: v.text, usage: v.usage });
}
export function validGoalNetworkResult(action, v, input) {
    if (!teachingObject(v) || v.contract !== GOAL_NETWORK_CONTRACT)
        return false;
    if (action === "operation") {
        const p = input;
        return v.operationId === p.operationId && v.requestSha256 === p.requestSha256
            && (exact(v, ["contract", "status", "terminal", "operationId", "requestSha256"]) && v.status === "not_found" && v.terminal === false
                || exact(v, ["contract", "status", "terminal", "operationId", "requestSha256", "receipt"]) && v.status === "completed" && v.terminal === true
                    && receipt(v.receipt, p.operationId, p.requestSha256));
    }
    if (action === "discover") {
        const p = input;
        if ("after" in p) {
            if (!(exact(v, ["contract", "status", "items", "nextAfter"]) && v.status === "listed" && Array.isArray(v.items)
                && v.items.length <= p.limit && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
                return false;
            let previous = p.after === null ? "" : historyKey(p.after);
            for (const row of v.items) {
                if (!(exact(row, ["cohortId", "id", "postId", "version", "preview", "createdAt", "status", "sourceStatus"])
                    && uuid(row.cohortId) && uuid(row.id) && uuid(row.postId) && integer(row.version)
                    && typeof row.preview === "string" && row.preview.length > 0 && row.preview.isWellFormed()
                    && Buffer.byteLength(row.preview) <= 384 && isTimestamp(row.createdAt)
                    && (row.status === "published" || row.status === "withdrawn")
                    && ["available", "withdrawn", "unavailable"].includes(String(row.sourceStatus))
                    && (row.status !== "withdrawn" || row.sourceStatus === "withdrawn")
                    && (p.view !== "own_posts" || row.id === row.postId)))
                    return false;
                const key = historyKey(row);
                if (key <= previous)
                    return false;
                previous = key;
            }
            return v.nextAfter === null || v.items.length > 0 && historyCursor(v.nextAfter) && historyKey(v.nextAfter) === previous;
        }
        if (!(exact(v, ["contract", "status", "items", "nextAfterId"]) && v.status === "listed" && Array.isArray(v.items)
            && v.items.length <= p.limit && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
            return false;
        let previous = p.afterId ?? "";
        for (const row of v.items) {
            if (p.view === "scopes") {
                if (!(exact(row, ["cohortId", "purpose", "usage"]) && uuid(row.cohortId) && row.cohortId > previous
                    && row.purpose === (p.purpose ?? "synthetic-two-user-prototype") && row.usage === GOAL_NETWORK_USAGE))
                    return false;
                previous = row.cohortId;
                continue;
            }
            if (!(exact(row, ["id", "postId", "version", "authorId", "preview", "createdAt"]) && uuid(row.id) && row.id > previous
                && uuid(row.postId) && integer(row.version) && uuid(row.authorId) && typeof row.preview === "string" && row.preview.length > 0
                && Buffer.byteLength(row.preview) <= 384 && isTimestamp(row.createdAt) && (p.view === "posts" ? row.id === row.postId : row.postId === p.postId)))
                return false;
            previous = row.id;
        }
        return v.nextAfterId === null || v.items.length > 0 && v.nextAfterId === previous;
    }
    if (action === "read") {
        const p = input;
        if (!(exact(v, ["contract", "status", "item", "receipt"]) && Buffer.byteLength(canonicalTeachingJson(v)) <= p.budgetBytes))
            return false;
        if (v.status === "not_found")
            return v.item === null && v.receipt === null;
        if (v.status !== "found" || !item(v.item))
            return false;
        const data = v.item;
        if (p.view === "adoption")
            return data.kind === "adoption" && data.id === p.adoptionId && v.receipt === null;
        return data.kind === p.view && data.cohortId === p.cohortId && data.postId === p.postId && data.version === p.version
            && data.id === (p.view === "post" ? p.postId : p.responseId) && (v.receipt === null
            || receipt(v.receipt, p.operationId, teachingRequestSha256(p)) && canonicalTeachingJson(v.receipt.request) === canonicalTeachingJson(goalNetworkMetadata(p)));
    }
    const p = input;
    return exact(v, ["contract", "status", "receipt"]) && v.status === "recorded"
        && receipt(v.receipt, p.operationId, teachingRequestSha256(p)) && v.receipt.action === action
        && canonicalTeachingJson(v.receipt.request) === canonicalTeachingJson(goalNetworkMetadata(p));
}
const actions = ["publish", "discover", "read", "adopt", "respond", "withdraw", "operation"];
export const goalNetworkToolAction = (name) => typeof name === "string"
    ? actions.find(action => name === `aidesk_goal_network_${action}`) : undefined;
const id = { type: "string", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" };
const nullable = (v) => ({ anyOf: [v, { type: "null" }] });
const integerSchema = (minimum = 1, maximum = 2147483647) => ({ type: "integer", minimum, maximum });
const str = (maxLength) => ({ type: "string", minLength: 1, maxLength });
const choice = (...values) => ({ type: "string", enum: values });
const object = (properties, optional = []) => ({ type: "object", additionalProperties: false, properties,
    required: Object.keys(properties).filter(key => !optional.includes(key)) });
const fields = {
    publish: { operationId: id, cohortId: id, postId: id, expectedVersion: integerSchema(0, 2147483646), title: str(256), text: str(8192), usage: choice(GOAL_NETWORK_USAGE) },
    adopt: { operationId: id, cohortId: id, postId: id, version: integerSchema(), adoptionId: id, goalRef: object({ goalId: id, version: integerSchema() }) },
    respond: { operationId: id, cohortId: id, postId: id, version: integerSchema(), responseId: id, text: str(2048) },
    withdraw: { operationId: id, cohortId: id, postId: id, version: integerSchema(), target: choice("post", "response"), responseId: nullable(id) },
    operation: { operationId: id, requestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } },
};
const descriptions = {
    publish: "仅在用户明确选择合成内容和获准范围后发表；正式受理核本人当前平台订阅或旧兼容权益，不展开私人目标或文件。",
    discover: "找回本人旧帖或回应用own_posts/own_responses，跨范围按after复合游标只读本人摘要；正文复用原read。查找他人分享先读取本人已获准的合成范围；scopes省略purpose只读原合成范围，显式synthetic-invited-pair读取本人已确认的新范围。再浏览或按query查找摘要，不启动试用或授予范围。",
    read: "读取准确原帖、回应或本人采用副本；共享原文为正式服务，须有用户开展授权并核本人当前权益，旧首次资格才开始试用；本人历史不起算。",
    adopt: "按用户授权把准确合成来源采用到其本人目标；不修改作者目标或授予源写权。",
    respond: "仅代表当前已授权用户回应准确分享来源；不得代作者回复或制造活跃。",
    withdraw: "作者撤下自己的帖子或回应；不因到期关闭，不承诺收回已合法取得的副本。",
    operation: "按原号和完整原请求摘要对账，只返回元数据；未知结果不得自动换号重发。",
};
export const goalNetworkToolDefinitions = actions.map(action => ({ name: `aidesk_goal_network_${action}`, title: descriptions[action].split("；")[0],
    description: descriptions[action], inputSchema: action === "read" ? {
        type: "object", oneOf: [
            object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice("read"), operationId: id, cohortId: id, postId: id,
                version: integerSchema(), view: choice("post", "response"), responseId: nullable(id), budgetBytes: integerSchema(1024, 24576) }),
            object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice("read"), view: choice("adoption"), adoptionId: id, budgetBytes: integerSchema(1024, 24576) }),
        ],
    } : action === "discover" ? { type: "object", oneOf: [
            object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice("discover"), view: choice("scopes"), afterId: nullable(id),
                limit: integerSchema(1, 16), budgetBytes: integerSchema(1024, 24576), purpose: choice(GOAL_NETWORK_SCOPE_PURPOSE) }, ["purpose"]),
            object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice("discover"), cohortId: id, view: choice("posts", "responses"), postId: nullable(id),
                afterId: nullable(id), limit: integerSchema(1, 16), budgetBytes: integerSchema(1024, 24576),
                query: { ...str(GOAL_NETWORK_LIMITS.queryBytes), description: "可选短语：原文最多128 UTF-8字节，无控制字符，去首尾空白后非空；匹配时去首尾空白、不区分大小写，按字面子串查找帖子标题/正文或回应正文。%和_无通配含义。换短语须从afterId:null重新开始。" } }, ["query"]),
            object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice("discover"), view: choice("own_posts", "own_responses"),
                after: nullable(object({ cohortId: id, id })), limit: integerSchema(1, 16), budgetBytes: integerSchema(1024, 24576) }),
        ] } : object({ contract: choice(GOAL_NETWORK_CONTRACT), action: choice(action), ...fields[action] }),
    annotations: { readOnlyHint: action === "discover" || action === "operation", destructiveHint: false, idempotentHint: action !== "read", openWorldHint: false } }));
