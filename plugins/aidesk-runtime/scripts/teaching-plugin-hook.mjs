/** 05 normal-client observation seam. No network, auth or host-history reads.
 * Signatures prove the registered client's key possession, not device/human
 * identity. SQL remains the business/authorization owner. The 02 probe is separate.
 */
import { constants, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync,
  writeFileSync, fsyncSync, renameSync, readdirSync, rmSync, unlinkSync, linkSync, fstatSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { canonicalTeachingJson, parseTeachingBusinessInput, teachingRequestSha256, teachingSameUuid,
  teachingSha256, teachingUtf8Bytes, validTeachingBusinessResult, TeachingInputError, TEACHING_BUSINESS_CONTRACT,
  TEACHING_CORRECTION_BASIS_CONTRACT, usesTeachingCorrectionBasis } from './lib/teaching-business-contract.mjs';
import { validContentToolInput, validContentResult } from './lib/teaching-content-contract.mjs';
import { packTeachingPluginRequest, unpackTeachingPluginRequest } from './lib/teaching-plugin-transport.mjs';
import { TEACHING_WRITE_OUTCOME_CONTRACT, correlateTeachingCall, validTeachingWriteRejected, validTeachingDenialProof } from './lib/teaching-write-outcome.mjs';
import { CAPACITY_PROFILE, validTeachingSkillCapacityInput, validTeachingSkillCapacityResult } from './lib/teaching-skill-capacity-contract.mjs';
import { CapacityClientError, capacityActions, capacityInput, acceptCapacityResult, reserveCapacityCall,
  observeCapacityBytes, observeCapacityOutcome, failCapacityPhase, observeCapacityEntry, checkCapacityLedger, capacityDeadline,
  reserveCapacityRecovery, observeCapacityRecovery, capacityRecoveryRequired, hasCapacityRecoveryCall } from './teaching-capacity-client.mjs';

export const PLUGIN_PROTOCOL = 'aidesk-teaching-plugin-v1';
export const PLUGIN_LIMITS = Object.freeze({ inputBytes: 131072, fileBytes: 1048576, sources: 64, calls: 256,
  operations: 128, localOperations: 16, accountFreshMs: 300000, sourceBytes: 4096, pendingObservationMs: 120000, cancellationIntentMs: 120000, writeDispatchWindowMs: 30000 });
const commitActions = new Set(['select_mode', 'adopt_mode', 'goal', 'checkpoint', 'correction', 'advance_corrections']);
const actions = new Set(['session', 'sources', 'text_digest', 'ids', 'load_skill', 'read_content_catalog', 'read_content',
  ...capacityActions, 'start', ...commitActions, 'cancel_operation', 'context', 'evidence', 'operation', 'recover_request', 'discover', 'end']);
const resumablePauses = new Set(['INTERRUPT', 'SESSIONEND', 'VERIFICATION_EXPIRED']);
const readOnlyRecovery = new Set(['session', 'operation', 'discover', 'recover_request']);
const knownRejections = new Set(['invalid_input', 'payload_too_large', 'contract_incompatible', 'authenticated_required',
  'scope_denied', 'entry_denied', 'feature_unavailable', 'binding_stale', 'version_conflict', 'operation_conflict',
  'source_missing', 'source_mismatch', 'dependency_invalid', 'content_invalid', 'content_missing', 'content_incompatible', 'content_retired']);
const sha = value => createHash('sha256').update(value).digest('hex');
const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => canonicalTeachingJson(a) === canonicalTeachingJson(b);
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const bounded = (v, n = 512) => typeof v === 'string' && v.trim().length > 0 && v.isWellFormed()
  && Buffer.byteLength(v) <= n && !/[\p{Cc}\p{Cf}]/u.test(v);
const exact = (v, required, optional = []) => object(v) && required.every(k => Object.hasOwn(v, k))
  && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
class SeamError extends Error { constructor(code) { super(code); this.code = code; } }
const need = (condition, code) => { if (!condition) throw new SeamError(code); };
// An ended execution retains its loading ledger for audit, but its completed
// phase must not become a pending first start when executionId is cleared.
const capacityEntryIsActive = s => !s.ended && (s.capacityPhase?.status === 'loading'
  || s.capacityPhase?.status === 'complete' && !s.executionId && s.capacityPhase.runId === s.contentRunId);
const businessInputCodes = Object.freeze({ invalid_input: 'BUSINESS_INPUT_INVALID',
  payload_too_large: 'BUSINESS_PAYLOAD_TOO_LARGE', contract_incompatible: 'BUSINESS_CONTRACT_INCOMPATIBLE' });
function parseCurrentBusinessInput(action, value) {
  try { return parseTeachingBusinessInput(action, value); }
  catch (error) {
    if (error instanceof TeachingInputError && Object.hasOwn(businessInputCodes, error.kind)) throw new SeamError(businessInputCodes[error.kind]);
    throw error;
  }
}
const inputAdvice = code => Object.values(businessInputCodes).includes(code)
  ? '本次调用在本机合同校验时被拒绝，尚未派发，未留下新的可对账写入原号；不要查询不存在的原号。请按实际工具schema核对字段、类型及大小后修正参数；合同版本不兼容需先恢复兼容客户端，不可绕过校验。'
  : code === 'OUTBOX_REQUEST_INCOMPATIBLE'
    ? '历史原请求未通过当前合同校验；已停止归档和本次派发，保留旧原件与状态。需恢复兼容的读取或处理能力，不跳过、删除旧记录或改写原请求；本次未留下新的可对账写入原号。' : null;
const expiry = (value, now) => Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
const fresh = (value, now, age) => Number.isFinite(Date.parse(value)) && Date.parse(value) <= now && now - Date.parse(value) <= age;
const scopeEqual = (a, b) => a?.subject === b?.subject && a?.familyId === b?.familyId && a?.learnerId === b?.learnerId;
const toolName = event => /^mcp__aidesk[_-]authority__(aidesk_[a-z_]+)$/.exec(event.tool_name ?? '')?.[1];
const actionOf = name => name?.startsWith('aidesk_teaching_') && actions.has(name.slice(16)) ? name.slice(16) : undefined;
const refreshAdvice = code => code === 'CURRENT_VERIFICATION_REFRESH_REQUIRED'
  ? '本次写入尚未派发，未生成原操作号；账号或选择的剩余核验时间不足，请沿原入口重核账号和原明确选择后再继续。'
  : code === 'CHALLENGE_REFRESH_REQUIRED'
    ? '本次写入尚未派发，未生成原操作号；请先用session刷新客户端challenge并核实际结果，再继续原已授权事项。'
    : code === 'CHALLENGE_REFRESH_RECHECK_REQUIRED'
      ? '当前challenge刷新后仍只剩很短有效期；不要循环hello，请先沿原入口重核账号和原明确选择。未派发写入没有原操作号，已派发未知仍只按原号对账。'
      : code === 'LOCAL_OUTBOX_LIMIT'
        ? '本次写入尚未派发，未生成原操作号；本地活跃写入队列已满。保留现有原号并核对未决结果，不循环重试、不删除历史。'
        : code === 'CORRECTION_BASIS_UNAVAILABLE'
          ? '本次扩展调用尚未派发，未保存新的原请求；请先调用session核对纠错依据能力。未取得当前服务明确能力回执时，不发送扩展字段，不删去必要依据改写请求冒充成功。' : inputAdvice(code);
const denial = code => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
  permissionDecisionReason: refreshAdvice(code) ? `AI书桌教学接线未完成（${code}）。${refreshAdvice(code)}`
    : `AI书桌教学接线未完成（${code}）。不可声称已保存，不换原号重写；先用session/operation核对。账号功能仍按原权限。` } });
const notice = (event, code) => ({ hookSpecificOutput: { hookEventName: event,
  additionalContext: `AI书桌客户端观察状态：${code}。这是客户端观察，不是操作者身份或独立作答证明。` } });

