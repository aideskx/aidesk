// Same-package owner for durable Codex exec processes. No model/body logs,
// credential access, automatic replay, private host storage or PID-based recovery.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual, createHmac } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { sha256 } from './contract.mjs';
import { withHostTaskScope } from './host-task-scope.mjs';
import { requestOwnedInterruption, classifyOwnedClose } from './host-process.mjs';
import { resolveHostNamespace, readStoredNamespace } from './host-thread-namespace.mjs';
import { buildDesktopEntryProof, projectDesktopEntryProof } from './host-desktop-entry.mjs';
import { verifyPrivateDirectory, ensurePrivateDirectory, readPrivateJson,
  writePrivateJsonExclusive, replacePrivateJson, createPrivateDirectoryExclusive,
  removePrivateJson } from './host-data-binding.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const TERMINAL = new Set(['completed', 'interrupted', 'failed', 'busy', 'unknown']);
const stamp = () => new Date().toISOString();
const need = (ok, kind) => { if (!ok) throw new Error(kind); };
const worker = fileURLToPath(new URL('../host-task-worker.mjs', import.meta.url));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const mac = (secret, value) => createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(value)).digest('hex');
const validMac = (secret, value, supplied) => HASH.test(supplied) && timingSafeEqual(Buffer.from(mac(secret, value), 'hex'), Buffer.from(supplied, 'hex'));
const PATH_EVIDENCE = new Set(['corroborated', 'not_fully_exposed', 'conflict']);

