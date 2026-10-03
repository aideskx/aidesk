import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export class HostDataBindingError extends Error {
  constructor(kind) { super(`host_data_binding:${kind}`); this.kind = kind; }
}
const error = kind => new HostDataBindingError(kind);
const kinds = new Set(['not_found', 'already_exists', 'busy', 'io_unavailable', 'unsafe_path',
  'unsupported_filesystem', 'file_changed', 'invalid_json', 'invalid_limit', 'invalid_expected_digest',
  'invalid_request', 'mutation_unknown']);
const mutations = new Set(['ensure', 'mkdir_exclusive', 'read_locked', 'write', 'replace', 'remove']);

// One lazy child for this owner instance. The product module constructs exactly
// one instance; tests inject an executable only into this internal transport.
// Death/timeout poisons the instance permanently; no mutation retry or respawn.
export function createRpcClient({ executable, args, startupMs = 2200, requestMs = 2000, spawnChild = spawn }) {
  let child, starting, dead = false, closed = false, ready, buffer = '';
  const decoder = new StringDecoder('utf8'), pending = new Map();
  let rejectReady, resolveReady, startTimer;
  const references = active => {
    for (const item of [child, child?.stdin, child?.stdout, child?.stderr]) item?.[active ? 'ref' : 'unref']?.();
  };
  const fail = kind => {
    if (dead) return;
    dead = true; clearTimeout(startTimer); rejectReady?.(error(kind));
    for (const item of pending.values()) {
      clearTimeout(item.timer); item.reject(error(item.mutating ? 'mutation_unknown' : kind));
    }
    pending.clear(); child?.kill();
  };
  function accept(line) {
    let value; try { value = JSON.parse(line); } catch { fail('helper_protocol_failed'); return; }
    if (!ready) {
      if (value?.protocol !== 1 || value.ready !== true || !Number.isInteger(value.pid)
        || typeof value.instanceId !== 'string' || !/^[a-f0-9-]{36}$/u.test(value.instanceId)) { fail('helper_protocol_failed'); return; }
      ready = { pid: value.pid, instanceId: value.instanceId }; clearTimeout(startTimer); resolveReady(ready); references(false); return;
    }
    const item = pending.get(value?.id);
    if (!item || typeof value.ok !== 'boolean') { fail('helper_protocol_failed'); return; }
    pending.delete(value.id); clearTimeout(item.timer);
    if (value.ok) item.resolve(value.result);
    else if (kinds.has(value.kind)) item.reject(error(value.kind));
    else { item.reject(error(item.mutating ? 'mutation_unknown' : 'helper_protocol_failed')); fail('helper_protocol_failed'); }
    if (!pending.size) references(false);
  }
  async function start() {
    if (dead || closed) throw error('helper_unavailable');
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      resolveReady = resolve; rejectReady = reject;
      startTimer = setTimeout(() => fail('helper_start_timeout'), startupMs);
      try { child = spawnChild(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false }); }
      catch { fail('helper_unavailable'); return; }
      child.once('error', () => fail('helper_unavailable'));
      child.once('close', () => { if (!closed || pending.size) fail('helper_exited'); });
      child.stdin.on('error', () => fail('helper_exited'));
      child.stdout.on('data', chunk => {
        if (dead) return;
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 2100000) { fail('helper_protocol_failed'); return; }
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, at).replace(/\r$/u, ''); buffer = buffer.slice(at + 1); accept(line); if (dead) break; }
      });
      // Neither stdout nor stderr is copied to logs; native errors may contain
      // selected private paths or values. Unexpected stderr is fail closed.
      child.stderr.on('data', () => fail('helper_unavailable'));
    });
    return starting;
  }
  async function call(op, fields = {}) {
    await start(); if (dead || closed) throw error('helper_unavailable');
    const id = randomUUID(), request = `${JSON.stringify({ id, op, ...fields })}\n`;
    if (Buffer.byteLength(request) > 1500000) throw error('invalid_request');
    return new Promise((resolve, reject) => {
      references(true);
      const timer = setTimeout(() => fail('helper_request_timeout'), requestMs);
      pending.set(id, { resolve, reject, timer, mutating: mutations.has(op) });
      child.stdin.write(request, cause => { if (cause) fail('helper_exited'); });
    });
  }
  async function close() {
    if (closed) return; closed = true;
    if (!child) return;
    if (pending.size) { fail('helper_closed'); return; }
    child.stdin.end();
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); }, 500);
      const hard = setTimeout(resolve, 1000);
      child.once('close', () => { clearTimeout(timer); clearTimeout(hard); resolve(); });
    });
  }
  return { call, close, state: () => ({ started: Boolean(child), ready: ready ?? null, dead, closed }) };
}
