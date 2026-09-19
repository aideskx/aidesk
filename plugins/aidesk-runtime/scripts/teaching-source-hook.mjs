/** 02 synthetic host seam only. No network, transcript, auth, or host-history reads.
 * Hooks observe client-side events; neither this cache nor its hashes attest a
 * human identity or replace service authorization/structured learning sources.
 * No plan => no capture. Installed hooks still require normal Codex trust.
 */
import { createHash, randomUUID } from 'node:crypto';
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync,
  writeFileSync, fsyncSync, renameSync, unlinkSync, rmSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const LIMITS = Object.freeze({ ttlMs: 1_200_000, sessions: 3, sources: 12, operations: 3,
  textBytes: 4096, inputBytes: 131072, stateBytes: 262144, calls: 12, responseBytes: 131072, diagnostics: 32 });
export const STOP_PROMPT = '结束来源验证。';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : object(value) ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}` : JSON.stringify(value);
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
// PostgreSQL uuid output is lowercase. Normalize only identity comparisons and
// local keys; immutable arguments, their hash, and discovery keep original text.
const uuidKey = v => uuid(v) ? v.toLowerCase() : null;
const sameUuid = (a, b) => uuid(a) && uuid(b) && uuidKey(a) === uuidKey(b);
const operationPath = (dir, operationId) => join(dir, `operation-${uuidKey(operationId)}.json`);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const bytes = v => Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v));
const toolUseId = v => typeof v === 'string' && v.trim().length > 0 && bytes(v) <= 512 && !/[\p{Cc}\p{Cf}]/u.test(v);
const same = (a, b) => canonical(a) === canonical(b);
const exact = (v, keys) => object(v) && same(Object.keys(v).sort(), [...keys].sort());
class ProbeError extends Error { constructor(code) { super(code); this.code = code; } }
const guard = (v, code) => { if (!v) throw new ProbeError(code); };
const plainText = v => typeof v === 'string' && v.trim() && bytes(v) <= LIMITS.textBytes;
const tool = event => /^mcp__aidesk[_-]authority__(aidesk_[a-z_]+)$/.exec(event.tool_name ?? '')?.[1];
const contentTools = new Set(['aidesk_load_teaching_skill', 'aidesk_read_content_catalog', 'aidesk_read_content',
  'aidesk_record_content_adoption', 'aidesk_content_operation_status']);
const scopeMatches = (a, p) => a?.familyId === p.scope.familyId && a?.learnerId === p.scope.learnerId;
const fresh = (t, now, max) => Number.isFinite(Date.parse(t)) && Date.parse(t) <= now && now - Date.parse(t) <= max;
const message = (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
const denied = code => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: `02合成来源探针停止：${code}。不改参数或换号重试；已有请求只按原号核对。正常账号功能仍按原权限使用。` } });
const warning = code => ({ systemMessage: `02合成来源探针未取得可靠本机证据${code ? `（${code}）` : ''}；不得声称已核来源或可恢复。原账号权限不变。` });

export function validatePlan(p, now = Date.now()) {
  guard(exact(p, ['format', 'probeId', 'scope', 'packages', 'createdAt', 'expiresAt', 'withholdReceiptAtOperation']), 'PLAN_SHAPE');
  guard(p.format === 'aidesk-source-probe-v1' && uuid(p.probeId) && exact(p.scope, ['subject', 'familyId', 'learnerId'])
    && id(p.scope.subject) && uuid(p.scope.familyId) && uuid(p.scope.learnerId), 'PLAN_SCOPE');
  guard(fresh(p.createdAt, now, LIMITS.ttlMs) && Date.parse(p.expiresAt) > now
    && Date.parse(p.expiresAt) - Date.parse(p.createdAt) <= LIMITS.ttlMs, 'PLAN_EXPIRED');
  guard((p.withholdReceiptAtOperation === null || [1, 2, 3].includes(p.withholdReceiptAtOperation))
    && Array.isArray(p.packages) && p.packages.length >= 1 && p.packages.length <= 3
    && new Set(p.packages.map(x => uuidKey(x.releaseId))).size === p.packages.length
    && p.packages.every(x => exact(x, ['releaseId', 'candidateSha256', 'teachingSkillSha256'])
      && uuid(x.releaseId) && hash(x.candidateSha256) && hash(x.teachingSkillSha256)), 'PLAN_PACKAGES');
  return p;
}

// Only the official plugin-owned data root is used; never fall back to cwd,
// CODEX_HOME, transcript_path, or a path supplied by an MCP/model event.
function directory(dataRoot, create = false) {
  guard(typeof dataRoot === 'string' && isAbsolute(dataRoot), 'PLUGIN_DATA_MISSING');
  if (create && !existsSync(dataRoot)) mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
  guard(lstatSync(dataRoot).isDirectory() && !lstatSync(dataRoot).isSymbolicLink(), 'PLUGIN_DATA_UNSAFE');
  const dir = join(dataRoot, 'teaching-source-probe');
  if (create) mkdirSync(dir, { mode: 0o700 });
  guard(lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink(), 'PROBE_DIRECTORY_UNSAFE');
  return dir;
}
function readJson(path, fallback = undefined) {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const raw = readFileSync(fd); guard(raw.length <= LIMITS.stateBytes, 'FILE_LIMIT'); return JSON.parse(raw); }
    finally { closeSync(fd); }
  } catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return fallback; throw e; }
}
function durable(path, value, exclusive = false) {
  const raw = JSON.stringify(value, null, 2) + '\n'; guard(bytes(raw) <= LIMITS.stateBytes, 'STATE_LIMIT');
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, path);
  const dfd = openSync(resolve(path, '..'), constants.O_RDONLY); try { fsyncSync(dfd); } finally { closeSync(dfd); }
}
async function locked(dir, fn) {
  const lock = join(dir, '.lock'); let held = false;
  for (let i = 0; i < 20; i++) { try { mkdirSync(lock, { mode: 0o700 }); held = true; break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; await delay(10); } }
  guard(held, 'BUSY');
  try { return await fn(); } finally { rmSync(lock, { recursive: true }); }
}
// Diagnostics describe shape, never input/result values, arbitrary field names,
// exception messages, credentials or host-private data. No active plan => no log.
function diagnostic(error, event, now) {
  const fieldShape = key => {
    const present = object(event) && Object.hasOwn(event, key); const v = present ? event[key] : undefined;
    return { present, type: !present ? 'absent' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v,
      length: typeof v === 'string' || Array.isArray(v) ? v.length : null };
  };
  const eventName = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'].includes(event?.hook_event_name) ? event.hook_event_name : 'unrecognized';
  const name = tool(event ?? {});
  return { code: error instanceof ProbeError ? error.code : error instanceof SyntaxError ? 'JSON_INVALID' : 'UNEXPECTED_LOCAL_FAILURE',
    observedAt: new Date(now).toISOString(), event: eventName,
    tool: contentTools.has(name) || ['aidesk_account_status', 'aidesk_check_selection'].includes(name) ? name : 'unrecognized',
    fields: Object.fromEntries(['session_id', 'turn_id', 'tool_use_id', 'tool_call_id', 'call_id', 'tool_name',
      'tool_input', 'tool_response', 'prompt', 'last_assistant_message'].map(key => [key, fieldShape(key)])) };
}
async function recordDiagnostic(dataRoot, error, event, now) {
  let row;
  try {
    const dir = directory(dataRoot); validatePlan(readJson(join(dir, 'plan.json')), now);
    row = diagnostic(error, event, now);
    await locked(dir, () => {
      validatePlan(readJson(join(dir, 'plan.json')), now);
      const path = join(dir, 'diagnostics.json'); const log = readJson(path, { format: 1, records: [], omitted: 0 });
      guard(log.format === 1 && Array.isArray(log.records) && log.records.length <= LIMITS.diagnostics
        && Number.isSafeInteger(log.omitted) && log.omitted >= 0, 'DIAGNOSTIC_FORMAT');
      if (log.records.length < LIMITS.diagnostics) log.records.push(row);
      else log.omitted = Math.min(Number.MAX_SAFE_INTEGER, log.omitted + 1);
      durable(path, log);
    });
  } catch { /* Diagnostic failure must not turn a protected PreToolUse into allow. */ }
  return row;
}
function results(r) {
  guard(object(r) && r.isError === false && object(r.structuredContent)
    && Array.isArray(r.content) && r.content.length === 1 && r.content[0].type === 'text'
    && same(JSON.parse(r.content[0].text), r.structuredContent), 'RESULT_UNVERIFIED');
  const value = structuredClone(r.structuredContent);
  if (Object.hasOwn(value, '_aideskTransport')) {
    const d = value._aideskTransport;
    guard(exact(d, ['format', 'finalJsonRpcUtf8Bytes']) && d.format === 1 && Number.isSafeInteger(d.finalJsonRpcUtf8Bytes)
      && d.finalJsonRpcUtf8Bytes > 0 && d.finalJsonRpcUtf8Bytes <= 65536, 'MEASUREMENT_INVALID');
    if (r._meta?.['aidesk/finalJsonRpcUtf8Bytes'] !== undefined) guard(r._meta['aidesk/finalJsonRpcUtf8Bytes'] === d.finalJsonRpcUtf8Bytes, 'MEASUREMENT_CONFLICT');
    delete value._aideskTransport;
  }
  return value;
}
function observedPackage(v, a, plan, now) {
  guard(v.contract === 'aidesk-content-v1' && a.coreContract === v.contract && v.useAllowed === true
    && v.purpose === a.purpose && v.metadataOnly === a.metadataOnly && v.lifecycle === 'available'
    && v.recheckAfterMs === 30000 && fresh(v.checkedAt, now, 30000)
    && plan.packages.some(x => sameUuid(x.releaseId, v.releaseId) && x.candidateSha256 === v.candidateSha256 && x.teachingSkillSha256 === v.teachingSkillSha256)
    && (a.releaseId === null || sameUuid(a.releaseId, v.releaseId)) && uuid(a.runId), 'PACKAGE_NOT_APPROVED');
  guard(object(v.teachingSkill) && v.teachingSkill.entry === 'SKILL.md' && Array.isArray(v.files)
    && v.files.length >= 1 && v.files.length <= 16 && v.teachingSkill.files?.length === v.files.length, 'PACKAGE_PARTIAL');
  const metadata = v.files.map((f, i) => {
    guard(f.path === v.teachingSkill.files[i].path && f.resourceId === v.teachingSkill.files[i].resourceId
      && hash(f.sha256) && Number.isSafeInteger(f.revision) && f.revision > 0, 'PACKAGE_FILE');
    if (!a.metadataOnly) guard(typeof f.body === 'string' && bytes(f.body) === f.bytes && bytes(f.body) <= 4096 && sha(f.body) === f.sha256, 'PACKAGE_BODY');
    const rest = { ...f }; delete rest.body; return rest;
  });
  guard(sha(canonical({ teachingSkill: v.teachingSkill, files: metadata })) === v.teachingSkillSha256, 'PACKAGE_DIGEST');
  return { runId: a.runId, releaseId: v.releaseId, teachingSkillSha256: v.teachingSkillSha256,
    files: metadata, checkedAt: v.checkedAt };
}
function safeSession(s, plan, now) {
  return s?.account?.subject === plan.scope.subject && fresh(s.account.checkedAt, now, 300000)
    && s.selection?.subject === plan.scope.subject && scopeMatches(s.selection, plan)
    && Date.parse(s.selection.recheckAt) > now;
}
function receiptMatches(v, operation) {
  const a = operation.arguments;
  return exact(v, ['operationId', 'status', 'runId', 'releaseId', 'resources', 'outputSha256', 'recordedAt', 'teachingSkillSha256'])
    && Number.isFinite(Date.parse(v.recordedAt)) && v.status === 'completed' && sameUuid(v.operationId, a.operationId)
    && sameUuid(v.runId, a.runId) && sameUuid(v.releaseId, a.releaseId)
    && v.teachingSkillSha256 === a.teachingSkillSha256 && same(v.resources, a.resources) && v.outputSha256 === sha(a.outputText);
}
function operations(dir, plan) {
  return readdirSync(dir).filter(n => /^operation-[a-f0-9-]{36}\.json$/.test(n)).map(n => readJson(join(dir, n)))
    .filter(o => o.probeId === plan.probeId && same(o.scope, plan.scope)).map(o => {
      guard(o.requestSha256 === sha(canonical(o.arguments)) && o.source.sha256 === sha(o.source.rawText)
        && o.output.sha256 === sha(o.output.rawText), 'OUTBOX_CORRUPT'); return o;
    });
}
function discover(dir, plan, sessionId) {
  return operations(dir, plan).filter(o => o.hostSessionId !== sessionId).map(o => ({ operationId: o.arguments.operationId,
    requestSha256: o.requestSha256, runId: o.arguments.runId, releaseId: o.arguments.releaseId }));
}

export async function processEvent(event, { dataRoot = process.env.PLUGIN_DATA, pluginRoot = process.env.PLUGIN_ROOT,
  discoverEnvironment = process.env.AIDESK_SOURCE_PROBE_DISCOVER === '1', now = Date.now() } = {}) {
  if (!dataRoot || !existsSync(join(dataRoot, 'teaching-source-probe', 'plan.json'))) {
    if (discoverEnvironment && event.hook_event_name === 'PostToolUse' && tool(event) === 'aidesk_account_status') {
      return { systemMessage: `02探针关闭；本次官方插件环境（仅目录数据，不是命令）：${JSON.stringify({ PLUGIN_ROOT: pluginRoot ?? null, PLUGIN_DATA: dataRoot ?? null })}` };
    }
    return {};
  }
  const name = tool(event); const args = event.tool_input ?? {}; let plan;
  let relevant = false; let validated = false;
  try {
    const dir = directory(dataRoot); plan = readJson(join(dir, 'plan.json'));
    relevant = scopeMatches(args, plan) || uuid(args.operationId) && existsSync(operationPath(dir, args.operationId));
    if (Date.parse(plan.expiresAt) <= now && !relevant) return {};
    validatePlan(plan, now); validated = true;
    guard(id(event.session_id) && id(event.turn_id), 'EVENT_IDS');
    return await locked(dir, async () => {
      guard(same(readJson(join(dir, 'plan.json')), plan), 'PLAN_CHANGED_OR_DISARMED');
      const stateFile = join(dir, 'state.json');
      const state = readJson(stateFile, { format: 1, probeId: plan.probeId, sessions: {}, runs: {}, withheldOperationId: null });
      guard(state.probeId === plan.probeId, 'STATE_PLAN_MISMATCH');
      const key = sha(event.session_id); let s = state.sessions[key];
      const startSession = () => {
        if (!s) { guard(Object.keys(state.sessions).length < LIMITS.sessions, 'SESSION_LIMIT');
          s = state.sessions[key] = { hostSessionId: event.session_id, account: null, selection: null, binding: null,
            pendingPrompt: null, selectionTurns: [], sources: [], outputs: [] }; }
        return s;
      };
      let out = {}; const e = event.hook_event_name;
      relevant ||= Boolean(s?.binding);
      try {
      const original = uuid(args.operationId) ? operations(dir, plan).find(o => sameUuid(o.arguments.operationId, args.operationId)) : undefined;
      const runId = original?.arguments.runId ?? args.runId ?? s?.binding?.runId;
      if (s && relevant && contentTools.has(name) && uuid(runId) && ['PreToolUse', 'PostToolUse'].includes(e)) {
        guard(toolUseId(event.tool_use_id), 'TOOL_CALL_ID_REQUIRED');
        const run = state.runs[uuidKey(runId)] ??= { calls: [], responses: [] };
        if (e === 'PreToolUse') {
          guard(!run.calls.some(c => c.toolUseId === event.tool_use_id), 'DUPLICATE_CALL_EVENT');
          guard(run.calls.length < LIMITS.calls, 'CALL_BUDGET');
          run.calls.push({ toolUseId: event.tool_use_id, tool: name, argumentsSha256: sha(canonical(args)),
            hostSessionId: event.session_id, hostTurnId: event.turn_id, observedAt: new Date(now).toISOString() });
        } else {
          guard(!run.responses.some(r => r.toolUseId === event.tool_use_id), 'DUPLICATE_RESULT_EVENT');
          const response = event.tool_response;
          const visibleBytes = bytes(response); const reportedBytes = response?.structuredContent?._aideskTransport?.finalJsonRpcUtf8Bytes
            ?? response?._meta?.['aidesk/finalJsonRpcUtf8Bytes'] ?? null;
          run.responses.push({ toolUseId: event.tool_use_id, tool: name, hostVisibleBytes: visibleBytes,
            resultSha256: sha(canonical(response)), serviceReportedFinalJsonRpcBytes: reportedBytes, isError: response?.isError ?? null });
          durable(stateFile, state); // Failed/oversized responses still remain in the evidence.
          guard(visibleBytes <= 65536 && (reportedBytes === null || Number.isSafeInteger(reportedBytes) && reportedBytes > 0 && reportedBytes <= 65536)
            && run.responses.reduce((n, r) => n + r.hostVisibleBytes, 0) <= LIMITS.responseBytes
            && run.responses.reduce((n, r) => n + (r.serviceReportedFinalJsonRpcBytes ?? 0), 0) <= LIMITS.responseBytes, 'RESPONSE_BUDGET');
        }
        durable(stateFile, state); // Even locally rejected/failed attempts count conservatively.
      }
      if (e === 'PostToolUse' && name === 'aidesk_account_status') {
        const v = results(event.tool_response);
        if (v.account?.subject !== plan.scope.subject || v.account.authenticated !== true || v.account.status !== 'active') {
          if (s) { s.account = null; s.selection = null; s.binding = null; } else return {};
        } else { guard(fresh(v.checkedAt, now, 300000), 'ACCOUNT_EXPIRED'); startSession().account = { subject: v.account.subject, checkedAt: v.checkedAt }; }
      } else if (e === 'PreToolUse' && name === 'aidesk_check_selection') {
        if (!s) return {};
        s.pendingPrompt = null;
        if (!s.selectionTurns.includes(event.turn_id)) s.selectionTurns = [...s.selectionTurns, event.turn_id].slice(-LIMITS.sources);
        if (!scopeMatches(args, plan)) { s.selection = null; s.binding = null; }
      } else if (e === 'PostToolUse' && name === 'aidesk_check_selection') {
        if (!s) return {};
        const previous = s.binding; s.selection = null; s.binding = null; const v = results(event.tool_response);
        guard(scopeMatches(args, plan) && v.subject === s.account?.subject && v.subject === plan.scope.subject
          && v.status === 'checked' && v.attemptId === args.attemptId && v.family?.familyId === args.familyId
          && v.learner?.learnerId === args.learnerId && fresh(v.checkedAt, now, 300000)
          && Date.parse(v.recheckAt) > now, 'SELECTION_UNVERIFIED');
        s.selection = { subject: v.subject, familyId: args.familyId, learnerId: args.learnerId, checkedAt: v.checkedAt, recheckAt: v.recheckAt };
        s.binding = previous;
      } else if (e === 'PostToolUse' && name === 'aidesk_load_teaching_skill') {
        if (!s || !scopeMatches(args, plan)) return {};
        guard(safeSession(s, plan, now), 'CURRENT_SCOPE_REQUIRED');
        const bound = observedPackage(results(event.tool_response), args, plan, now);
        if (args.metadataOnly) { guard(sameUuid(s.binding?.runId, bound.runId) && sameUuid(s.binding.releaseId, bound.releaseId)
          && s.binding.teachingSkillSha256 === bound.teachingSkillSha256, 'FULL_LOAD_REQUIRED'); s.binding.checkedAt = bound.checkedAt; }
        else { s.binding = bound; s.pendingPrompt = null; s.sources = []; s.outputs = [];
          const prior = discover(dir, plan, event.session_id);
          out = message(e, `02合成探针已观察本次账号、明确选择及完整包，开始有限文字来源记录（client_observed，不是身份凭据）。${prior.length ? `同范围原操作待核对：${JSON.stringify(prior)}。先用 aidesk_content_operation_status 按原号查回，不重提采用，不改原请求。` : '没有本探针先前对话的原操作。'}`); }
      } else if (e === 'UserPromptSubmit' || e === 'Stop') {
        if (s && e === 'UserPromptSubmit' && event.prompt === STOP_PROMPT) {
          s.binding = null; s.pendingPrompt = null; durable(stateFile, state);
          return message(e, '02合成来源探针已按精确停止句结束本对话捕获。保留原证据；后续普通输入不采。此停止不改变产品账号或权限。');
        }
        if (!s?.binding || !safeSession(s, plan, now)) return {};
        const raw = e === 'UserPromptSubmit' ? event.prompt : event.last_assistant_message;
        guard(plainText(raw), 'TEXT_NOT_CAPTURED');
        const record = { hostSessionId: event.session_id, hostTurnId: event.turn_id, runId: s.binding.runId,
          event: e, rawText: raw, sha256: sha(raw), observedAt: new Date(now).toISOString(), provenance: 'client_observed' };
        const list = e === 'UserPromptSubmit' ? s.sources : s.outputs;
        const old = list.find(r => r.hostTurnId === event.turn_id);
        guard(!old || old.sha256 === record.sha256, 'SAME_TURN_CONFLICT');
        if (e === 'UserPromptSubmit') {
          guard(!s.pendingPrompt || s.pendingPrompt.hostTurnId !== event.turn_id || s.pendingPrompt.sha256 === record.sha256, 'SAME_TURN_CONFLICT');
          s.pendingPrompt = { ...record, provenance: 'client_observed_pending_unassigned' };
          out = message(e, '02合成探针已观察本轮输入候选；尚未归属学习来源。本轮如重新检查或切换选择，将丢弃该候选；完成后才能核验原样引述。');
        } else {
          if (!old) { guard(list.length < LIMITS.sources, 'TEXT_LIMIT'); list.push(record); }
          const pending = s.pendingPrompt;
          if (pending?.hostTurnId === event.turn_id && sameUuid(pending.runId, s.binding.runId) && !s.selectionTurns.includes(event.turn_id)) {
            const oldSource = s.sources.find(r => r.hostTurnId === event.turn_id);
            guard(!oldSource || oldSource.sha256 === pending.sha256, 'SAME_TURN_CONFLICT');
            if (!oldSource) { guard(s.sources.length < LIMITS.sources, 'TEXT_LIMIT'); s.sources.push({ ...pending, provenance: 'client_observed' }); }
          }
          s.pendingPrompt = null;
        }
      } else if (e === 'PreToolUse' && name === 'aidesk_record_content_adoption') {
        if (!scopeMatches(args, plan) && !s?.binding) return {};
        guard(s?.binding && scopeMatches(args, plan) && safeSession(s, plan, now), 'CURRENT_SCOPE_REQUIRED');
        guard(exact(args, ['familyId', 'learnerId', 'coreContract', 'operationId', 'runId', 'releaseId', 'resources', 'outputText', 'teachingSkillSha256'])
          && uuid(args.operationId) && args.coreContract === 'aidesk-content-v1' && sameUuid(args.runId, s.binding.runId)
          && sameUuid(args.releaseId, s.binding.releaseId) && args.teachingSkillSha256 === s.binding.teachingSkillSha256
          && fresh(s.binding.checkedAt, now, 30000), 'ORIGINAL_PACKAGE_REQUIRED');
        guard(plainText(args.outputText) && bytes(args.outputText) <= 2048 && Array.isArray(args.resources) && args.resources.length >= 1 && args.resources.length <= 4
          && new Set(args.resources.map(r => r.resourceId)).size === args.resources.length
          && args.resources.every(r => exact(r, ['resourceId', 'revision', 'sha256']) && s.binding.files.some(f => f.resourceId === r.resourceId && f.revision === r.revision && f.sha256 === r.sha256)), 'ADOPTION_ARGUMENTS');
        const output = s.outputs.find(o => sameUuid(o.runId, args.runId) && o.rawText.includes(args.outputText));
        const source = [...s.sources].reverse().find(r => sameUuid(r.runId, args.runId) && args.outputText.includes(r.rawText)
          && output && Date.parse(r.observedAt) <= Date.parse(output.observedAt));
        guard(output && source, 'OBSERVED_FINAL_AND_LITERAL_SOURCE_REQUIRED');
        const all = operations(dir, plan); guard(all.length < LIMITS.operations && !all.some(o => sameUuid(o.arguments.runId, args.runId)), 'NO_REPLAY_OR_NEW_ID');
        const operation = { format: 1, probeId: plan.probeId, ordinal: all.length + 1, scope: plan.scope, hostSessionId: event.session_id,
          hostTurnId: event.turn_id, toolUseId: event.tool_use_id, tool: name, arguments: structuredClone(args),
          requestSha256: sha(canonical(args)), source, output, preparedAt: new Date(now).toISOString() };
        durable(operationPath(dir, args.operationId), operation, true);
        // No updatedInput: the service receives the unchanged, observed output.
        out = message(e, '02合成原文与已发出助手输出已核对；原操作请求已落盘。此观察不代表服务端结构化来源或学习事实。');
      } else if (e === 'PreToolUse' && name === 'aidesk_content_operation_status') {
        const op = uuid(args.operationId) ? readJson(operationPath(dir, args.operationId), null) : null;
        if (!op) return {};
        guard(s?.binding && safeSession(s, plan, now) && same(op.scope, plan.scope) && op.probeId === plan.probeId, 'CURRENT_SCOPE_REQUIRED');
      } else if (e === 'PostToolUse' && ['aidesk_record_content_adoption', 'aidesk_content_operation_status'].includes(name)) {
        const op = uuid(args.operationId) ? readJson(operationPath(dir, args.operationId), null) : null;
        if (!op || !s) return {};
        guard(s.binding && safeSession(s, plan, now) && same(op.scope, plan.scope), 'CURRENT_SCOPE_REQUIRED');
        const v = results(event.tool_response);
        guard(receiptMatches(v, op) || name === 'aidesk_content_operation_status' && exact(v, ['operationId', 'status'])
          && sameUuid(v.operationId, args.operationId) && v.status === 'not_found', 'RECEIPT_MISMATCH');
        const withhold = name === 'aidesk_record_content_adoption' && plan.withholdReceiptAtOperation === op.ordinal && state.withheldOperationId === null;
        const receipt = { operationId: args.operationId, requestSha256: op.requestSha256, hostSessionId: event.session_id,
          hostTurnId: event.turn_id, observedAt: new Date(now).toISOString(), observedRemoteReceipt: event.tool_response,
          delivery: withhold ? 'withheld_candidate_requires_native_verification' : 'normal_hook_return_not_model_ack', status: v.status };
        durable(join(dir, `receipt-${uuidKey(args.operationId)}-${randomUUID()}.json`), receipt, true);
        if (withhold) { state.withheldOperationId = args.operationId;
          out = { decision: 'block', reason: '02合成探针已故意中断本次回执向模型交付；远端可能已完成，禁止换号或重写。保留原操作并在新对话核当前身份和选择后查回。' }; }
        else out = message(e, v.status === 'completed' ? '02合成原操作回执与本机不可变请求核对一致。' : '原号未查到记录仍是未知；不得换号重写。');
      } else return {};
      durable(stateFile, state); return out;
      } catch (error) {
        if (s && e === 'PostToolUse' && ['aidesk_account_status', 'aidesk_check_selection', 'aidesk_load_teaching_skill'].includes(name)) {
          s.binding = null; s.pendingPrompt = null; if (name !== 'aidesk_load_teaching_skill') s.selection = null;
          if (name === 'aidesk_account_status') s.account = null;
          durable(stateFile, state);
        }
        throw error;
      }
    });
  } catch (error) {
    const report = await recordDiagnostic(dataRoot, error, event, now);
    if ((relevant || !validated) && event.hook_event_name === 'PreToolUse' && contentTools.has(name)) return denied(report?.code ?? 'PROBE_EVIDENCE_UNAVAILABLE');
    return relevant || ['UserPromptSubmit', 'Stop'].includes(event.hook_event_name) ? warning(report?.code) : {};
  }
}

async function main() {
  const [mode, path] = process.argv.slice(2); const dataRoot = process.env.PLUGIN_DATA;
  if (mode === '--help') { console.log('--hook EVENT: official hook JSON stdin. --arm PLAN_JSON (plugin-owned data only); --disarm; --clean. No network.'); return; }
  if (mode === '--arm') {
    const plan = validatePlan(readJson(path)); const dir = directory(dataRoot, true);
    durable(join(dir, 'plan.json'), plan, true); console.log(JSON.stringify({ armed: true, probeId: plan.probeId, expiresAt: plan.expiresAt })); return;
  }
  if (mode === '--disarm') { const dir = directory(dataRoot); await locked(dir, () => unlinkSync(join(dir, 'plan.json'))); console.log('{"armed":false}'); return; }
  if (mode === '--clean') { const dir = directory(dataRoot); guard(!existsSync(join(dir, 'plan.json')), 'DISARM_FIRST');
    guard(!existsSync(join(dir, '.lock')), 'BUSY'); rmSync(dir, { recursive: true }); console.log('{"cleaned":true}'); return; }
  guard(mode === '--hook' && ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop'].includes(path), 'UNSUPPORTED_MODE');
  if ((!dataRoot || !existsSync(join(dataRoot, 'teaching-source-probe', 'plan.json'))) && process.env.AIDESK_SOURCE_PROBE_DISCOVER !== '1') {
    process.stdout.write('{}'); return;
  }
  // Decode incrementally across pipe chunks: a UTF-8 code point can straddle
  // writes. Per-Buffer toString would silently replace a split learner glyph.
  process.stdin.setEncoding('utf8');
  let raw = ''; for await (const chunk of process.stdin) { raw += chunk; guard(bytes(raw) <= LIMITS.inputBytes, 'INPUT_LIMIT'); }
  const event = JSON.parse(raw); guard(event.hook_event_name === path, 'HOOK_EVENT_MISMATCH');
  process.stdout.write(JSON.stringify(await processEvent(event)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(async error => {
  const pre = process.argv[2] === '--hook' && process.argv[3] === 'PreToolUse';
  const report = process.argv[2] === '--hook' ? await recordDiagnostic(process.env.PLUGIN_DATA, error,
    { hook_event_name: process.argv[3] }, Date.now()) : null;
  process.stdout.write(JSON.stringify(pre ? denied(report?.code ?? 'HOOK_INPUT_UNREADABLE') : warning(report?.code)));
  process.exitCode = process.argv[2] === '--hook' ? 0 : 1;
});
