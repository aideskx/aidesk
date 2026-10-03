// Exact-ID stored-thread reader for the already-authorized worker dispatch.
// Import and the public read tool never launch host commands.
// Internal functions are not MCP arguments. The caller supplies owner-selected IDs.
import { spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => createHash('sha256').update(value).digest('hex');
export class NamespaceReadError extends Error {
  constructor(kind, details = {}) { super(`host_thread_namespace:${kind}`); this.kind = kind; this.details = details; }
}
const fail = kind => { throw new NamespaceReadError(kind); };
const need = (value, kind) => { if (!value) fail(kind); };
const absolute = value => typeof value === 'string' && !value.includes('\0') && isAbsolute(value) && value === resolve(value);
const under = (root, path) => {
  const part = relative(root, path);
  return part !== '' && part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

/** Resolve only environment-selected home and the owner workspace. Never open
 * auth/config/rollout/SQLite. A directory alias is canonicalized, not copied. */
export async function resolveHostNamespace({ workspace, codexHome = process.env.CODEX_HOME, userHome = homedir() }, deps = {}) {
  const real = deps.realpath ?? realpath, inspect = deps.stat ?? stat;
  need(absolute(workspace) && absolute(userHome), 'invalid_namespace_input');
  const requested = codexHome === undefined ? join(userHome, '.codex') : codexHome;
  need(absolute(requested), 'invalid_codex_home');
  try {
    const [home, cwd] = await Promise.all([real(requested), real(workspace)]);
    need(absolute(home) && absolute(cwd), 'invalid_namespace_path');
    const [homeStat, cwdStat] = await Promise.all([inspect(home), inspect(cwd)]);
    need(homeStat.isDirectory() && cwdStat.isDirectory(), 'namespace_not_directory');
    return Object.freeze({ home, workspace: cwd, homeSha256: hash(home), workspaceSha256: hash(cwd),
      homeSelection: codexHome === undefined ? 'host_default' : 'CODEX_HOME',
      desktopNamespaceMatch: 'not_observed' });
  } catch (error) {
    if (error instanceof NamespaceReadError) throw error;
    fail(error?.code === 'ENOENT' ? 'namespace_not_found' : 'namespace_unavailable');
  }
}

/** Extract metadata only. Official thread.path is optional and UNSTABLE; it is
 * corroboration, never a private-store interface or a prerequisite for read. */
export function projectStoredThread(thread, { expectedId, namespace, expectedWorkspace = null }) {
  need(object(thread) && UUID.test(expectedId) && thread.id === expectedId, 'thread_identity_mismatch');
  need(thread.ephemeral === false, 'thread_not_persistent');
  need(absolute(thread.cwd), 'thread_workspace_unknown');
  if (expectedWorkspace !== null) need(thread.cwd === expectedWorkspace, 'child_workspace_mismatch');
  const pathEvidence = thread.path === undefined || thread.path === null ? 'not_exposed'
    : !absolute(thread.path) ? 'invalid'
      : under(namespace.home, thread.path) ? 'inside_selected_home' : 'outside_selected_home';
  const status = object(thread.status) && ['notLoaded', 'idle', 'active', 'systemError'].includes(thread.status.type)
    ? thread.status.type : 'unknown';
  return Object.freeze({ id: thread.id, readMethod: 'thread/read', includeTurns: false,
    ephemeral: false, storedReadSucceeded: true, cwdSha256: hash(thread.cwd),
    workspaceMatchesOwner: expectedWorkspace === null ? null : true,
    pathEvidence, status,
    createdAt: Number.isSafeInteger(thread.createdAt) ? thread.createdAt : null,
    updatedAt: Number.isSafeInteger(thread.updatedAt) ? thread.updatedAt : null });
}

/** Help text is evidence of a command surface, not evidence that one task is
 * resumable now or is currently displayed. Obtaining help is caller-owned. */
export function inspectNativeResumeSurface({ execHelp, execResumeHelp, interactiveResumeHelp }) {
  const exec = typeof execHelp === 'string' && execHelp.includes('--json') && execHelp.includes('--skip-git-repo-check');
  const resume = typeof execResumeHelp === 'string' && execResumeHelp.includes('SESSION_ID') && execResumeHelp.includes('--json');
  const interactive = typeof interactiveResumeHelp === 'string' && interactiveResumeHelp.includes('SESSION_ID');
  return Object.freeze({ execJson: exec, execResumeById: resume, interactiveResumeById: interactive,
    nativeContinuationSurface: exec && resume && interactive,
    actualTaskResumed: false, desktopEntryObserved: false });
}

/** One fresh app-server process; initialize, read actual source, read actual
 * child, then EOF. Never start/resume a thread, authenticate or send a turn.
 * Startup itself may synchronize host state: read-only RPC is not FS read-only.
 * deps.spawn is solely internal test injection, never an exposed tool argument. */
export async function readStoredNamespace({ executable, namespace, sourceThreadId, childThreadId,
  timeoutMs = 15_000, maxBytes = 1_048_576 }, deps = {}) {
  need(absolute(executable) && object(namespace) && absolute(namespace.home) && absolute(namespace.workspace), 'invalid_reader_input');
  need(UUID.test(sourceThreadId) && UUID.test(childThreadId) && sourceThreadId !== childThreadId, 'invalid_thread_pair');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 30_000, 'invalid_timeout');
  need(Number.isSafeInteger(maxBytes) && maxBytes >= 1024 && maxBytes <= 1_048_576, 'invalid_output_limit');
  return new Promise((resolveResult, rejectResult) => {
    let child;
    try {
      child = (deps.spawn ?? spawn)(executable, ['app-server', '--stdio'], {
        cwd: namespace.workspace, env: { ...process.env, CODEX_HOME: namespace.home },
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch { rejectResult(new NamespaceReadError('spawn_failed')); return; }
    let phase = 'initialize', source, target, buffer = '', bytes = 0, settled = false, failure;
    let killTimer, closeTimer;
    const finish = (code = null, signal = null) => {
      if (settled) return; settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      if (failure || code !== 0 || phase !== 'done' || buffer.trim()) {
        rejectResult(failure ?? new NamespaceReadError(code !== 0 ? 'process_exit' : 'incomplete_protocol', { exitCode: code, signal }));
        return;
      }
      const contradicted = [source.pathEvidence, target.pathEvidence].some(x => ['invalid', 'outside_selected_home'].includes(x));
      const receipt = { format: 1, kind: 'native_stored_thread_pair', observedAt: new Date().toISOString(),
        homeSha256: hash(namespace.home), workspaceSha256: hash(namespace.workspace),
        parent: source, child: target, sameReaderNamespace: true,
        selectedHomePathEvidence: contradicted ? 'conflict' : [source.pathEvidence, target.pathEvidence].every(x => x === 'inside_selected_home') ? 'corroborated' : 'not_fully_exposed',
        nativeStoredPair: !contradicted,
        qualification: 'not_decided', creationVisible: null, entryUri: null, entryAccessible: 'unknown',
        desktopNamespaceMatch: 'not_observed', modelCalls: 0, businessWrites: 0, automaticRetry: false };
      resolveResult(Object.freeze({ ...receipt, receiptSha256: hash(JSON.stringify(receipt)) }));
    };
    const stop = error => {
      if (settled) return;
      failure ??= error instanceof NamespaceReadError ? error : new NamespaceReadError('protocol');
      try { child.kill('SIGTERM'); } catch { /* bound cleanup continues */ }
      killTimer ??= setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* cleanup remains bounded */ } }, 250);
      closeTimer ??= setTimeout(() => finish(), 750);
    };
    const timer = setTimeout(() => stop(new NamespaceReadError('timeout')), timeoutMs);
    const send = message => {
      try { child.stdin.write(JSON.stringify(message) + '\n'); }
      catch { stop(new NamespaceReadError('stdin_failed')); }
    };
    const receive = line => {
      const message = JSON.parse(line);
      need(object(message), 'invalid_message');
      if (typeof message.method === 'string') {
        // No approval/OAuth/dynamic tool handling; never answer server requests.
        need(!Object.hasOwn(message, 'id'), 'unexpected_server_request');
        return;
      }
      if (message.error) throw new NamespaceReadError('rpc_error', {
        code: Number.isSafeInteger(message.error.code) ? message.error.code : null });
      need(object(message.result), 'invalid_result');
      if (phase === 'initialize' && message.id === 1) {
        phase = 'source'; send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'thread/read', params: { threadId: sourceThreadId, includeTurns: false } }); return;
      }
      if (phase === 'source' && message.id === 2) {
        source = projectStoredThread(message.result.thread, { expectedId: sourceThreadId, namespace });
        phase = 'child'; send({ id: 3, method: 'thread/read', params: { threadId: childThreadId, includeTurns: false } }); return;
      }
      need(phase === 'child' && message.id === 3, 'unexpected_response');
      target = projectStoredThread(message.result.thread, { expectedId: childThreadId, namespace, expectedWorkspace: namespace.workspace });
      phase = 'done'; child.stdin.end();
    };
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk); buffer += chunk;
      if (bytes > maxBytes) return stop(new NamespaceReadError('output_limit'));
      let end;
      try {
        while (!failure && (end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line.trim()) receive(line);
        }
      } catch (error) { stop(error); }
    });
    child.stderr.resume(); // discard raw text, including any unrelated host notices
    child.stdout.on('error', () => stop(new NamespaceReadError('stdout_failed')));
    child.stderr.on('error', () => stop(new NamespaceReadError('stderr_failed')));
    child.stdin.on('error', () => stop(new NamespaceReadError('stdin_failed')));
    child.once('error', () => stop(new NamespaceReadError('spawn_failed')));
    child.once('close', (code, signal) => finish(code, signal));
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'aidesk_namespace_reader', version: '0.0.1' },
      capabilities: { experimentalApi: false } } });
  });
}