function safeDirectory(path, create = false) {
  if (create && !existsSync(path)) mkdirSync(path, { mode: 0o700 });
  need(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_DIRECTORY');
  return path;
}
function directory(root, create = false) {
  need(typeof root === 'string' && isAbsolute(root), 'PLUGIN_DATA_REQUIRED');
  if (!existsSync(root)) { need(create, 'PLUGIN_DATA_REQUIRED'); mkdirSync(root, { recursive: true, mode: 0o700 }); }
  safeDirectory(root); const path = join(root, 'teaching-plugin-v1');
  safeDirectory(path, create);
  for (const name of ['keys', 'sessions', 'operations', 'calls']) safeDirectory(join(path, name), create);
  return path;
}
function read(path, fallback) {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const raw = readFileSync(fd); need(raw.length <= PLUGIN_LIMITS.fileBytes, 'FILE_LIMIT'); return JSON.parse(raw.toString('utf8')); }
    finally { closeSync(fd); }
  } catch (error) { if (error.code === 'ENOENT' && arguments.length > 1) return fallback; throw error; }
}
function durable(path, value, exclusive = false) {
  const raw = JSON.stringify(value) + '\n'; need(Buffer.byteLength(raw) <= PLUGIN_LIMITS.fileBytes, 'FILE_LIMIT');
  const temporary = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  if (!exclusive) renameSync(temporary, path);
  const parent = openSync(resolve(path, '..'), constants.O_RDONLY);
  try { fsyncSync(parent); } finally { closeSync(parent); }
}
async function locked(dir, fn) {
  const path = join(dir, '.lock'); let held = false;
  for (let i = 0; i < 50; i++) {
    try { mkdirSync(path, { mode: 0o700 }); held = true; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; await delay(10); }
  }
  need(held, 'BUSY');
  try { return await fn(); } finally { rmSync(path, { recursive: true }); }
}
function key(dir, subject) {
  const path = join(dir, 'keys', `${sha(subject)}.json`); let saved = read(path, null);
  if (!saved) {
    const pair = generateKeyPairSync('ed25519'); const jwk = pair.publicKey.export({ format: 'jwk' });
    const publicKey = { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
    saved = { format: 1, subject, publicKey, keyId: sha(canonicalTeachingJson(publicKey)),
      privateKey: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') };
    durable(path, saved, true);
  }
  need(saved.format === 1 && saved.subject === subject && saved.keyId === sha(canonicalTeachingJson(saved.publicKey)), 'KEY_CORRUPT');
  const privateKey = createPrivateKey({ key: Buffer.from(saved.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  need(jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x === saved.publicKey.x, 'KEY_CORRUPT');
  return { publicKey: saved.publicKey, keyId: saved.keyId, privateKey };
}
function result(event) {
  const value = event.tool_response;
  need(object(value) && typeof value.isError === 'boolean' && object(value.structuredContent)
    && Array.isArray(value.content) && value.content.length === 1 && value.content[0].type === 'text'
    && same(JSON.parse(value.content[0].text), value.structuredContent), 'RESULT_UNVERIFIED');
  const data = structuredClone(value.structuredContent);
  if (Object.hasOwn(data, '_aideskTransport')) {
    const m = data._aideskTransport;
    need(exact(m, ['format', 'finalJsonRpcUtf8Bytes']) && m.format === 1 && Number.isSafeInteger(m.finalJsonRpcUtf8Bytes)
      && m.finalJsonRpcUtf8Bytes > 0 && m.finalJsonRpcUtf8Bytes <= 65536, 'MEASUREMENT_INVALID');
    if (value._meta?.['aidesk/finalJsonRpcUtf8Bytes'] !== undefined) need(value._meta['aidesk/finalJsonRpcUtf8Bytes'] === m.finalJsonRpcUtf8Bytes, 'MEASUREMENT_INVALID');
    delete data._aideskTransport;
  }
  need(Buffer.byteLength(JSON.stringify(value)) <= 65536, 'RESULT_LIMIT');
  return { error: value.isError, data };
}
function capacityStorage(dir, sessionId) {
  const folder = join(dir, `capacity-${sha(sessionId)}`);
  const pagePath = (loadId, pageIndex) => {
    need(uuid(loadId) && Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < 32, 'CAPACITY_CACHE_KEY_INVALID');
    return join(folder, `${loadId.toLowerCase()}-${pageIndex}.json`);
  };
  return {
    read: (loadId, pageIndex) => read(pagePath(loadId, pageIndex)),
    write: (loadId, pageIndex, value) => {
      safeDirectory(folder, true); const path = pagePath(loadId, pageIndex);
      if (existsSync(path)) {
        const { checkedAt: _oldTime, ...previous } = read(path);
        const { checkedAt: _newTime, ...current } = value;
        void _oldTime; void _newTime;
        need(same(previous, current), 'CAPACITY_PAGE_CONFLICT');
      } else {
        const entries = readdirSync(folder);
        need(entries.length < 64, 'CAPACITY_CACHE_LIMIT');
        const total = entries.reduce((n, name) => {
          need(/^[a-f0-9-]{36}-\d{1,2}\.json$/.test(name), 'CAPACITY_CACHE_INVALID');
          const info = lstatSync(join(folder, name));
          need(info.isFile() && !info.isSymbolicLink() && info.size <= 32768, 'CAPACITY_CACHE_INVALID');
          return n + info.size;
        }, 0);
        const bytes = Buffer.byteLength(JSON.stringify(value) + '\n');
        need(bytes <= 32768 && total + bytes <= 262144, 'CAPACITY_CACHE_LIMIT');
        durable(path, value, true);
      }
    },
    clear: () => { if (existsSync(folder)) { safeDirectory(folder); rmSync(folder, { recursive: true }); } },
  };
}
function capacityResponseBytes(event) {
  result(event);
  const bytes = event.tool_response.structuredContent._aideskTransport?.finalJsonRpcUtf8Bytes;
  need(Number.isSafeInteger(bytes) && bytes >= Buffer.byteLength(JSON.stringify(event.tool_response))
    && bytes <= 65536, 'CAPACITY_MEASUREMENT_REQUIRED');
  return bytes;
}
function emptySession(id) {
  return { format: 1, hostSessionId: id, account: null, selection: null, pendingSelection: null,
    context: null, challenge: null, hello: null, correctionCapability: null, active: false, ended: false, endedBinding: null, paused: null, pauseRecovery: null,
    binding: null, executionId: null, taskRef: null, sequence: 0, pendingTransition: null, contentRunId: randomUUID(), loaded: null,
    sources: [], submittedSourceIds: [], discardedTurns: [], assistantTurns: [], initialAssistantTurn: null, hasSelectedContext: false,
    pendingObservation: null, observationRecovery: [], callCount: 0 };
}
function newContext(s, selected, turnId = null) {
  discardObservation(s);
  if (bounded(turnId, 256)) s.cancelDiscardedTurns = [...new Set([...(Array.isArray(s.cancelDiscardedTurns) ? s.cancelDiscardedTurns.filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) : []), sha(turnId)])].slice(-64);
  const initial = !s.context && s.hasSelectedContext !== true;
  s.selection = selected; s.pendingSelection = null;
  s.context = { subject: selected.subject, familyId: selected.familyId, learnerId: selected.learnerId,
    selectionAttemptId: selected.selectionAttemptId, clientContextId: randomUUID() };
  s.challenge = null; s.controlSession = null; discardCancellation(s); s.writeOutcomeCapability = null; s.correctionCapability = null; s.hello = null; s.helloVerification = null; s.shortChallenge = null; s.active = false; s.ended = false; s.endedBinding = null; s.paused = null; s.pauseRecovery = null;
  s.binding = null; s.executionId = null; s.taskRef = null; s.sequence = 0; s.pendingTransition = null;
  s.loaded = null; s.contentRunId = randomUUID(); s.sources = []; s.submittedSourceIds = []; s.assistantTurns = [];
  s.initialAssistantTurn = initial ? turnId : null; s.hasSelectedContext = true;
}
function current(s, now, allowPaused = false) {
  need(s?.account && s.selection && s.context && s.account.subject === s.context.subject
    && scopeEqual(s.selection, s.context), 'CURRENT_SELECTION_REQUIRED');
  const accountAt = Date.parse(s.account.checkedAt), selectionUntil = Date.parse(s.selection.recheckAt);
  need(!(Number.isFinite(accountAt) && now - accountAt > PLUGIN_LIMITS.accountFreshMs)
    && !(Number.isFinite(selectionUntil) && selectionUntil <= now), 'CURRENT_VERIFICATION_EXPIRED');
  need(fresh(s.account.checkedAt, now, PLUGIN_LIMITS.accountFreshMs) && expiry(s.selection.recheckAt, now), 'CURRENT_SELECTION_REQUIRED');
  if (!allowPaused) need(s.active && !s.paused && !s.ended, 'CAPTURE_INACTIVE');
}
// Local dispatch budget: the existing 10s transport timeout plus round-trip /
// clock headroom. This neither extends nor replaces any authority deadline.
function typedWriteCapable(s) {
  return !!s.challenge && s.writeOutcomeCapability?.challengeId === s.challenge.challengeId
    && s.writeOutcomeCapability?.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT;
}
function correctionAcknowledged(s) {
  return !!s.challenge && s.correctionCapability?.challengeId === s.challenge.challengeId
    && s.correctionCapability?.contract === TEACHING_CORRECTION_BASIS_CONTRACT;
}
function correctionBasisCapable(s) {
  return correctionAcknowledged(s) && s.correctionCapability?.ready === true;
}
function shortChallengeChecked(s) {
  return !!s.shortChallenge && !!s.challenge && s.shortChallenge.challengeId === s.challenge.challengeId
    && s.shortChallenge?.accountCheckedAt === s.account?.checkedAt
    && s.shortChallenge?.selectionAttemptId === s.selection?.selectionAttemptId;
}
function writeDispatchWindow(s, now) {
  need(Date.parse(s.account.checkedAt) + PLUGIN_LIMITS.accountFreshMs - now > PLUGIN_LIMITS.writeDispatchWindowMs
    && Date.parse(s.selection.recheckAt) - now > PLUGIN_LIMITS.writeDispatchWindowMs, 'CURRENT_VERIFICATION_REFRESH_REQUIRED');
  need(s.challenge && expiry(s.challenge.expiresAt, now), 'CALL_SESSION_FOR_CHALLENGE');
  need(Date.parse(s.challenge.expiresAt) - now > PLUGIN_LIMITS.writeDispatchWindowMs,
    shortChallengeChecked(s) ? 'CHALLENGE_REFRESH_RECHECK_REQUIRED' : 'CHALLENGE_REFRESH_REQUIRED');
}
function pauseLocally(s, reason) {
  discardObservation(s);
  if (reason !== 'VERIFICATION_EXPIRED') discardCancellation(s);
  s.active = false;
  s.initialAssistantTurn = null; s.assistantTurns = [];
  if (!s.ended && s.context && (!s.paused || resumablePauses.has(s.paused))) {
    s.paused = reason;
    s.pauseRecovery = { token: randomUUID(), context: structuredClone(s.context), binding: structuredClone(s.binding), executionId: s.executionId,
      accountVerified: false, selectionVerified: false };
  }
}
function operationFiles(dir) { return readdirSync(join(dir, 'operations')).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)); }
// Immutable terminal originals are retained separately from the bounded active
// outbox. No time-based eviction, remote calls, key scans or session scans.
const OUTBOX_ARCHIVE_BATCH = 16;
function outboxText(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    need(info.isFile() && info.size <= PLUGIN_LIMITS.fileBytes, 'OUTBOX_CORRUPT');
    const raw = readFileSync(fd);
    need(raw.length <= PLUGIN_LIMITS.fileBytes, 'OUTBOX_CORRUPT');
    const text = raw.toString('utf8');
    need(Buffer.from(text, 'utf8').equals(raw), 'OUTBOX_CORRUPT');
    return text;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function archivePath(dir, id, create = false) {
  const root = join(dir, 'operations-archive'), shard = join(root, id.slice(0, 2));
  for (const path of [root, shard]) {
    try {
      const info = lstatSync(path);
      need(info.isDirectory() && !info.isSymbolicLink(), 'UNSAFE_DIRECTORY');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) break;
      mkdirSync(path, { mode: 0o700 });
      const parent = openSync(resolve(path, '..'), constants.O_RDONLY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    }
  }
  return join(shard, `${id}.json`);
}
function publishArchive(path, value) {
  const raw = JSON.stringify(value) + '\n', temporary = `${path}.${randomUUID()}.tmp`;
  need(Buffer.byteLength(raw) <= PLUGIN_LIMITS.fileBytes, 'FILE_LIMIT');
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, raw); fsyncSync(fd); } finally { closeSync(fd); }
  need(outboxText(temporary) === raw, 'OUTBOX_ARCHIVE_CORRUPT');
  // Publishing a hard link is atomic and never overwrites a conflicting UUID.
  // A crash before publication leaves only a temporary file and intact active
  // originals; after publication the archive is already complete and durable.
  linkSync(temporary, path);
  const parent = openSync(resolve(path, '..'), constants.O_RDONLY);
  try { fsyncSync(parent); unlinkSync(temporary); fsyncSync(parent); } finally { closeSync(parent); }
}
function syncArchiveBeforeRemoval(dir, path, expectedText) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    need(info.isFile() && info.size <= PLUGIN_LIMITS.fileBytes
      && readFileSync(fd).equals(Buffer.from(expectedText, 'utf8')), 'OUTBOX_ARCHIVE_CONFLICT');
    fsyncSync(fd);
  } finally { closeSync(fd); }
  // A prior process may have stopped immediately after link/mkdir but before
  // its parent fsync. Visibility on restart alone is not a durable copy. Flush
  // the complete archive directory chain, including already-existing paths,
  // before deleting either active duplicate. Any failure retains both copies.
  for (const directory of [resolve(path, '..'), resolve(path, '../..'), dir]) {
    const parent = openSync(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { need(fstatSync(parent).isDirectory(), 'UNSAFE_DIRECTORY'); fsyncSync(parent); }
    finally { closeSync(parent); }
  }
}
function validateOperation(dir, id, entry, value) {
  need(object(entry) && entry.protocol === PLUGIN_PROTOCOL && teachingSameUuid(entry.operationId, id)
    && entry.requestSha256 === teachingRequestSha256(entry.request), 'OUTBOX_CORRUPT');
  const status = value ?? { status: 'unknown', receipt: null };
  need(['prepared', 'unknown', 'completed', 'rejected'].includes(status.status), 'OUTBOX_CORRUPT');
  if (Object.hasOwn(status, 'rejectionResult') || Object.hasOwn(status, 'rejectionCallKey')) {
    need(Object.hasOwn(status, 'rejectionResult') && Object.hasOwn(status, 'rejectionCallKey')
      && validTeachingWriteRejected(status.rejectionResult), 'DENIAL_PROOF_INVALID');
    const result = status.rejectionResult, proof = result.proof;
    need(status.status === 'rejected' && status.receipt === null && validTeachingWriteRejected(result) && validTeachingDenialProof(proof)
      && teachingSameUuid(proof.operationId, entry.operationId) && proof.rpcAction === entry.action && proof.requestSha256 === entry.requestSha256
      && proof.scope.familyId === entry.context.familyId && proof.scope.learnerId === entry.context.learnerId
      && typeof status.rejectionCallKey === 'string' && /^[a-f0-9]{64}$/.test(status.rejectionCallKey), 'DENIAL_PROOF_INVALID');
    const call = read(join(dir, 'calls', `${status.rejectionCallKey}.json`), null);
    const correlation = call && correlateTeachingCall(call.name, call.arguments, entry.context.subject);
    need(call && scopeEqual(call.context, entry.context) && correlation && validTeachingWriteRejected(result, correlation)
      && denialMatchesCall(call, proof), 'DENIAL_CALL_UNAVAILABLE');
  }
  return { ...entry, ...status };
}
function terminalOperation(dir, entry, state) {
  if (state?.status !== 'completed' && !(state?.status === 'rejected' && state.rejectionResult)) return false;
  need(state.status === 'completed' ? exact(state, ['status', 'receipt'])
    : exact(state, ['status', 'receipt', 'rejectionResult', 'rejectionCallKey']), 'OUTBOX_ARCHIVE_CORRUPT');
  need(['start', 'commit', 'end'].includes(entry.action) && teachingSameUuid(entry.request?.operationId, entry.operationId)
    && typeof entry.context?.subject === 'string' && uuid(entry.context.familyId) && uuid(entry.context.learnerId), 'OUTBOX_CORRUPT');
  try { parseTeachingBusinessInput(entry.action, entry.request); }
  catch (error) {
    if (error instanceof TeachingInputError && Object.hasOwn(businessInputCodes, error.kind)) throw new SeamError('OUTBOX_REQUEST_INCOMPATIBLE');
    throw error;
  }
  validateOperation(dir, entry.operationId, entry, state);
  if (state.status === 'completed') need(validTeachingBusinessResult(entry.action, state.receipt, entry.request)
    && state.receipt.scope.familyId === entry.context.familyId && state.receipt.scope.learnerId === entry.context.learnerId,
  'ARCHIVE_RECEIPT_INVALID');
  return true;
}
function outboxLocation(dir, id) {
  need(uuid(id), 'OPERATION_ID_INVALID'); id = id.toLowerCase();
  const original = outboxText(join(dir, 'operations', `${id}.json`));
  const terminal = outboxText(join(dir, 'operations', `${id}.status.json`));
  const archivedText = outboxText(archivePath(dir, id));
  let archived = null;
  if (archivedText !== null) {
    archived = JSON.parse(archivedText);
    need(exact(archived, ['format', 'operationId', 'original', 'terminal', 'originalSha256', 'terminalSha256'])
      && archived.format === 1 && archived.operationId === id && typeof archived.original === 'string' && typeof archived.terminal === 'string'
      && archived.originalSha256 === sha(archived.original) && archived.terminalSha256 === sha(archived.terminal), 'OUTBOX_ARCHIVE_CORRUPT');
    const entry = JSON.parse(archived.original), state = JSON.parse(archived.terminal);
    need(teachingSameUuid(entry.operationId, id) && terminalOperation(dir, entry, state), 'OUTBOX_ARCHIVE_CORRUPT');
    // Copy-before-remove can leave both originals or either duplicate file.
    // Missing/conflicting live bytes never silently override an archive.
    need((original === null || original === archived.original)
      && (terminal === null || terminal === archived.terminal), 'OUTBOX_ARCHIVE_CONFLICT');
    return { entry, state, archived, archivedText, original, terminal };
  }
  need(original !== null || terminal === null, 'OUTBOX_CORRUPT');
  if (original === null) return null;
  const entry = JSON.parse(original), state = terminal === null ? { status: 'unknown', receipt: null } : JSON.parse(terminal);
  validateOperation(dir, id, entry, state);
  return { entry, state, archived, original, terminal };
}
function operation(dir, id) {
  const found = outboxLocation(dir, id);
  return found ? { ...found.entry, ...found.state } : null;
}
function archiveTerminalOperations(dir) {
  let moved = 0;
  for (const name of operationFiles(dir).sort()) {
    if (moved >= OUTBOX_ARCHIVE_BATCH) break;
    const id = name.slice(0, -5), found = outboxLocation(dir, id);
    if (!terminalOperation(dir, found.entry, found.state)) continue;
    need(found.original !== null && (found.terminal !== null || found.archived), 'OUTBOX_ARCHIVE_CORRUPT');
    const target = archivePath(dir, id, true);
    if (!found.archived) publishArchive(target, { format: 1, operationId: id, original: found.original, terminal: found.terminal,
      originalSha256: sha(found.original), terminalSha256: sha(found.terminal) }, true);
    // Verify the durable archive and exact still-live bytes before removing
    // their duplicate active copies. The archive preserves original UTF-8.
    const verified = outboxLocation(dir, id);
    need(verified.archived && verified.original === found.original && verified.terminal === found.terminal, 'OUTBOX_ARCHIVE_CONFLICT');
    syncArchiveBeforeRemoval(dir, target, verified.archivedText);
    if (verified.terminal !== null) unlinkSync(join(dir, 'operations', `${id}.status.json`));
    unlinkSync(join(dir, 'operations', name));
    const parent = openSync(join(dir, 'operations'), constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
    moved++;
  }
}
function localOperations(dir, context) {
  const list = operationFiles(dir).map(name => operation(dir, name.slice(0, -5))).filter(row => scopeEqual(row.context, context));
  return list;
}
function status(dir, entry, value) {
  const found = outboxLocation(dir, entry.operationId);
  need(found && found.entry.requestSha256 === entry.requestSha256, 'OUTBOX_CORRUPT');
  const path = join(dir, 'operations', `${entry.operationId.toLowerCase()}.status.json`), old = found.state;
  if (old?.status === 'completed') need(value.status === 'completed' && same(value.receipt, old.receipt), 'COMPLETED_OPERATION_IMMUTABLE');
  if (old?.status === 'rejected' && old.rejectionResult) need(value.status === 'rejected'
    && same(value.rejectionResult, old.rejectionResult), 'FENCED_OPERATION_IMMUTABLE');
  if (found.archived) { need(same(old, value), 'ARCHIVED_OPERATION_IMMUTABLE'); return; }
  durable(path, value);
}
function unresolved(dir, context) { return localOperations(dir, context).find(row => row.status === 'prepared' || row.status === 'unknown'); }
// A cancellation observation records only this real control message. It never
// enters sources(), asserts authority, or reactivates teaching capture.
function discardCancellation(s) {
  const p = s.cancelObservation; s.cancelObservation = null;
  if (p && bounded(p.turnId, 256)) s.cancelDiscardedTurns = [...new Set([...(Array.isArray(s.cancelDiscardedTurns) ? s.cancelDiscardedTurns.filter(v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)) : []), sha(p.turnId)])].slice(-64);
}
function controlSessionCurrent(s, now) {
  const v = s.controlSession;
  try { current(s, now, true); } catch { return false; }
  return v && same(v.context, s.context) && v.challengeId === s.challenge?.challengeId
    && v.accountCheckedAt === s.account.checkedAt && v.selectionAttemptId === s.selection.selectionAttemptId;
}
function validCancellation(s, now) {
  const p = s.cancelObservation, o = p?.observation, v = p?.verification;
  return exact(p, ['turnId', 'context', 'observation', 'expiresAt', 'verification']) && bounded(p.turnId, 256)
    && same(p.context, s.context) && expiry(p.expiresAt, now)
    && exact(o, ['observationId', 'clientContextId', 'role', 'text', 'sha256', 'observedAt'])
    && uuid(o.observationId) && o.clientContextId === s.context?.clientContextId && o.role === 'user'
    && typeof o.text === 'string' && o.text.trim().length > 0 && o.text.isWellFormed() && teachingUtf8Bytes(o.text) <= PLUGIN_LIMITS.sourceBytes
    && o.sha256 === teachingSha256(o.text) && fresh(o.observedAt, now, PLUGIN_LIMITS.cancellationIntentMs)
    && Date.parse(p.expiresAt) === Date.parse(o.observedAt) + PLUGIN_LIMITS.cancellationIntentMs
    && exact(v, ['token', 'accountVerified', 'selectionVerified', 'sessionVerified']) && uuid(v.token)
    && ['accountVerified', 'selectionVerified', 'sessionVerified'].every(k => typeof v[k] === 'boolean');
}
function observeCancellation(s, event, now) {
  if (event.stop_hook_active === true || !s.context || !s.account || !s.selection || s.pendingSelection
    || s.account.subject !== s.context.subject || !scopeEqual(s.selection, s.context)
    || s.cancelDiscardedTurns !== undefined && (!Array.isArray(s.cancelDiscardedTurns) || s.cancelDiscardedTurns.includes(sha(event.turn_id)))
    || s.discardedTurns.includes(event.turn_id) && !s.cancelObservation) return;
  const text = event.prompt;
  if (typeof text !== 'string' || !text.trim() || !text.isWellFormed() || teachingUtf8Bytes(text) > PLUGIN_LIMITS.sourceBytes) { discardCancellation(s); return; }
  canonicalTeachingJson(text);
  const old = s.cancelObservation;
  if (old && validCancellation(s, now) && old.turnId === event.turn_id && old.observation.text === text) return;
  const turnHash = sha(event.turn_id), textHash = teachingSha256(text), seen = s.cancelSeenInputs;
  if (seen?.turnHash === turnHash) {
    if (!Array.isArray(seen.hashes) || seen.hashes.length >= 4 || seen.hashes.some(v => typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))) { discardCancellation(s); return; }
    if (seen.hashes.includes(textHash)) return;
    seen.hashes.push(textHash);
  } else s.cancelSeenInputs = { turnHash, hashes: [textHash] };
  // A genuinely new live supplement replaces the current intent; exact replay
  // never renews a deadline, and tombstoned turns never recreate an intent.
  let verified = false;
  try { current(s, now, true); verified = true; } catch { /* Only observation, no authority. */ }
  s.cancelObservation = { turnId: event.turn_id, context: structuredClone(s.context),
    observation: { observationId: randomUUID(), clientContextId: s.context.clientContextId, role: 'user', text,
      sha256: teachingSha256(text), observedAt: new Date(now).toISOString() }, expiresAt: new Date(now + PLUGIN_LIMITS.cancellationIntentMs).toISOString(),
    verification: { token: randomUUID(), accountVerified: verified, selectionVerified: verified, sessionVerified: verified && !!controlSessionCurrent(s, now) } };
}
function observationAudit(s, p, state, at) {
  // Damaged pending data must never defeat deletion or leak arbitrary content
  // through the metadata-only lifecycle record.
  s.observationRecovery = [...(Array.isArray(s.observationRecovery) ? s.observationRecovery : []), {
    observationId: uuid(p?.id) ? p.id : null, turnIdSha256: bounded(p?.turnId, 256) ? sha(p.turnId) : null, state,
    capturedPendingAt: typeof p?.createdAt === 'string' && Number.isFinite(Date.parse(p.createdAt)) ? new Date(p.createdAt).toISOString() : null, at,
    sourceIds: Array.isArray(p?.rows) ? p.rows.slice(0, 4).map(row => row?.source?.sourceId).filter(uuid) : [],
    observedWhile: 'verification_expired' }].slice(-64);
}
function discardObservation(s) {
  const p = s.pendingObservation;
  if (p) {
    s.pendingObservation = null;
    // The real event turn was tombstoned on capture; never copy damaged pending metadata.
    try { observationAudit(s, p, 'discarded', null); } catch { /* Audit cannot retain discarded raw text. */ }
  }
}
function validPending(s, now) {
  const p = s.pendingObservation;
  return exact(p, ['id', 'turnId', 'context', 'binding', 'executionId', 'taskRef', 'createdAt', 'expiresAt', 'rows'])
    && !s.active && s.paused === 'VERIFICATION_EXPIRED' && !s.ended
    && uuid(p.id) && bounded(p.turnId, 256) && same(p.context, s.context) && same(p.binding, s.binding)
    && uuid(p.executionId) && teachingSameUuid(p.executionId, s.executionId) && same(p.taskRef, s.taskRef)
    && fresh(p.createdAt, now, PLUGIN_LIMITS.pendingObservationMs) && expiry(p.expiresAt, now)
    && Date.parse(p.expiresAt) === Date.parse(p.createdAt) + PLUGIN_LIMITS.pendingObservationMs
    && Array.isArray(p.rows) && p.rows.length >= 1 && p.rows.length <= 4 && s.sources.length + p.rows.length <= PLUGIN_LIMITS.sources
    && p.rows.every(row => exact(row, ['turnId', 'source']) && row.turnId === p.turnId
      && exact(row.source, ['sourceId', 'channel', 'claimClass', 'role', 'text', 'sha256', 'observedAt', 'clientContextId', 'bindingPhase', 'executionId'])
      && uuid(row.source.sourceId) && row.source.channel === 'text' && row.source.claimClass === 'client_observed'
      && row.source.role === 'user' && typeof row.source.text === 'string' && row.source.text.trim().length > 0
      && teachingUtf8Bytes(row.source.text) <= PLUGIN_LIMITS.sourceBytes && row.source.sha256 === teachingSha256(row.source.text)
      && fresh(row.source.observedAt, now, PLUGIN_LIMITS.pendingObservationMs) && Date.parse(row.source.observedAt) >= Date.parse(p.createdAt)
      && teachingSameUuid(row.source.clientContextId, p.context.clientContextId) && row.source.bindingPhase === 'bound'
      && teachingSameUuid(row.source.executionId, p.executionId))
    && new Set(p.rows.map(row => row.source.sourceId.toLowerCase())).size === p.rows.length
    && new Set(p.rows.map(row => row.source.sha256)).size === p.rows.length
    && !p.rows.some(row => s.sources.some(old => teachingSameUuid(old.source.sourceId, row.source.sourceId)))
    && p.rows.reduce((n, row) => n + teachingUtf8Bytes(row.source.text), 0) <= 12288;
}
function freshInputAfterExpiryPause(s, event, now) {
  const resume = s.pauseRecovery;
  // This is a new live observation under the old local expiry pause, never a
  // recovery of the discarded Stop or an earlier missed user message.
  return event.hook_event_name === 'UserPromptSubmit' && event.stop_hook_active !== true
    && !s.pendingObservation && s.active === false && s.paused === 'VERIFICATION_EXPIRED' && !s.ended
    && s.account && s.selection && s.context && s.account.subject === s.context.subject && scopeEqual(s.selection, s.context)
    && Number.isFinite(Date.parse(s.account.checkedAt)) && Date.parse(s.account.checkedAt) <= now
    && Number.isFinite(Date.parse(s.selection.recheckAt))
    && exact(s.binding, ['bindingId', 'epoch']) && uuid(s.binding.bindingId) && Number.isSafeInteger(s.binding.epoch) && s.binding.epoch >= 1
    && uuid(s.executionId) && (s.taskRef === null || exact(s.taskRef, ['taskId', 'revision']) && uuid(s.taskRef.taskId)
      && Number.isSafeInteger(s.taskRef.revision) && s.taskRef.revision >= 1) && !s.discardedTurns.includes(event.turn_id)
    && exact(resume, ['token', 'context', 'binding', 'executionId', 'accountVerified', 'selectionVerified'])
    && uuid(resume.token) && typeof resume.accountVerified === 'boolean' && typeof resume.selectionVerified === 'boolean'
    && same(resume.context, s.context) && same(resume.binding, s.binding) && resume.executionId === s.executionId;
}
function deferObservation(dir, s, event, now) {
  const p = s.pendingObservation;
  need(event.hook_event_name === 'UserPromptSubmit' && event.stop_hook_active !== true
    && s.binding && uuid(s.executionId) && !s.ended && !s.pendingSelection && !s.pendingTransition && !unresolved(dir, s.context)
    && (p ? validPending(s, now) && p.turnId === event.turn_id && s.paused === 'VERIFICATION_EXPIRED'
      : !s.discardedTurns.includes(event.turn_id) && (s.active && !s.paused || freshInputAfterExpiryPause(s, event, now))), 'PENDING_OBSERVATION_INELIGIBLE');
  const text = event.prompt;
  need(typeof text === 'string' && text.trim().length > 0 && teachingUtf8Bytes(text) <= PLUGIN_LIMITS.sourceBytes, 'SOURCE_TEXT_UNAVAILABLE');
  canonicalTeachingJson(text);
  const textSha256 = teachingSha256(text);
  const old = [...s.sources, ...(p?.rows ?? [])].find(row => row.turnId === event.turn_id
    && row.source.role === 'user' && row.source.sha256 === textSha256);
  if (old) { need(old.source.text === text, 'SOURCE_EVENT_CONFLICT'); return; }
  need(s.sources.length + (p?.rows.length ?? 0) < PLUGIN_LIMITS.sources && (p?.rows.length ?? 0) < 4
    && (p?.rows.reduce((n, row) => n + teachingUtf8Bytes(row.source.text), 0) ?? 0) + teachingUtf8Bytes(text) <= 12288, 'SOURCE_LIMIT');
  if (!p) {
    pauseLocally(s, 'VERIFICATION_EXPIRED');
    s.pendingObservation = { id: randomUUID(), turnId: event.turn_id, context: structuredClone(s.context), binding: structuredClone(s.binding),
      executionId: s.executionId, taskRef: structuredClone(s.taskRef), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + PLUGIN_LIMITS.pendingObservationMs).toISOString(), rows: [] };
    s.discardedTurns = [...new Set([...s.discardedTurns, event.turn_id])].slice(-64);
  }
  s.pendingObservation.rows.push({ turnId: event.turn_id, source: { sourceId: randomUUID(), channel: 'text', claimClass: 'client_observed', role: 'user', text,
    sha256: textSha256, observedAt: new Date(now).toISOString(), clientContextId: s.context.clientContextId,
    bindingPhase: 'bound', executionId: s.executionId } });
  observationAudit(s, s.pendingObservation, 'captured_pending', new Date(now).toISOString());
}
// Only an observed local lifecycle pause can be resumed. Session reads never
// adopt a binding or resolve an original write; operation receipts own that.
function sessionResult(dir, s, call, data, now) {
  const bridge = call.arguments._aidesk, c = s.challenge;
  const opted = bridge.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT;
  const correctionOpted = bridge.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT;
  need(c && expiry(c.expiresAt, now) && bridge.challengeId === c.challengeId && bridge.nonce === c.nonce
    && bridge.keyId === c.keyId && same(bridge.context, c.context) && same(s.context, call.context), 'SESSION_CHALLENGE_INVALID');
  need(exact(data, ['protocol', 'status', 'scope', 'clientContextId', 'binding', 'sourceAvailability', 'localOperations',
    'localOperationsOrigin', 'capabilities']) && data.protocol === PLUGIN_PROTOCOL && ['ready', 'ended'].includes(data.status)
    && exact(data.scope, ['familyId', 'learnerId']) && data.scope.familyId === call.context.familyId
    && data.scope.learnerId === call.context.learnerId && teachingSameUuid(data.clientContextId, call.context.clientContextId)
    && same(data.localOperations, bridge.payload.localOperations)
    && data.localOperationsOrigin === 'signed_client_candidates_not_server_receipts'
    && exact(data.capabilities, ['immutableLocalOutbox', 'serverDiscovery', 'officialBinaryAttestation',
      ...(opted ? ['durableOperationDenial', 'explicitOperationCancellation'] : []),
      ...(correctionOpted ? ['correctionBasisContract'] : [])])
    && data.capabilities.immutableLocalOutbox === true && data.capabilities.serverDiscovery === true
    && data.capabilities.officialBinaryAttestation === false
    && (!opted || data.capabilities.durableOperationDenial === true && data.capabilities.explicitOperationCancellation === true)
    && (!correctionOpted || data.capabilities.correctionBasisContract === TEACHING_CORRECTION_BASIS_CONTRACT), 'SESSION_RESULT_INVALID');
  const b = data.binding, ended = data.status === 'ended';
  need(b === null || exact(b, ['bindingId', 'epoch', 'status']) && uuid(b.bindingId)
    && Number.isSafeInteger(b.epoch) && b.epoch >= 1 && ['active', 'ended'].includes(b.status), 'SESSION_BINDING_INVALID');
  need(ended === (b !== null && b.status === 'ended') && data.sourceAvailability === (ended ? 'stopped' : 'available'), 'SESSION_RESULT_INVALID');
  const bindingMatches = b === null ? s.binding === null : s.binding !== null
    && teachingSameUuid(b.bindingId, s.binding.bindingId) && b.epoch === s.binding.epoch && b.status === 'active';
  // An unknown start/end may have committed remotely. Its session projection is
  // informative only; the immutable operation receipt is still required.
  const pending = unresolved(dir, s.context);
  const pendingHere = pending && same(pending.context, call.context);
  const unknownStart = pendingHere && pending.action === 'start' && pending.request.expectedBinding === null && !ended;
  const unknownEnd = pendingHere && pending.action === 'end' && ended && b
    && teachingSameUuid(b.bindingId, pending.request.binding.bindingId) && b.epoch === pending.request.expectedEpoch + 1;
  need(bindingMatches || unknownStart || unknownEnd || s.ended && ended && same(b, s.endedBinding), 'SESSION_BINDING_MISMATCH');
  if (correctionOpted) {
    need(correctionAcknowledged(s), 'SESSION_CHALLENGE_INVALID');
    s.correctionCapability.ready = true;
  }
  if (ended) { discardObservation(s); s.active = false; if (!s.ended) { s.paused = 'SERVICE_ENDED'; s.pauseRecovery = null; } return; }
  need(!s.ended, 'SESSION_ENDED_MISMATCH');
  const resume = s.pauseRecovery;
  if (resumablePauses.has(s.paused) && resume?.accountVerified && resume.selectionVerified
    && uuid(resume.token) && call.recoveryToken === resume.token
    && same(resume.context, s.context) && same(resume.binding, s.binding) && resume.executionId === s.executionId
    && !s.pendingSelection && !pending && !s.pendingTransition && bindingMatches) {
    current(s, now, true);
    if (s.pendingObservation) {
      const p = s.pendingObservation;
      need(validPending(s, now) && call.observationId === p.id && call.turnId === p.turnId
        && Date.parse(s.account.checkedAt) >= Date.parse(p.createdAt), 'PENDING_OBSERVATION_UNVERIFIED');
      observationAudit(s, p, 'verified', new Date(now).toISOString());
      s.sources.push(...p.rows);
      observationAudit(s, p, 'released', new Date(now).toISOString());
      s.discardedTurns = s.discardedTurns.filter(turn => turn !== p.turnId); s.pendingObservation = null;
    }
    s.paused = null; s.pauseRecovery = null; s.active = true;
  }
}
function sourceIds(value, into = []) {
  if (Array.isArray(value)) { for (const child of value) sourceIds(child, into); }
  else if (object(value)) for (const [name, child] of Object.entries(value)) {
    if (name === 'sourceRefs' || name === 'purposeSourceRefs') {
      need(Array.isArray(child) && child.every(uuid), 'SOURCE_REFS_INVALID');
      for (const id of child) if (!into.some(old => teachingSameUuid(old, id))) into.push(id);
    } else sourceIds(child, into);
  }
  return into;
}
function sources(s, semantic, bootstrap = false) {
  const ids = sourceIds(semantic), output = [];
  if (bootstrap) for (const item of s.sources) if (item.source.bindingPhase === 'selected_pending_execution'
    && !s.submittedSourceIds.some(id => teachingSameUuid(id, item.source.sourceId))
    && !ids.some(id => teachingSameUuid(id, item.source.sourceId))) ids.push(item.source.sourceId);
  for (const id of ids) {
    const row = s.sources.find(item => teachingSameUuid(item.source.sourceId, id));
    need(row && teachingSameUuid(row.source.clientContextId, s.context.clientContextId), 'SOURCE_MISSING');
    if (s.submittedSourceIds.some(old => teachingSameUuid(old, id))) continue;
    need(bootstrap || row.source.bindingPhase === 'bound', 'PENDING_SOURCE_REGISTER_WITH_START');
    output.push(structuredClone(row.source));
  }
  need(output.length <= 4 && output.reduce((n, item) => n + teachingUtf8Bytes(item.text), 0) <= 12288, 'SOURCE_LIMIT');
  return output;
}
function observe(s, event, now) {
  current(s, now); const role = event.hook_event_name === 'UserPromptSubmit' ? 'user' : 'assistant';
  if (event.stop_hook_active === true) throw new SeamError('SYSTEM_CONTINUATION_NOT_USER_SOURCE');
  if (s.discardedTurns.includes(event.turn_id)) {
    // Only the first-ever selection has no prior learner output to confuse
    // with this Stop. A real scope transition quarantines the entire turn,
    // even after the new learner's handshake succeeds.
    if (role !== 'assistant' || s.initialAssistantTurn !== event.turn_id || !(s.assistantTurns ?? []).some(row => row.turnId === event.turn_id
      && teachingSameUuid(row.clientContextId, s.context.clientContextId))) return;
  }
  const text = role === 'user' ? event.prompt : event.last_assistant_message;
  need(typeof text === 'string' && text.trim().length > 0 && teachingUtf8Bytes(text) <= PLUGIN_LIMITS.sourceBytes, 'SOURCE_TEXT_UNAVAILABLE');
  canonicalTeachingJson(text);
  const textSha256 = teachingSha256(text);
  // A running host turn can receive several actual UserPromptSubmit events.
  // Preserve each different input; without a stable host message ID, an exact
  // same-turn repeat is idempotent and is not another independent observation.
  // Stop still has one final message per turn and fails closed on conflict.
  const existing = s.sources.find(row => row.turnId === event.turn_id && row.source.role === role
    && (role !== 'user' || row.source.sha256 === textSha256));
  if (existing) { need(existing.source.sha256 === textSha256 && existing.source.text === text, 'SOURCE_EVENT_CONFLICT'); return; }
  need(s.sources.length < PLUGIN_LIMITS.sources, 'LOCAL_SOURCE_LIMIT');
  s.sources.push({ turnId: event.turn_id, source: { sourceId: randomUUID(), channel: 'text', claimClass: 'client_observed', role, text,
    sha256: textSha256, observedAt: new Date(now).toISOString(), clientContextId: s.context.clientContextId,
    bindingPhase: s.executionId ? 'bound' : 'selected_pending_execution', executionId: s.executionId } });
  if (role === 'assistant' && s.initialAssistantTurn === event.turn_id) { s.initialAssistantTurn = null; s.assistantTurns = []; }
}
function business(s, action, a, now) {
  const contract = TEACHING_BUSINESS_CONTRACT;
  if (action === 'start') {
    need(exact(a, ['taskAction']) && s.loaded, 'FULL_LOAD_REQUIRED');
    if (s.capacityUsed) {
      need(s.capacityPhase?.status === 'complete' && s.capacityPhase.runId === s.contentRunId
        && same(s.capacityPhase.context, s.context), 'FULL_LOAD_REQUIRED');
      if (!s.executionId) capacityDeadline(s.capacityPhase, now);
    }
    if (s.loaded.profile === CAPACITY_PROFILE) need(s.capacityPhase?.status === 'complete'
      && s.capacityPhase.runId === s.contentRunId && s.capacityPhase.current?.loadId === s.loaded.loadId, 'FULL_LOAD_REQUIRED');
    return parseCurrentBusinessInput('start', { contract, operationId: randomUUID(), clientContextId: s.context.clientContextId,
      expectedBinding: s.binding, selected: { familyId: s.context.familyId, learnerId: s.context.learnerId, selectionAttemptId: s.context.selectionAttemptId },
      skillLoadRef: { contentRunId: s.contentRunId, releaseId: s.loaded.releaseId, teachingSkillSha256: s.loaded.teachingSkillSha256 },
      sources: sources(s, a.taskAction, true), taskAction: a.taskAction });
  }
  if (commitActions.has(action)) {
    need(s.binding && s.executionId && Object.hasOwn(a, 'dependencies'), 'BINDING_REQUIRED');
    const payload = { ...a }; delete payload.dependencies; delete payload.taskRef; delete payload.expectedSequence;
    return parseCurrentBusinessInput('commit', { contract, operationId: randomUUID(), binding: s.binding, executionId: s.executionId,
      taskRef: Object.hasOwn(a, 'taskRef') ? a.taskRef : s.taskRef,
      expected: { learnerSequence: Object.hasOwn(a, 'expectedSequence') ? a.expectedSequence : s.sequence, dependencies: a.dependencies },
      sources: sources(s, payload), action, payload });
  }
  if (action === 'end') { need(exact(a, []) && s.binding, 'BINDING_REQUIRED'); return parseCurrentBusinessInput('end', {
    contract, operationId: randomUUID(), binding: s.binding, expectedEpoch: s.binding.epoch, action: 'end', target: null }); }
  if (action === 'operation') { need(exact(a, ['operationId', 'part', 'offset', 'budgetBytes']), 'INPUT_INVALID'); return parseCurrentBusinessInput(action, { contract, ...a }); }
  if (action === 'discover') { need(exact(a, ['cursor', 'limit', 'budgetBytes']), 'INPUT_INVALID'); return parseCurrentBusinessInput(action, { contract, familyId: s.context.familyId, learnerId: s.context.learnerId, clientContextId: null, ...a }); }
  need(s.binding && s.executionId, 'BINDING_REQUIRED');
  need(action === 'context' ? exact(a, ['taskId', 'views', 'budgetBytes']) : exact(a, ['filter', 'cursor', 'limit', 'budgetBytes']), 'INPUT_INVALID');
  return parseCurrentBusinessInput(action, { contract, binding: s.binding, executionId: s.executionId, ...a });
}
function denialMatchesCall(call, proof) {
  try {
    const action = actionOf(call.name), wire = call.arguments._aidesk.payload.businessRequest;
    if (action !== call.action) return false;
    if (action === 'operation') {
      const query = parseTeachingBusinessInput('operation', wire);
      return teachingSameUuid(proof.operationId, query.operationId) && teachingSameUuid(proof.operationId, call.arguments.operationId);
    }
    const rpcAction = action === 'cancel_operation' ? call.arguments._aidesk.payload.cancellation?.originalAction
      : commitActions.has(action) ? 'commit' : action;
    if (!['start', 'commit', 'end'].includes(rpcAction)) return false;
    const request = action === 'cancel_operation' ? parseTeachingBusinessInput(rpcAction, wire)
      : unpackTeachingPluginRequest(rpcAction, wire, call.arguments);
    return proof.rpcAction === rpcAction && teachingSameUuid(proof.operationId, request.operationId)
      && proof.requestSha256 === teachingRequestSha256(request) && (action !== 'cancel_operation'
        || teachingSameUuid(proof.operationId, call.arguments.operationId)
          && proof.requestSha256 === call.arguments._aidesk.payload.cancellation.requestSha256);
  } catch { return false; }
}
function denialEntry(dir, call, value) {
  const correlation = correlateTeachingCall(call.name, call.arguments, call.context.subject);
  need(correlation && validTeachingWriteRejected(value, correlation) && validTeachingDenialProof(value.proof)
    && denialMatchesCall(call, value.proof), 'DENIAL_PROOF_INVALID');
  const proof = value.proof, entry = operation(dir, proof.operationId);
  if (!entry) return null; // A scoped remote read need not have a local outbox.
  need(entry.action === proof.rpcAction && entry.requestSha256 === proof.requestSha256
    && entry.context.familyId === proof.scope.familyId && entry.context.learnerId === proof.scope.learnerId
    && scopeEqual(entry.context, call.context), 'DENIAL_ORIGINAL_MISMATCH');
  need(entry.status !== 'completed', 'COMPLETED_OPERATION_IMMUTABLE');
  if (entry.status === 'rejected' && entry.rejectionResult) need(same(entry.rejectionResult.proof, proof), 'DENIAL_PROOF_CONFLICT');
  return entry;
}
function applyDenial(s, entry, proof) {
  if (!same(s.context, entry.context) || !teachingSameUuid(s.pendingTransition?.operationId, entry.operationId)) return;
  s.pendingTransition = null;
  if (entry.action === 'end') { s.active = false; s.paused = 'END_REJECTED'; s.pauseRecovery = null; }
  else if (['scope_denied', 'entry_denied', 'feature_unavailable', 'binding_stale', 'content_invalid',
    'content_missing', 'content_retired', 'content_incompatible'].includes(proof.kind)) {
    s.active = false; s.paused = 'SERVICE_REJECTED'; s.pauseRecovery = null; s.controlSession = null; discardCancellation(s);
  }
}
function reconcileDenial(dir, s, save) {
  if (!s.pendingTransition) return;
  const entry = operation(dir, s.pendingTransition.operationId);
  if (entry?.status !== 'rejected' || !entry.rejectionResult) return;
  need(typeof entry.rejectionCallKey === 'string' && /^[a-f0-9]{64}$/.test(entry.rejectionCallKey), 'DENIAL_CALL_UNAVAILABLE');
  const path = join(dir, 'calls', `${entry.rejectionCallKey}.json`), call = read(path, null);
  need(call && ['pending', 'rejected'].includes(call.outcome), 'DENIAL_CALL_UNAVAILABLE');
  const verified = denialEntry(dir, call, entry.rejectionResult);
  need(verified && same(s.context, verified.context), 'DENIAL_ORIGINAL_MISMATCH');
  applyDenial(s, verified, entry.rejectionResult.proof); save();
  call.outcome = 'rejected'; durable(path, call);
}
function accepted(dir, s, entry, receipt) {
  need(validTeachingBusinessResult(entry.action, receipt, entry.request), 'RECEIPT_INVALID');
  status(dir, entry, { status: 'completed', receipt });
  if (!s.context || !teachingSameUuid(entry.context.clientContextId, s.context.clientContextId)) return;
  // Reading an old completed operation never adopts its historical projection.
  // Only the outstanding transition prepared by this context may advance it.
  const pending = s.pendingTransition;
  if (!pending || !teachingSameUuid(pending.operationId, entry.operationId)) return;
  s.pendingTransition = null;
  if (!same(s.binding, pending.binding) || s.executionId !== pending.executionId
    || s.sequence < pending.sequence || receipt.committedSequence < s.sequence) return;
  for (const source of entry.request.sources ?? []) if (!s.submittedSourceIds.some(id => teachingSameUuid(id, source.sourceId))) s.submittedSourceIds.push(source.sourceId);
  if (entry.action === 'end') {
    s.active = false; s.ended = true; s.paused = 'ENDED'; s.pauseRecovery = null;
    s.endedBinding = { bindingId: receipt.data.bindingId, epoch: receipt.data.epoch, status: 'ended' }; s.binding = null; s.executionId = null;
    if (s.pendingSelection) newContext(s, s.pendingSelection);
  } else if (entry.action === 'start') {
    need(!s.ended, 'LATE_START_NOT_ADOPTED');
    s.binding = { bindingId: receipt.data.binding.bindingId, epoch: receipt.data.binding.epoch };
    s.executionId = receipt.executionId; s.taskRef = receipt.taskRef; s.sequence = receipt.committedSequence;
    if (s.pendingSelection) { s.active = false; s.paused = 'END_OLD_SCOPE_FIRST'; }
  } else if (s.executionId && teachingSameUuid(s.executionId, receipt.executionId)) {
    s.taskRef = receipt.taskRef; s.sequence = receipt.committedSequence;
  }
}