async function optional(path) {
  try { return await readPrivateJson(path); } catch (error) { if (error.kind === 'not_found') return null; throw error; }
}
async function save(path, value) {
  const old = await optional(path);
  return old ? replacePrivateJson(path, value, { expectedSha256: old.sha256 }) : writePrivateJsonExclusive(path, value);
}
async function runDirectory(directory, runId) {
  need(UUID.test(runId), 'invalid_run');
  await verifyPrivateDirectory(directory);
  await verifyPrivateDirectory(join(directory, 'runs'));
  const path = join(directory, 'runs', runId);
  await verifyPrivateDirectory(path);
  return path;
}
async function readRunState(path) {
  const state = (await readPrivateJson(join(path, 'state.json'))).value;
  if (state.namespace) {
    const intent = (await readPrivateJson(join(path, 'intent.json'))).value;
    need(state.intentSha256 === sha256(intent) && state.runId === intent.runId && state.contextId === intent.contextId
      && state.action === intent.action && state.sourceThreadIdSha256 === intent.sourceThreadIdSha256
      && sha256(state.namespace) === sha256(intent.namespace), 'run_intent_changed');
  }
  return state;
}
export function projectRun(state) {
  need(plain(state) && state.format === 1 && UUID.test(state.runId) && HASH.test(state.contextId)
    && ['starting', 'running', 'interrupt_requested', ...TERMINAL].includes(state.status), 'invalid_run_state');
  need(state.threadId === null || UUID.test(state.threadId), 'invalid_thread');
  const namespace = state.namespace ? { homeSha256: state.namespace.homeSha256, workspaceSha256: state.namespace.workspaceSha256,
    homeSelection: state.namespace.homeSelection, desktopNamespaceMatch: 'not_observed' } : null;
  if (namespace) need(HASH.test(namespace.homeSha256) && HASH.test(namespace.workspaceSha256)
    && ['host_default', 'CODEX_HOME'].includes(namespace.homeSelection), 'invalid_namespace');
  let namespaceReadback = null;
  if (state.namespaceReadback) {
    const proof = state.namespaceReadback;
    need(namespace && plain(proof) && ['stored', 'unknown'].includes(proof.status)
      && proof.contextId === state.contextId && proof.runId === state.runId && proof.threadId === state.threadId
      && HASH.test(proof.intentSha256) && proof.intentSha256 === state.intentSha256
      && HASH.test(proof.sourceThreadIdSha256) && proof.sourceThreadIdSha256 === state.sourceThreadIdSha256
      && proof.homeSha256 === namespace.homeSha256 && proof.workspaceSha256 === namespace.workspaceSha256
      && typeof proof.observedAt === 'string' && Number.isFinite(Date.parse(proof.observedAt))
      && [null, 'namespace_readback_failed', 'namespace_path_conflict'].includes(proof.reason)
      && (proof.readerReceiptSha256 === null || HASH.test(proof.readerReceiptSha256))
      && (proof.selectedHomePathEvidence === null || PATH_EVIDENCE.has(proof.selectedHomePathEvidence))
      && (proof.status === 'stored' ? proof.nativeStoredPair === true && HASH.test(proof.readerReceiptSha256)
        && proof.reason === null && ['corroborated', 'not_fully_exposed'].includes(proof.selectedHomePathEvidence)
        : proof.nativeStoredPair === false && proof.reason !== null), 'invalid_namespace_readback');
    namespaceReadback = { status: proof.status, contextId: proof.contextId, runId: proof.runId, threadId: proof.threadId,
      intentSha256: proof.intentSha256, sourceThreadIdSha256: proof.sourceThreadIdSha256,
      homeSha256: proof.homeSha256, workspaceSha256: proof.workspaceSha256, observedAt: proof.observedAt,
      nativeStoredPair: proof.nativeStoredPair, selectedHomePathEvidence: proof.selectedHomePathEvidence,
      readerReceiptSha256: proof.readerReceiptSha256, reason: proof.reason };
  }
  const entryProof = projectDesktopEntryProof({ proof: state.entryProof, state });
  return {
    format: 1, contextId: state.contextId, runId: state.runId, action: state.action,
    status: state.status, threadId: state.threadId,
    intentSha256: HASH.test(state.intentSha256 ?? '') ? state.intentSha256 : null,
    sourceThreadIdSha256: HASH.test(state.sourceThreadIdSha256 ?? '') ? state.sourceThreadIdSha256 : null,
    namespace, namespaceReadback,
    entryProof, entryUri: entryProof?.evidence.entryUri ?? null,
    createdAt: state.createdAt, updatedAt: state.updatedAt,
    turnCompleted: state.turnCompleted === true, exitCode: state.exitCode ?? null,
    exitSignal: state.exitSignal ?? null, reason: state.reason ?? null,
    interruptionMethod: state.interruptionMethod ?? null,
    processExitVerified: state.processExitVerified === true,
    gracefulShutdownVerified: false, descendantExitVerified: false,
    durableThreadState: namespaceReadback?.status === 'stored' ? 'stored_pair_readback' : 'requires_host_readback',
    toolCallsObserved: state.toolCallsObserved ?? 0,
    finalMessageSha256: state.finalMessageSha256 ?? null,
    // A CLI turn is not a verified business result or a currently accessible UI.
    goalCompleted: 'not_asserted', creationVisible: entryProof?.creationVisible ?? null, entryAccessible: 'unknown',
    automaticRetry: false,
  };
}

/** Internal API: caller validates the current Hook witness before entering.
 * Every create attempt has one immutable dispatch receipt. Resume has a new
 * run receipt but keeps exactly the previously observed thread ID. */
export async function startTaskRun(options) {
  return withHostTaskScope(options.dataRoot, options.scope, async () => {
    const prepared = (await readPrivateJson(join(options.directory, 'prepared.json'))).value;
    need(prepared.contextId === options.contextId && prepared.context?.contextSha256 === options.contextSha256
      && prepared.context.accountSubjectSha256 === options.scope.accountSubjectSha256
      && prepared.context.goalIdSha256 === options.scope.goalIdSha256, 'launch_context_changed');
    return startTaskRunUnlocked(options);
  });
}
async function startTaskRunUnlocked({ directory, contextId, contextSha256, sourceThreadId,
  prompt, executable, action = 'create', threadId = null, expectedOwnerRunId = null, codexHome = process.env.CODEX_HOME }) {
  need(HASH.test(contextId) && HASH.test(contextSha256) && UUID.test(sourceThreadId), 'invalid_context');
  need(typeof prompt === 'string' && prompt.trim() && Buffer.byteLength(prompt) <= 65536, 'invalid_prompt');
  need(typeof executable === 'string' && resolve(executable) === executable, 'invalid_executable');
  need(action === 'create' && threadId === null && expectedOwnerRunId === null
    || action === 'resume' && UUID.test(threadId) && threadId !== sourceThreadId && UUID.test(expectedOwnerRunId), 'invalid_action');
  await verifyPrivateDirectory(directory);
  const runId = randomUUID(), lockPath = join(directory, 'execution.lock');
  // A stranded lock is an unknown outcome, never an invitation to repeat create.
  const ownedLock = await writePrivateJsonExclusive(lockPath, { format: 1, runId, at: stamp() });
  const runs = join(directory, 'runs');
  let handoffStarted = false;
  try {
    await ensurePrivateDirectory(runs);
    const workspace = join(directory, 'workspace'); await ensurePrivateDirectory(workspace);
    // Only an internal caller can select this test seam. The MCP schema never
    // accepts a home/path; production resolves its forwarded CODEX_HOME/default.
    const namespace = await resolveHostNamespace({ workspace, codexHome });
    const prior = await optional(join(directory, 'current-run.json'));
    if (action === 'create') need(prior === null, 'creation_already_attempted');
    else {
      need(prior && UUID.test(prior.value.runId), 'original_task_missing');
      // Access was consumed for this exact run, not any later turn of the same
      // thread. Keep the comparison inside the scope and execution locks.
      need(prior.value.runId === expectedOwnerRunId, 'owner_task_changed');
      const previousDir = await runDirectory(directory, prior.value.runId);
      const previous = await readRunState(previousDir);
      need(previous.runId === expectedOwnerRunId && previous.contextId === contextId, 'owner_task_changed');
      need(previous.namespace?.homeSha256 === namespace.homeSha256 && previous.namespace?.workspaceSha256 === namespace.workspaceSha256,
        'host_namespace_changed');
      // No auto recovery from a lost worker; retain its exact original identity.
      need(TERMINAL.has(previous.status) && previous.status !== 'unknown' && previous.threadId === threadId, 'task_not_resumable');
    }
    const path = join(runs, runId);
    await createPrivateDirectoryExclusive(path);
    const intent = { format: 1, runId, contextId, contextSha256, action, threadId,
      sourceThreadIdSha256: sha256(sourceThreadId), promptSha256: sha256(prompt),
      executable, namespace, createdAt: stamp(), automaticRetry: false };
    handoffStarted = true;
    if (action === 'create') await writePrivateJsonExclusive(join(directory, 'dispatch.json'), intent);
    await writePrivateJsonExclusive(join(path, 'intent.json'), intent);
    const initial = { ...intent, intentSha256: sha256(intent), namespaceReadback: null, status: 'starting', updatedAt: stamp(), turnCompleted: false,
      exitCode: null, exitSignal: null, toolCallsObserved: 0, finalMessageSha256: null, reason: null };
    await writePrivateJsonExclusive(join(path, 'state.json'), initial);
    await save(join(directory, 'current-run.json'), { format: 1, runId });
    const child = spawn(process.execPath, [worker], { detached: true, windowsHide: true,
      env: { ...process.env, CODEX_HOME: namespace.home },
      stdio: ['pipe', 'ignore', 'ignore'], shell: false });
    const spawned = new Promise((res, rej) => { child.once('spawn', res); child.once('error', rej); });
    child.stdin.on('error', () => { /* Worker status, not resubmission, resolves delivery. */ });
    await spawned;
    child.stdin.end(JSON.stringify({ directory, runId, prompt, sourceThreadId }));
    child.unref();
    return projectRun(initial);
  } catch (error) {
    if (!handoffStarted) {
      await removePrivateJson(lockPath, { expectedSha256: ownedLock.sha256 });
      throw error;
    }
    // The immutable lock/intent preserves the ambiguous handoff. Never dispatch
    // a replacement because this API failed after a local write or spawn.
    throw new Error('dispatch_not_confirmed', { cause: error });
  }
}