export async function processTeachingPluginEvent(event, { dataRoot = process.env.PLUGIN_DATA, now = Date.now() } = {}) {
  const name = toolName(event), action = actionOf(name), e = event.hook_event_name;
  const accountReceipt = ['aidesk_account_status', 'aidesk_entry_context'].includes(name);
  const known = accountReceipt || name === 'aidesk_check_selection';
  if (!action && !known && !['UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(e)) return {};
  const existing = dataRoot && existsSync(join(dataRoot, 'teaching-plugin-v1'));
  if (!existing && !(e === 'PostToolUse' && accountReceipt)) return action && e === 'PreToolUse' ? denial('CURRENT_ACCOUNT_REQUIRED') : {};
  try {
    need(bounded(event.session_id, 256), 'HOST_SESSION_REQUIRED');
    if (e !== 'SessionEnd') need(bounded(event.turn_id, 256), 'HOST_TURN_REQUIRED');
    const dir = directory(dataRoot, !existing);
    return await locked(dir, () => {
      const path = join(dir, 'sessions', `${sha(event.session_id)}.json`);
      let s = read(path, null);
      if (!s) { if (e !== 'PostToolUse' || !accountReceipt) return action && e === 'PreToolUse' ? denial('CURRENT_ACCOUNT_REQUIRED') : {}; s = emptySession(event.session_id); }
      need(s.format === 1 && s.hostSessionId === event.session_id, 'SESSION_CORRUPT');
      const save = () => durable(path, s);
      let preparing = null;
      let foreignRejection = false;
      const pendingAtEntry = !!s.pendingObservation;
      const capacityKey = bounded(event.tool_use_id) ? sha(`${event.session_id}\0${event.tool_use_id}`) : null;
      const capacityOutcome = verified => {
        const c = s.capacityPhase?.calls.find(c => c.key === capacityKey);
        if (c?.supportKey && c.outcome === 'unverified') observeCapacityOutcome(s.capacityPhase, capacityKey, verified);
      };
      const capacitySupportKey = (args, handshake = null) => teachingRequestSha256({ name, args, handshake,
        context: { subject: s.context?.subject ?? s.account?.subject ?? null, familyId: s.context?.familyId ?? null,
          learnerId: s.context?.learnerId ?? null, clientContextId: s.context?.clientContextId ?? null } });
      try {
        if (s.capacityPhase) checkCapacityLedger(s.capacityPhase);
        if (e === 'UserPromptSubmit') observeCapacityEntry(s, event.turn_id, now);
        // Account/selection/session rechecks during a load share its budget.
        // This accounting adds no authority and does not modify their inputs.
        const capacityEntryActive = capacityEntryIsActive(s);
        if (known && e === 'PreToolUse' && capacityEntryActive) {
          try {
            reserveCapacityCall(s.capacityPhase, { key: capacityKey,
              requestKey: teachingRequestSha256({ name, args: event.tool_input }),
              supportKey: capacitySupportKey(name === 'aidesk_check_selection'
                ? { familyId: event.tool_input?.familyId ?? null, learnerId: event.tool_input?.learnerId ?? null }
                : event.tool_input) }, now);
          } catch (error) {
            if (!(error instanceof CapacityClientError) || !['CAPACITY_TIME_BUDGET', 'CAPACITY_CALL_BUDGET', 'CAPACITY_BYTE_BUDGET', 'CAPACITY_RETRY_BUDGET'].includes(error.code)) throw error;
            // Close teaching loading first. Ordinary account functionality is
            // still available; it cannot revive or reset the failed phase.
            s.capacityPhase.status = 'failed'; s.capacityPhase.failedAt ??= now; s.capacityPhase.failure = error.code; s.loaded = null;
          }
          save();
        }
        const countedCapacityCall = s.capacityPhase?.calls.find(c => c.key === capacityKey);
        if (e === 'PostToolUse' && (capacityEntryActive && action !== 'start' || countedCapacityCall?.bytes === null)) {
          need(countedCapacityCall, 'CAPACITY_RESPONSE_UNACCOUNTED');
          observeCapacityBytes(s.capacityPhase, capacityKey, capacityResponseBytes(event), now,
            capacityEntryActive);
          save();
        }
        if (e === 'PostToolUse' && hasCapacityRecoveryCall(s, capacityKey)) {
          observeCapacityRecovery(s, capacityKey, capacityResponseBytes(event), now); save();
        }
        reconcileDenial(dir, s, save);
        if (s.cancelObservation && (!validCancellation(s, now) || s.cancelObservation.turnId !== event.turn_id
          || ['Stop', 'Interrupt', 'SessionEnd'].includes(e))) { discardCancellation(s); save(); }
        if (e === 'UserPromptSubmit') { observeCancellation(s, event, now); save(); }
        if (s.pendingObservation) {
          need(validPending(s, Math.min(now, Date.parse(s.pendingObservation.expiresAt) - 1)), 'PENDING_OBSERVATION_CORRUPT');
          if (event.turn_id !== s.pendingObservation.turnId || !expiry(s.pendingObservation.expiresAt, now)
            || ['Stop', 'Interrupt', 'SessionEnd'].includes(e) || action === 'end'
            || s.pendingSelection || s.pendingTransition || unresolved(dir, s.context)) discardObservation(s);
          // A dropped observation must remain dropped even if this event later
          // returns before the normal persistence point.
          save();
        }
        if (accountReceipt && e === 'PostToolUse') {
          const r = result(event);
          need(!r.error, 'ACCOUNT_UNVERIFIED');
          if (name === 'aidesk_entry_context') {
            // Only the original account evidence is adopted. The context is
            // required as part of the complete aggregate, never as a learner
            // selection or a replacement for domain/selection authorization.
            const context = r.data.context;
            need(exact(event.tool_input, []) && exact(r.data, ['account', 'checkedAt', 'context'])
              && object(context) && ['active', 'not_provisioned'].includes(context.accountStatus)
              && context.selectionRequired === true && object(context.accountAccess)
              && ['allowed', 'not_entitled', 'expired', 'suspended', 'conflict'].includes(context.accountAccess.status)
              && (context.accountAccess.expiresAt === null || Number.isFinite(Date.parse(context.accountAccess.expiresAt)))
              && Array.isArray(context.families), 'ENTRY_CONTEXT_UNVERIFIED');
            need(!s.account || Date.parse(r.data.checkedAt) >= Date.parse(s.account.checkedAt), 'ENTRY_ACCOUNT_STALE');
          }
          need(!r.error && r.data.account?.authenticated === true && r.data.account?.status === 'active'
            && bounded(r.data.account.subject, 256) && fresh(r.data.checkedAt, now, PLUGIN_LIMITS.accountFreshMs), 'ACCOUNT_UNVERIFIED');
          if (s.account && s.account.subject !== r.data.account.subject) {
            failCapacityPhase(s, 'CAPACITY_CONTEXT_CHANGED', now);
            const capacity = { capacityUsed: s.capacityUsed, capacityPhase: s.capacityPhase, capacityHistory: s.capacityHistory,
              capacityRecovery: s.capacityRecovery };
            discardObservation(s); discardCancellation(s);
            const cancelledTurns = s.cancelDiscardedTurns;
            const previouslySelected = !!s.context || s.hasSelectedContext === true;
            const discarded = s.discardedTurns;
            s = emptySession(event.session_id); s.hasSelectedContext = previouslySelected; s.discardedTurns = discarded; s.cancelDiscardedTurns = cancelledTurns;
            Object.assign(s, capacity);
          }
          if (s.pendingObservation) need(Date.parse(r.data.checkedAt) >= Date.parse(s.pendingObservation.createdAt), 'PENDING_ACCOUNT_STALE');
          s.account = { subject: r.data.account.subject, checkedAt: r.data.checkedAt }; s.controlSession = null; s.controlRoundId = randomUUID();
          if (s.cancelObservation) {
            const p = s.cancelObservation;
            if (!same(p.context, s.context) || s.account.subject !== p.context.subject) discardCancellation(s);
            else { p.verification = { token: randomUUID(), accountVerified: Date.parse(r.data.checkedAt) >= Date.parse(p.observation.observedAt), selectionVerified: false, sessionVerified: false }; }
          }
          if (resumablePauses.has(s.paused) && s.pauseRecovery && same(s.pauseRecovery.context, s.context)) {
            s.pauseRecovery.token = randomUUID(); s.pauseRecovery.accountVerified = true; s.pauseRecovery.selectionVerified = false;
            s.pauseRecovery.binding = structuredClone(s.binding); s.pauseRecovery.executionId = s.executionId;
          }
          capacityOutcome(true); save(); return {};
        }
        if (name === 'aidesk_check_selection') {
          if (e === 'PreToolUse') {
            // Rechecking the same learner does not change who an already
            // observed prompt belongs to. Keep its exact original source and
            // allow the actual assistant Stop later in this turn. A scope
            // transition discards the whole turn, including late Stops after
            // a successful handshake with the new learner.
            if (!s.context || s.ended || !scopeEqual({ subject: s.account?.subject, ...event.tool_input }, s.context)) {
              failCapacityPhase(s, 'CAPACITY_CONTEXT_CHANGED', now);
              discardObservation(s); discardCancellation(s); s.controlSession = null;
              s.discardedTurns = [...new Set([...s.discardedTurns, event.turn_id])].slice(-64);
              s.sources = s.sources.filter(row => row.turnId !== event.turn_id || s.submittedSourceIds.some(id => teachingSameUuid(id, row.source.sourceId)));
              if (s.context && !s.ended) { s.active = false; s.paused = 'SELECTION_CHANGE'; }
            }
            save(); return {};
          }
          if (e === 'PostToolUse') {
            const r = result(event), a = event.tool_input;
            need(!r.error && s.account && exact(a, ['familyId', 'learnerId', 'attemptId']) && uuid(a.attemptId)
              && r.data.status === 'checked' && r.data.subject === s.account.subject && r.data.attemptId === a.attemptId
              && r.data.family?.familyId === a.familyId && r.data.learner?.learnerId === a.learnerId
              && fresh(r.data.checkedAt, now, PLUGIN_LIMITS.accountFreshMs) && expiry(r.data.recheckAt, now), 'SELECTION_UNVERIFIED');
            const selected = { subject: r.data.subject, familyId: a.familyId, learnerId: a.learnerId, selectionAttemptId: a.attemptId, recheckAt: r.data.recheckAt };
            s.controlSession = null; s.controlRoundId = randomUUID();
            if (s.cancelObservation) {
              const p = s.cancelObservation;
              if (!scopeEqual(selected, p.context)) discardCancellation(s);
              else { p.verification.token = randomUUID(); p.verification.selectionVerified = p.verification.accountVerified
                && Date.parse(r.data.checkedAt) >= Date.parse(s.account.checkedAt); p.verification.sessionVerified = false; }
            }
            if (s.pendingObservation) need(s.pauseRecovery?.accountVerified && scopeEqual(selected, s.context)
              && Date.parse(r.data.checkedAt) >= Date.parse(s.account.checkedAt), 'PENDING_SELECTION_UNVERIFIED');
            if (s.context && !scopeEqual(selected, s.context) && (s.binding || unresolved(dir, s.context))) {
              s.pendingSelection = selected; s.active = false; s.paused = 'END_OLD_SCOPE_FIRST';
            }
            else if (!s.context || !scopeEqual(selected, s.context) || s.ended) newContext(s, selected, event.turn_id);
            else {
              s.selection = selected;
              if (resumablePauses.has(s.paused) && s.pauseRecovery?.accountVerified
                && same(s.pauseRecovery.context, s.context)) {
                s.pauseRecovery.token = randomUUID(); s.pauseRecovery.selectionVerified = true;
              }
            }
            capacityOutcome(true); save(); return s.pendingSelection ? notice(e, 'END_OLD_SCOPE_FIRST') : {};
          }
        }
        if (e === 'Interrupt' || e === 'SessionEnd') {
          pauseLocally(s, e.toUpperCase()); save(); return {};
        }
        if (e === 'UserPromptSubmit' || e === 'Stop') {
          if (e === 'UserPromptSubmit' && s.pendingObservation) {
            deferObservation(dir, s, event, now); save();
            return notice(e, 'CURRENT_VERIFICATION_EXPIRED_INPUT_QUARANTINED');
          }
          // Do not replace pending data discarded by this very event (new turn,
          // deadline or lifecycle boundary). Only a later genuinely new input
          // can start another observation under an unchanged pure expiry pause.
          if (!pendingAtEntry && freshInputAfterExpiryPause(s, event, now)
            && !s.pendingSelection && !s.pendingTransition && !unresolved(dir, s.context)) {
            deferObservation(dir, s, event, now); save();
            return notice(e, 'CURRENT_VERIFICATION_EXPIRED_INPUT_QUARANTINED');
          }
          if (!s.active || s.ended || s.paused) {
            if (e === 'UserPromptSubmit') { s.discardedTurns = [...new Set([...s.discardedTurns, event.turn_id])].slice(-64); save(); }
            return {};
          }
          try { current(s, now); }
          catch (error) {
            if (!(error instanceof SeamError && error.code === 'CURRENT_VERIFICATION_EXPIRED') || e !== 'UserPromptSubmit') throw error;
            // Only valid timestamps whose clock bound elapsed qualify; malformed
            // local evidence and known lifecycle/authority failures stay closed.
            need(Number.isFinite(Date.parse(s.account.checkedAt)) && Date.parse(s.account.checkedAt) <= now
              && Number.isFinite(Date.parse(s.selection.recheckAt)), 'CURRENT_SELECTION_REQUIRED');
            if (!s.binding || !uuid(s.executionId) || s.discardedTurns.includes(event.turn_id) || s.pendingTransition || unresolved(dir, s.context)) throw error;
            deferObservation(dir, s, event, now);
            if (!s.pendingObservation) throw error;
            save(); return notice(e, 'CURRENT_VERIFICATION_EXPIRED_INPUT_QUARANTINED');
          }
          observe(s, event, now); save(); return {};
        }
        if (!action || !['PreToolUse', 'PostToolUse'].includes(e)) return {};
        need(bounded(event.tool_use_id), 'TOOL_USE_ID_REQUIRED');
        const callPath = join(dir, 'calls', `${sha(`${event.session_id}\0${event.tool_use_id}`)}.json`);
        if (e === 'PreToolUse') {
          need(!existsSync(callPath), 'DUPLICATE_TOOL_EVENT');
          current(s, now, action === 'session' || readOnlyRecovery.has(action) || action === 'end' || action === 'cancel_operation');
          need(s.callCount < PLUGIN_LIMITS.calls, 'LOCAL_CALL_LIMIT');
          need(object(event.tool_input), 'INPUT_INVALID');
          const a = structuredClone(event.tool_input); delete a._aidesk; canonicalTeachingJson(a);
          // Check before business() creates an operation ID or any call/outbox is
          // persisted. Reads retain the existing strictly-unexpired contract.
          if (action === 'start' || commitActions.has(action) || action === 'end') {
            need(!unresolved(dir, s.context), 'UNKNOWN_ORIGINAL_OPERATION');
            need(!s.pendingTransition, 'ORIGINAL_TRANSITION_UNRESOLVED');
            need(typedWriteCapable(s), 'CALL_SESSION_FOR_WRITE_OUTCOME_CONTRACT');
            writeDispatchWindow(s, now);
          }
          const ownKey = key(dir, s.account.subject); let envelope;
          const payload = { businessRequest: null, contentRequest: null, sourcePage: null, localOperations: [] };
          const nearChallenge = !s.challenge || Date.parse(s.challenge.expiresAt) - now <= PLUGIN_LIMITS.writeDispatchWindowMs;
          const shortChecked = shortChallengeChecked(s);
          if (action === 'session' && (!typedWriteCapable(s) || !Object.hasOwn(s, 'correctionCapability')
            || nearChallenge && (!shortChecked || !expiry(s.challenge.expiresAt, now)))) {
            need(!shortChecked || !typedWriteCapable(s), 'CHALLENGE_REFRESH_RECHECK_REQUIRED');
            need(exact(a, []), 'INPUT_INVALID');
            // Legacy sessions retained a completed hello beside their challenge.
            // New pending hellos carry verification metadata and keep their ID.
            if (!s.hello || s.hello.resultContract !== TEACHING_WRITE_OUTCOME_CONTRACT || s.challenge && !s.helloVerification) {
              s.hello = { protocol: PLUGIN_PROTOCOL, kind: 'hello', resultContract: TEACHING_WRITE_OUTCOME_CONTRACT,
                correctionContract: TEACHING_CORRECTION_BASIS_CONTRACT, helloId: randomUUID(), keyId: ownKey.keyId,
                publicKey: ownKey.publicKey, context: s.context };
              s.helloVerification = { accountCheckedAt: s.account.checkedAt, selectionAttemptId: s.selection.selectionAttemptId };
            }
            envelope = s.hello;
          } else {
            need(s.challenge && expiry(s.challenge.expiresAt, now), 'CALL_SESSION_FOR_CHALLENGE');
            if (s.ended || s.paused) need(readOnlyRecovery.has(action) || action === 'end' || action === 'cancel_operation', 'CAPTURE_INACTIVE');
            if (action === 'session') {
              need(exact(a, []), 'INPUT_INVALID');
              // Server discovery owns completed history. The local index is
              // necessary only for intents whose arrival/outcome is unknown.
              const local = localOperations(dir, s.context).filter(row => row.status === 'prepared' || row.status === 'unknown');
              need(local.length <= PLUGIN_LIMITS.localOperations, 'LOCAL_DISCOVERY_LIMIT');
              payload.localOperations = local.map(row => ({ operationId: row.operationId, action: row.action, requestSha256: row.requestSha256,
                clientContextId: row.context.clientContextId, status: row.status === 'prepared' ? 'unknown' : row.status,
                // Optional diagnostic metadata; old outboxes remain recoverable.
                ...(typeof row.preparedAt === 'string' && row.preparedAt.length <= 32 && Number.isFinite(Date.parse(row.preparedAt))
                  && new Date(row.preparedAt).toISOString() === row.preparedAt ? { preparedAt: row.preparedAt } : {}) }));
            } else if (action === 'cancel_operation') {
              need(exact(a, ['operationId', 'quote']) && uuid(a.operationId) && typeof a.quote === 'string' && a.quote.trim().length > 0, 'CANCELLATION_INPUT_INVALID');
              need(typedWriteCapable(s), 'CALL_SESSION_FOR_WRITE_OUTCOME_CONTRACT'); writeDispatchWindow(s, now);
              need(validCancellation(s, now) && s.cancelObservation.turnId === event.turn_id && controlSessionCurrent(s, now), 'CURRENT_CANCELLATION_OBSERVATION_REQUIRED');
              const p = s.cancelObservation;
              need(p.verification.accountVerified && p.verification.selectionVerified && p.verification.sessionVerified
                && p.observation.text === a.quote, 'CANCELLATION_INTENT_UNVERIFIED');
              const original = operation(dir, a.operationId);
              need(original && scopeEqual(original.context, s.context) && ['start', 'commit', 'end'].includes(original.action), 'CANCELLATION_ORIGINAL_UNAVAILABLE');
              parseTeachingBusinessInput(original.action, original.request);
              payload.businessRequest = structuredClone(original.request);
              payload.cancellation = { originalAction: original.action, requestSha256: original.requestSha256, observation: structuredClone(p.observation) };
            } else if (action === 'sources') {
              need(exact(a, ['offset', 'limit']) && Number.isSafeInteger(a.offset) && a.offset >= 0
                && Number.isInteger(a.limit) && a.limit >= 1 && a.limit <= 4, 'INPUT_INVALID');
              const items = s.sources.slice(a.offset, a.offset + a.limit).map(row => structuredClone(row.source));
              need(items.reduce((n, item) => n + teachingUtf8Bytes(item.text), 0) <= 12288, 'SOURCE_LIMIT');
              const end = a.offset + items.length;
              payload.sourcePage = { offset: a.offset, limit: a.limit, items, nextOffset: end < s.sources.length ? end : null, total: s.sources.length };
            } else if (capacityActions.has(action)) {
              need(action === 'skill_begin' ? exact(a, ['restart']) && typeof a.restart === 'boolean'
                : action === 'skill_page' ? exact(a, ['pageIndex']) && Number.isInteger(a.pageIndex) && a.pageIndex >= 0 && a.pageIndex < 32
                  : exact(a, []), 'INPUT_INVALID');
              need(!unresolved(dir, s.context) && !s.pendingTransition, 'UNKNOWN_ORIGINAL_OPERATION');
              const previousPhaseId = s.capacityPhase?.phaseId;
              payload.contentRequest = capacityInput(s, action, a, now, event.turn_id);
              if (previousPhaseId && previousPhaseId !== s.capacityPhase.phaseId) capacityStorage(dir, event.session_id).clear();
              need(validTeachingSkillCapacityInput(action.slice(6), payload.contentRequest), 'CAPACITY_INPUT_INVALID');
            } else if (['load_skill', 'read_content_catalog', 'read_content'].includes(action)) {
              const scope = { familyId: s.context.familyId, learnerId: s.context.learnerId, coreContract: 'aidesk-content-v1' };
              let input;
              if (action === 'load_skill') {
                need(exact(a, ['metadataOnly']), 'INPUT_INVALID');
                need(s.loaded?.profile !== CAPACITY_PROFILE, 'CAPACITY_STATUS_REQUIRED');
                if (a.metadataOnly) need(s.loaded, 'FULL_LOAD_REQUIRED');
                if (s.capacityUsed && !s.loaded) need(s.capacityPhase?.status === 'loading' && s.capacityPhase.current?.legacy,
                  'CAPACITY_LEGACY_NOT_OFFERED');
                input = { ...scope, runId: s.contentRunId, releaseId: s.loaded?.releaseId ?? s.capacityPhase?.current?.legacy?.legacyReleaseId ?? null,
                  purpose: s.executionId ? 'continue' : 'new', metadataOnly: a.metadataOnly };
              } else {
                need(action === 'read_content_catalog' ? exact(a, ['releaseId', 'cursor', 'limit']) : exact(a, ['releaseId', 'resourceIds', 'metadataOnly']), 'INPUT_INVALID');
                input = action === 'read_content_catalog' ? { ...scope, ...a } : { ...scope, runId: s.contentRunId,
                  purpose: s.executionId && teachingSameUuid(a.releaseId, s.loaded?.releaseId) ? 'continue' : 'new', ...a };
              }
              need(validContentToolInput(`aidesk_${action === 'load_skill' ? 'load_teaching_skill' : action}`, input), 'CONTENT_INPUT_INVALID');
              if (action !== 'load_skill' && s.loaded?.profile === CAPACITY_PROFILE) {
                input.profile = CAPACITY_PROFILE;
                need(validTeachingSkillCapacityInput(action === 'read_content_catalog' ? 'catalog' : 'read', input), 'CAPACITY_INPUT_INVALID');
              }
              payload.contentRequest = input;
            } else if (['ids', 'text_digest', 'recover_request'].includes(action)) {
              if (action === 'ids') need(exact(a, ['count']) && Number.isInteger(a.count) && a.count >= 1 && a.count <= 16, 'INPUT_INVALID');
              if (action === 'text_digest') need(exact(a, ['text']) && typeof a.text === 'string' && a.text.length > 0 && teachingUtf8Bytes(a.text) <= 4096, 'INPUT_INVALID');
              if (action === 'recover_request') {
                need(exact(a, ['operationId', 'expectedSha256', 'budgetBytes']) && /^[a-f0-9]{64}$/.test(a.expectedSha256), 'INPUT_INVALID');
                parseTeachingBusinessInput('operation', { contract: TEACHING_BUSINESS_CONTRACT, operationId: a.operationId, part: 'request', offset: 0, budgetBytes: a.budgetBytes });
              }
            } else {
              const write = action === 'start' || commitActions.has(action) || action === 'end';
              if (write) {
                archiveTerminalOperations(dir);
                need(operationFiles(dir).length < PLUGIN_LIMITS.operations, 'LOCAL_OUTBOX_LIMIT');
              }
              const request = business(s, action, a, now);
              if (usesTeachingCorrectionBasis(commitActions.has(action) ? 'commit' : action, request)) {
                need(correctionBasisCapable(s), 'CORRECTION_BASIS_UNAVAILABLE');
              }
              payload.businessRequest = packTeachingPluginRequest(commitActions.has(action) ? 'commit' : action, request);
              if (write) {
                preparing = { protocol: PLUGIN_PROTOCOL, operationId: request.operationId, action: commitActions.has(action) ? 'commit' : action,
                  context: structuredClone(s.context), tool: name, semanticArguments: a, request, requestSha256: teachingRequestSha256(request), preparedAt: new Date(now).toISOString() };
              }
            }
            envelope = { protocol: PLUGIN_PROTOCOL, kind: 'signed', ...(typedWriteCapable(s) ? { resultContract: TEACHING_WRITE_OUTCOME_CONTRACT } : {}),
              ...(correctionAcknowledged(s) ? { correctionContract: TEACHING_CORRECTION_BASIS_CONTRACT } : {}), challengeId: s.challenge.challengeId, nonce: s.challenge.nonce,
              keyId: ownKey.keyId, context: s.context, callId: randomUUID(), tool: name, argumentsSha256: teachingRequestSha256(a), issuedAt: new Date(now).toISOString(), payload };
            envelope.signature = sign(null, Buffer.from(canonicalTeachingJson(envelope)), ownKey.privateKey).toString('base64url');
          }
          const updatedInput = { ...a, _aidesk: envelope };
          need(Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: updatedInput } })) <= 32768, 'HTTP_REQUEST_LIMIT');
          if (capacityEntryIsActive(s) && action !== 'start') {
            reserveCapacityCall(s.capacityPhase, { key: capacityKey,
              requestKey: teachingRequestSha256({ action, input: payload.contentRequest ?? a }),
              retryable: capacityActions.has(action) || action === 'load_skill',
              ...(['session', 'operation', 'recover_request', 'discover', 'sources', 'text_digest', 'ids',
                'context', 'evidence', 'read_content_catalog', 'read_content'].includes(action)
                ? { supportKey: capacitySupportKey(a, action === 'session' ? envelope.kind : null) } : {}) }, now);
            if (action === 'skill_complete') s.capacityPhase.current.completionPending = true;
            save(); // Unknown/crashed dispatch keeps its count and maximum reservation.
          }
          if (action === 'skill_status' && capacityRecoveryRequired(s, payload.contentRequest)) {
            reserveCapacityRecovery(s, capacityKey, now, payload.contentRequest); save();
          }
          if (preparing) {
            durable(join(dir, 'operations', `${preparing.operationId.toLowerCase()}.json`), preparing, true);
            status(dir, preparing, { status: 'prepared', receipt: null });
            s.pendingTransition = { operationId: preparing.operationId, binding: structuredClone(s.binding), executionId: s.executionId, sequence: s.sequence };
            if (action === 'end') { s.active = false; s.paused = 'END_PENDING'; }
          }
          if (action === 'cancel_operation') { discardCancellation(s); save(); }
          durable(callPath, { protocol: PLUGIN_PROTOCOL, name, action, toolUseId: event.tool_use_id, context: s.context,
            turnId: event.turn_id, observationId: s.pendingObservation?.id ?? null,
            controlRoundId: action === 'session' && envelope.kind === 'signed' ? s.controlRoundId ?? null : null,
            controlVerificationToken: action === 'session' && envelope.kind === 'signed' && s.cancelObservation?.turnId === event.turn_id
              && s.cancelObservation.verification.accountVerified && s.cancelObservation.verification.selectionVerified ? s.cancelObservation.verification.token : null,
            // Freeze the local adoption capability only after this pause's fresh
            // verification. Older in-flight session reads retain no such right.
            recoveryToken: action === 'session' && envelope.kind === 'signed' && resumablePauses.has(s.paused)
              && s.pauseRecovery?.accountVerified && s.pauseRecovery.selectionVerified && uuid(s.pauseRecovery.token)
              && !s.ended && !s.pendingSelection && !s.pendingTransition && payload.localOperations.length === 0 ? s.pauseRecovery.token : null,
            arguments: updatedInput, preparedAt: new Date(now).toISOString(), outcome: 'pending' }, true);
          s.callCount++; save();
          return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput } };
        }
        const call = read(callPath, null);
        need(call && call.name === name && call.toolUseId === event.tool_use_id && call.outcome === 'pending'
          && same(call.arguments, event.tool_input), 'POST_CALL_MISMATCH');
        const r = result(event), bridge = call.arguments._aidesk;
        const wire = bridge.payload?.businessRequest;
        const request = wire ? action === 'cancel_operation'
          ? parseTeachingBusinessInput(bridge.payload.cancellation?.originalAction, wire)
          : unpackTeachingPluginRequest(commitActions.has(action) ? 'commit' : action, wire, call.arguments) : null;
        const writeAction = request && (action === 'start' || commitActions.has(action) || action === 'end') ? commitActions.has(action) ? 'commit' : action : null;
        if (!r.error && r.data.status === 'rejected') {
          foreignRejection = !same(s.context, call.context);
          if (uuid(r.data.proof?.operationId)) {
            const original = operation(dir, r.data.proof.operationId);
            if (original && !same(s.context, original.context)) foreignRejection = true;
          }
          const entry = denialEntry(dir, call, r.data);
          if (entry) {
            // Only the server's durable operation fence is terminal, never an
            // attempt-only rejection or a locally invented initial-call claim.
            if (!entry.rejectionResult) status(dir, entry, { status: 'rejected', receipt: null,
              rejectionResult: structuredClone(r.data), rejectionCallKey: sha(`${event.session_id}\0${event.tool_use_id}`) });
            applyDenial(s, entry, r.data.proof); save();
          }
          capacityOutcome(!foreignRejection && same(s.context, call.context));
          call.outcome = 'rejected'; durable(callPath, call); save();
          return notice(e, 'ORIGINAL_OPERATION_REJECTED_NOT_SAVED');
        }
        if (r.error) {
          discardObservation(s); discardCancellation(s); s.controlSession = null;
          const kind = r.data.kind ?? r.data.error?.kind;
          if (writeAction) {
            const entry = operation(dir, request.operationId);
            const errorId = r.data.operationId ?? r.data.error?.operationId;
            need(!errorId || teachingSameUuid(errorId, entry.operationId), 'ERROR_OPERATION_MISMATCH');
            // A plain error is not the server's durable operation fence. It
            // cannot terminalize an old unknown or downgrade a completed fact.
            if (!['completed', 'rejected'].includes(entry.status)) status(dir, entry, { status: 'unknown', receipt: null });
          }
          const capacitySuperseded = capacityActions.has(action) && kind === 'content_retired' && !s.executionId
            && same(s.context, call.context) && s.capacityPhase?.current?.loadId === bridge.payload.contentRequest?.loadId;
          if (capacitySuperseded) {
            s.loaded = null;
            // This fixed package can no longer authorize new adoption. Its
            // load receipt (if completed) is retained, never a business write.
            if (s.capacityPhase.status !== 'failed') s.capacityPhase.current.completionPending = false;
          }
          if (!capacitySuperseded && (action === 'session' && knownRejections.has(kind)
            || ['authenticated_required', 'scope_denied', 'entry_denied', 'binding_stale', 'content_invalid', 'content_missing', 'content_retired', 'content_incompatible'].includes(kind))) {
            s.active = false; s.paused = 'SERVICE_REJECTED';
          }
          capacityOutcome(false); call.outcome = 'error'; durable(callPath, call); save(); return notice(e, 'OPERATION_NOT_CONFIRMED');
        }
        if (bridge.kind === 'hello') {
          const c = r.data.bridge;
          need(exact(r.data, ['protocol', 'status', 'bridge', 'ended'], [
            ...(bridge.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT ? ['resultContract'] : []),
            ...(bridge.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT ? ['correctionContract'] : [])])
            && (bridge.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT ? r.data.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT : !Object.hasOwn(r.data, 'resultContract'))
            && (!Object.hasOwn(r.data, 'correctionContract') || r.data.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT)
            && r.data.protocol === PLUGIN_PROTOCOL
            && r.data.status === 'challenge' && typeof r.data.ended === 'boolean'
            && exact(c, ['protocol', 'kind', 'challengeId', 'nonce', 'keyId', 'context', 'expiresAt']) && c.protocol === PLUGIN_PROTOCOL
            && c.kind === 'challenge' && uuid(c.challengeId) && /^[A-Za-z0-9_-]{43}$/.test(c.nonce)
            && c.keyId === bridge.keyId && same(c.context, bridge.context) && expiry(c.expiresAt, now)
            && Date.parse(c.expiresAt) <= now + 1800000 && same(s.context, bridge.context), 'CHALLENGE_INVALID');
          // Keep an unknown hello's original ID. A delayed older handshake may
          // repeat the current challenge but cannot replace a newer one.
          if (s.hello?.helloId === bridge.helloId) {
            s.challenge = c;
            s.writeOutcomeCapability = bridge.resultContract === TEACHING_WRITE_OUTCOME_CONTRACT
              ? { challengeId: c.challengeId, resultContract: TEACHING_WRITE_OUTCOME_CONTRACT } : null;
            s.correctionCapability = bridge.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT
              && r.data.correctionContract === TEACHING_CORRECTION_BASIS_CONTRACT
              ? { challengeId: c.challengeId, contract: TEACHING_CORRECTION_BASIS_CONTRACT, ready: false } : null;
            s.shortChallenge = Date.parse(c.expiresAt) - now <= PLUGIN_LIMITS.writeDispatchWindowMs
              ? { challengeId: c.challengeId, accountCheckedAt: s.helloVerification?.accountCheckedAt ?? null,
                selectionAttemptId: s.helloVerification?.selectionAttemptId ?? null } : null;
            s.hello = null; s.helloVerification = null;
          } else need(s.challenge && same(s.challenge, c), 'CHALLENGE_SUPERSEDED');
          if (r.data.ended) { discardObservation(s); s.active = false; s.paused = 'SERVICE_ENDED'; s.pauseRecovery = null; }
          else if (!s.ended && !s.paused) {
            s.active = true;
            if (s.initialAssistantTurn === event.turn_id) s.assistantTurns = [{ turnId: event.turn_id, clientContextId: s.context.clientContextId }];
          }
        } else if (action === 'cancel_operation') {
          const original = operation(dir, call.arguments.operationId);
          const query = { contract: TEACHING_BUSINESS_CONTRACT, operationId: call.arguments.operationId, part: 'receipt', offset: 0, budgetBytes: 24576 };
          need(original && scopeEqual(original.context, call.context) && validTeachingBusinessResult('operation', r.data, query)
            && r.data.status === 'completed' && r.data.receipt && r.data.requestSha256 === original.requestSha256, 'CANCELLATION_RESULT_INVALID');
          accepted(dir, s, original, r.data.receipt);
        } else if (request) {
          const rpcAction = commitActions.has(action) ? 'commit' : action;
          need(validTeachingBusinessResult(rpcAction, r.data, request), 'BUSINESS_RESULT_INVALID');
          if (writeAction) accepted(dir, s, operation(dir, request.operationId), r.data);
          else if (action === 'context') {
            need(r.data.scope.familyId === call.context.familyId && r.data.scope.learnerId === call.context.learnerId, 'CONTEXT_SCOPE_MISMATCH');
            if (same(s.context, call.context) && same(s.binding, request.binding) && teachingSameUuid(s.executionId, request.executionId))
              s.sequence = Math.max(s.sequence, r.data.snapshotSequence);
          }
          else if (action === 'operation' && r.data.status === 'completed' && r.data.receipt) {
            need(r.data.receipt.scope.familyId === call.context.familyId && r.data.receipt.scope.learnerId === call.context.learnerId, 'RECOVERY_SCOPE_MISMATCH');
            const old = operation(dir, request.operationId);
            if (old) { need(scopeEqual(old.context, call.context) && old.requestSha256 === r.data.requestSha256, 'RECOVERY_MISMATCH'); accepted(dir, s, old, r.data.receipt); }
          }
        } else if (action === 'session') {
          sessionResult(dir, s, call, r.data, now);
          current(s, now, true);
          if (uuid(s.controlRoundId) && call.controlRoundId === s.controlRoundId) s.controlSession = { context: structuredClone(s.context), challengeId: s.challenge.challengeId,
            accountCheckedAt: s.account.checkedAt, selectionAttemptId: s.selection.selectionAttemptId };
          if (call.controlRoundId === s.controlRoundId && s.cancelObservation && call.turnId === s.cancelObservation.turnId
            && call.controlVerificationToken === s.cancelObservation.verification.token
            && s.cancelObservation.verification.accountVerified && s.cancelObservation.verification.selectionVerified)
            s.cancelObservation.verification.sessionVerified = true;
        } else if (capacityActions.has(action)) {
          need(s.context && same(s.context, call.context), 'CAPACITY_LATE_RESULT');
          current(s, now);
          acceptCapacityResult(s, action, bridge.payload.contentRequest, r.data, now, capacityStorage(dir, event.session_id));
          if (s.capacityPhase.status === 'complete') { save(); capacityStorage(dir, event.session_id).clear(); }
        } else if (bridge.payload.contentRequest?.profile === CAPACITY_PROFILE) {
          need(validTeachingSkillCapacityResult(action === 'read_content_catalog' ? 'catalog' : 'read', r.data,
            bridge.payload.contentRequest), 'CAPACITY_RESULT_INVALID');
        } else if (bridge.payload.contentRequest) {
          const originalName = `aidesk_${action === 'load_skill' ? 'load_teaching_skill' : action}`;
          need(validContentResult(originalName, r.data, bridge.payload.contentRequest), 'CONTENT_RESULT_INVALID');
          if (action === 'load_skill') need(fresh(r.data.checkedAt, now, 30000), 'CONTENT_RESULT_STALE');
          if (action === 'load_skill' && call.arguments.metadataOnly === false && same(s.context, call.context)) {
            if (s.capacityUsed) need(bridge.payload.contentRequest.runId === s.contentRunId
              && same(s.capacityPhase?.context, s.context) && ['loading', 'complete'].includes(s.capacityPhase?.status)
              && s.capacityPhase.current?.legacy?.legacyReleaseId === r.data.releaseId, 'CAPACITY_LEGACY_MISMATCH');
            s.loaded = r.data;
            if (s.capacityPhase?.status === 'loading') {
              s.capacityPhase.status = 'complete'; s.capacityPhase.completedAt = now;
              save();
              capacityStorage(dir, event.session_id).clear();
            }
          }
        } else if (action === 'sources') {
          const expected = bridge.payload.sourcePage;
          need(['offset', 'limit', 'items', 'nextOffset', 'total'].every(k => same(r.data[k], expected[k])) && r.data.sourceAvailability === 'available', 'SOURCE_RESULT_INVALID');
        } else if (action === 'text_digest') {
          need(exact(r.data, ['text', 'sha256', 'bytes']) && r.data.text === call.arguments.text
            && r.data.sha256 === teachingSha256(r.data.text) && r.data.bytes === teachingUtf8Bytes(r.data.text), 'DIGEST_RESULT_INVALID');
        } else if (action === 'ids') {
          need(exact(r.data, ['ids']) && Array.isArray(r.data.ids) && r.data.ids.length === call.arguments.count
            && r.data.ids.every(uuid) && new Set(r.data.ids.map(id => id.toLowerCase())).size === r.data.ids.length, 'IDS_RESULT_INVALID');
        } else if (action === 'recover_request') {
          need(r.data.status === 'not_found' ? exact(r.data, ['status', 'terminal']) && r.data.terminal === false
            : exact(r.data, ['status', 'request', 'requestSha256']) && r.data.status === 'complete'
              && teachingSameUuid(r.data.request?.operationId, call.arguments.operationId)
              && r.data.requestSha256 === call.arguments.expectedSha256
              && teachingRequestSha256(r.data.request) === r.data.requestSha256, 'RECOVERY_RESULT_INVALID');
        }
        call.outcome = 'completed'; durable(callPath, call); save();
        // Preserve a completed original operation, but do not deliver its
        // late result as the newly selected learner's current response.
        if (action !== 'end') need(s.context && same(s.context, call.context), 'LATE_RESULT_NOT_CURRENT');
        capacityOutcome(true); save();
        return {};
      } catch (error) {
        if (e === 'PostToolUse') {
          try { capacityOutcome(false); } catch { /* Keep the original accounting/validation failure. */ }
        }
        if (e === 'PostToolUse' && action === 'skill_status') s.loaded = null;
        if (error instanceof CapacityClientError && ['CAPACITY_TIME_BUDGET', 'CAPACITY_CALL_BUDGET', 'CAPACITY_BYTE_BUDGET', 'CAPACITY_RETRY_BUDGET'].includes(error.code)) {
          if (s.capacityPhase) { s.capacityPhase.status = 'failed'; s.capacityPhase.failedAt ??= now; s.capacityPhase.failure = error.code; }
          s.loaded = null;
        }
        if (!foreignRejection) {
          discardObservation(s);
          if (!(e === 'UserPromptSubmit' && error instanceof SeamError && error.code === 'CURRENT_VERIFICATION_EXPIRED')) discardCancellation(s);
        }
        if (e === 'PreToolUse' && preparing && existsSync(join(dir, 'operations', `${preparing.operationId.toLowerCase()}.json`))) {
          try { status(dir, preparing, { status: 'rejected', receipt: null, localOutcome: 'not_dispatched' }); s.pendingTransition = null; }
          catch { /* Persistence failure remains unavailable, never a saved claim. */ }
        }
        if (e === 'PostToolUse' && action === 'session') {
          s.active = false; s.paused = 'SESSION_UNVERIFIED'; s.pauseRecovery = null;
          if (s.correctionCapability) s.correctionCapability.ready = false;
          s.controlSession = null; s.controlRoundId = randomUUID();
        }
        if (e === 'PostToolUse' && known) { s.active = false; s.paused = 'UNVERIFIED_SELECTION'; }
        if (['UserPromptSubmit', 'Stop'].includes(e)) {
          s.discardedTurns = [...new Set([...s.discardedTurns, event.turn_id])].slice(-64);
          s.initialAssistantTurn = null; s.assistantTurns = [];
          if (error instanceof SeamError && error.code === 'CURRENT_VERIFICATION_EXPIRED') pauseLocally(s, 'VERIFICATION_EXPIRED');
          else { s.active = false; s.paused = 'SOURCE_UNAVAILABLE'; s.pauseRecovery = null; }
        }
        try { save(); } catch { /* The outer fail-closed response still applies. */ }
        throw error;
      }
    });
  } catch (error) {
    const code = error instanceof SeamError || error instanceof CapacityClientError ? error.code : 'LOCAL_EVIDENCE_UNAVAILABLE';
    const reason = `AI书桌客户端未取得当前可用的可靠证据（${code}）；不能声称当前保存或来源已核验，原号及其已核历史回执保持。`;
    const capacityKnown = known && code.startsWith('CAPACITY_');
    return e === 'PreToolUse' && (action || capacityKnown) ? denial(code)
      : e === 'PostToolUse' && (action || capacityKnown) ? { decision: 'block', reason } : { systemMessage: reason };
  }
}

async function main() {
  const eventName = process.argv[3];
  need(process.argv[2] === '--hook' && ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd'].includes(eventName), 'UNSUPPORTED_MODE');
  const chunks = []; let count = 0;
  for await (const chunk of process.stdin) { count += chunk.length; need(count <= PLUGIN_LIMITS.inputBytes, 'INPUT_LIMIT'); chunks.push(chunk); }
  const event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  need(event.hook_event_name === eventName, 'EVENT_MISMATCH');
  console.log(JSON.stringify(await processTeachingPluginEvent(event)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.log(JSON.stringify(process.argv[3] === 'PreToolUse' ? denial('INVALID_HOOK_INPUT')
    : { systemMessage: 'AI书桌客户端来源事件不可核验；不得声称已保存，原号恢复记录保持。' }));
});