async function requestControl(path, message) {
  const control = (await readPrivateJson(join(path, 'control.json'))).value;
  need(plain(control) && control.format === 1 && UUID.test(control.runId)
    && HASH.test(control.secret) && Number.isSafeInteger(control.port) && control.port >= 1 && control.port <= 65535, 'invalid_control');
  return new Promise((resolveRequest, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: control.port });
    let buffer = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; socket.destroy();
      if (error) reject(error); else resolveRequest(value);
    };
    socket.setTimeout(1500, () => finish(new Error('worker_unreachable')));
    socket.on('error', () => finish(new Error('worker_unreachable')));
    const request = { runId: control.runId, action: message.action, nonce: randomBytes(32).toString('hex') };
    socket.on('connect', () => socket.write(JSON.stringify({ request, mac: mac(control.secret, request) }) + '\n'));
    socket.setEncoding('utf8'); socket.on('data', chunk => {
      buffer += chunk; if (Buffer.byteLength(buffer) > 16384) return finish(new Error('invalid_control_response'));
      if (!buffer.includes('\n')) return;
      try {
        const envelope = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))), response = envelope.response;
        need(validMac(control.secret, response, envelope.mac) && response.runId === control.runId
          && response.action === request.action && response.nonce === request.nonce, 'invalid_control_response');
        finish(null, response);
      }
      catch { finish(new Error('invalid_control_response')); }
    });
    socket.on('end', () => { if (!settled) finish(new Error('worker_unreachable')); });
  });
}
export async function readTaskRun(directory) {
  await verifyPrivateDirectory(directory);
  const pointer = (await readPrivateJson(join(directory, 'current-run.json'))).value;
  const path = await runDirectory(directory, pointer.runId);
  const state = await readRunState(path);
  const projected = projectRun(state);
  if (TERMINAL.has(state.status)) return { ...projected,
    readyForResume: state.status !== 'unknown' && await optional(join(directory, 'execution.lock')) === null };
  try {
    const response = await requestControl(path, { action: 'read' });
    return { ...projectRun(response.state), workerReachable: true };
  } catch {
    // Read never overwrites a possibly still-live worker's state.
    return { ...projected, status: 'unknown', lastObservedStatus: projected.status,
      reason: 'worker_unreachable', workerReachable: false };
  }
}
export async function interruptTaskRun({ dataRoot, scope, directory, expectedOwnerRunId, threadId }) {
  need(UUID.test(expectedOwnerRunId) && UUID.test(threadId), 'invalid_run');
  return withHostTaskScope(dataRoot, scope, async () => {
    await verifyPrivateDirectory(directory);
    const pointer = (await readPrivateJson(join(directory, 'current-run.json'))).value;
    need(pointer.runId === expectedOwnerRunId, 'owner_task_changed');
    const path = await runDirectory(directory, expectedOwnerRunId);
    const state = await readRunState(path);
    need(state.runId === expectedOwnerRunId && state.threadId === threadId, 'owner_task_changed');
    if (TERMINAL.has(state.status)) return { ...projectRun(state), interruptSent: false };
    const response = await requestControl(path, { action: 'interrupt' });
    return { ...projectRun(response.state), interruptSent: response.interruptSent === true };
  });
}

// Testable stream reducer. Only host JSONL events can supply the thread identity.
export function reduceHostEvent(state, event, sourceThreadId) {
  need(plain(event) && typeof event.type === 'string', 'invalid_host_event');
  const next = { ...state, updatedAt: stamp() };
  if (event.type === 'thread.started') {
    need(UUID.test(event.thread_id) && event.thread_id !== sourceThreadId, 'invalid_host_thread');
    need(next.threadId === null || next.threadId === event.thread_id, 'host_thread_changed');
    next.threadId = event.thread_id; next.status = 'running';
  } else if (event.type === 'turn.started') {
    need(next.threadId !== null, 'missing_host_thread'); next.status = 'running'; next.turnCompleted = false;
  } else if (event.type === 'turn.completed') {
    need(next.threadId !== null, 'missing_host_thread'); next.turnCompleted = true;
  } else if (event.type === 'turn.failed' || event.type === 'error') {
    next.reason = 'host_turn_failed'; next.turnCompleted = false;
  } else if (event.type === 'item.started' && ['mcp_tool_call', 'command_execution'].includes(event.item?.type)) {
    next.toolCallsObserved += 1;
  } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
    next.finalMessageSha256 = sha256(event.item.text);
  }
  return next;
}

export async function runWorker({ directory, runId, prompt, sourceThreadId }) {
  const path = await runDirectory(directory, runId);
  const intent = (await readPrivateJson(join(path, 'intent.json'))).value;
  need(intent.runId === runId && intent.promptSha256 === sha256(prompt) && intent.sourceThreadIdSha256 === sha256(sourceThreadId), 'worker_intent_mismatch');
  need(UUID.test(sourceThreadId) && ['create', 'resume'].includes(intent.action), 'invalid_worker_input');
  let state = await readRunState(path);
  projectRun(state); need(state.status === 'starting', 'worker_already_started');
  need(state.intentSha256 === sha256(intent), 'worker_intent_mismatch');
  const namespace = await resolveHostNamespace({ workspace: join(directory, 'workspace') });
  need(namespace.home === intent.namespace?.home && namespace.workspace === intent.namespace?.workspace
    && namespace.homeSha256 === intent.namespace?.homeSha256 && namespace.workspaceSha256 === intent.namespace?.workspaceSha256,
    'worker_namespace_mismatch');
  const lock = (await readPrivateJson(join(directory, 'execution.lock'))).value;
  need(lock.runId === runId, 'worker_lock_mismatch');
  // This claim prevents a second worker from replaying the same launch payload.
  await writePrivateJsonExclusive(join(path, 'worker-started.json'), { format: 1, runId, at: stamp() });
  let queue = Promise.resolve(), persistedState = state, child = null, closed = null, interruption = null, protocolFailure = null, stderrTail = '', busy = false;
  const persist = () => {
    const snapshot = { ...state };
    queue = queue.then(async () => { await save(join(path, 'state.json'), snapshot); persistedState = snapshot; });
    return queue;
  };
  const interrupt = () => {
    if (!child || interruption) return false;
    const request = requestOwnedInterruption(child);
    if (!request.requested) return false;
    interruption = request;
    state = { ...state, status: 'interrupt_requested', interruptionMethod: request.method, updatedAt: stamp() };
    void persist().catch(() => {}); return true;
  };
  const secret = randomBytes(32).toString('hex'), sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {}); socket.setTimeout(1500, () => socket.destroy());
    socket.setEncoding('utf8'); let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk; if (Buffer.byteLength(buffer) > 2048) return socket.destroy();
      if (!buffer.includes('\n')) return;
      try {
        const envelope = JSON.parse(buffer.slice(0, buffer.indexOf('\n'))), input = envelope.request;
        need(plain(input) && input.runId === runId && HASH.test(input.nonce) && validMac(secret, input, envelope.mac), 'invalid_control');
        need(['read', 'interrupt'].includes(input.action), 'invalid_control');
        const interruptSent = input.action === 'interrupt' && interrupt();
        // A returned identity must already satisfy the next caller's disk-based
        // owner check. Signal delivery is separate from its persisted status.
        const response = { runId, action: input.action, nonce: input.nonce, state: projectRun(persistedState), interruptSent };
        socket.end(JSON.stringify({ response, mac: mac(secret, response) }) + '\n');
      } catch { socket.destroy(); }
    });
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  try {
    await writePrivateJsonExclusive(join(path, 'control.json'), { format: 1, runId, port: server.address().port, secret });
    const args = intent.action === 'create'
      ? ['exec', '--json', '--skip-git-repo-check', '-']
      : ['exec', 'resume', '--json', '--skip-git-repo-check', intent.threadId, '-'];
    child = spawn(intent.executable, args, { cwd: namespace.workspace, env: { ...process.env, CODEX_HOME: namespace.home }, shell: false,
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = ''; const decoder = new StringDecoder('utf8');
    const invalid = kind => { protocolFailure ??= kind; interrupt(); };
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > 8 * 1024 * 1024) { invalid('host_event_too_large'); continue; }
        try { state = reduceHostEvent(state, JSON.parse(line), sourceThreadId); void persist().catch(() => invalid('state_write_failed')); }
        catch { invalid('invalid_host_events'); }
      }
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) { buffer = ''; invalid('host_event_too_large'); }
    });
    child.stderr.on('data', chunk => {
      // Only classify the observed host writer conflict; no raw stderr retained.
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096);
      busy ||= /already has an active writer|active writer.*already|thread.*currently.*running/iu.test(stderrTail);
    });
    child.stdin.on('error', () => { protocolFailure ??= 'prompt_delivery_unknown'; });
    child.on('error', () => { protocolFailure ??= 'host_spawn_failed'; });
    closed = new Promise(res => child.once('close', (code, signal) => res({ code, signal })));
    child.stdin.end(prompt);
    const exit = await closed;
    buffer += decoder.end(); if (buffer.trim()) protocolFailure ??= 'incomplete_host_event';
    await queue;
    const observedExit = classifyOwnedClose({ request: interruption, ...exit, protocolFailure,
      turnCompleted: state.turnCompleted && !state.reason && state.threadId !== null });
    const status = !protocolFailure && busy && exit.code !== 0 ? 'busy' : observedExit.status;
    state = { ...state, ...observedExit, status, updatedAt: stamp(),
      reason: protocolFailure ?? (busy && exit.code !== 0 ? 'host_active_writer' : state.reason) };
    await persist();
    // Startup can synchronize host state. Keep the one readback inside this
    // authorized dispatch, after the exact owned child closes and before the
    // execution lock is released. Public reads only consume this saved proof.
    if (state.threadId !== null) {
      const base = { contextId: intent.contextId, runId, threadId: state.threadId, intentSha256: sha256(intent),
        sourceThreadIdSha256: intent.sourceThreadIdSha256, homeSha256: namespace.homeSha256, workspaceSha256: namespace.workspaceSha256 };
      try {
        const receipt = await readStoredNamespace({ executable: intent.executable, namespace, sourceThreadId, childThreadId: state.threadId });
        need(receipt.parent.id === sourceThreadId && receipt.child.id === state.threadId
          && receipt.homeSha256 === namespace.homeSha256 && receipt.workspaceSha256 === namespace.workspaceSha256,
          'namespace_receipt_mismatch');
        state.namespaceReadback = { ...base, status: receipt.nativeStoredPair ? 'stored' : 'unknown', observedAt: receipt.observedAt,
          nativeStoredPair: receipt.nativeStoredPair, selectedHomePathEvidence: receipt.selectedHomePathEvidence,
          readerReceiptSha256: receipt.receiptSha256, reason: receipt.nativeStoredPair ? null : 'namespace_path_conflict' };
      } catch {
        state.namespaceReadback = { ...base, status: 'unknown', observedAt: stamp(), nativeStoredPair: false,
          selectedHomePathEvidence: null, readerReceiptSha256: null, reason: 'namespace_readback_failed' };
      }
      state.entryProof = await buildDesktopEntryProof({ intent, state, namespace });
      state.updatedAt = stamp(); await persist();
    }
    // Terminal status plus exact owner lock permits the next same-ID resume.
    const currentLock = await readPrivateJson(join(directory, 'execution.lock'));
    need(currentLock.value.runId === runId, 'worker_lock_changed');
    await removePrivateJson(join(directory, 'execution.lock'), { expectedSha256: currentLock.sha256 });
  } catch (error) {
    // A failed supervisor must not silently leave its owned CLI working after
    // the control channel is gone. Persisted identity remains for reconciliation.
    if (child && child.exitCode === null && child.signalCode === null) {
      interrupt();
      await closed;
    }
    throw error;
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(res => server.close(res));
    const control = await optional(join(path, 'control.json'));
    if (control?.value.runId === runId) await removePrivateJson(join(path, 'control.json'), { expectedSha256: control.sha256 });
  }
}
