#!/usr/bin/env node
/* global AbortController, TextDecoder */
/*
 * CLI-native updater for the installed AI书桌 package.
 *
 * This file deliberately validates the current .codex-plugin/.mcp/hooks
 * contract. It does not read or create the retired portable Agent Plugin
 * declarations and it never changes files directly: installation is always
 * delegated to the official marketplace commands.
 */
import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN = 'aidesk-runtime';
const MARKETPLACE = 'aidesk';
const ID = `${PLUGIN}@${MARKETPLACE}`;
const REPOSITORY = 'https://github.com/aideskx/aidesk.git';
const RELEASE_SOURCE = 'https://raw.githubusercontent.com/aideskx/aidesk/main/release.json';
const MCP_URL = 'https://aideskx.com/mcp';
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_FILES = Object.freeze([
  '.codex-plugin/plugin.json', '.mcp.json', 'hooks/hooks.json',
  'skills/aidesk-entry/SKILL.md', 'skills/aidesk-entry/references/goals.md',
  'skills/aidesk-entry/references/community.md', 'skills/aidesk-entry/references/data-rights.md',
  'skills/aidesk-entry/references/recovery.md', 'skills/aidesk-entry/references/legacy-network.md',
  'scripts/lifecycle-hook.mjs', 'scripts/preflight.mjs', 'scripts/update.mjs',
  'scripts/lib/contract.mjs', 'scripts/domain/contracts.mjs',
]);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+codex\.(\d{14}))?$/u;
const HASH = /^[a-f0-9]{64}$/u;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safePath = value => typeof value === 'string' && isAbsolute(value) && value.length < 4096
  && [...value].every(char => char.codePointAt(0) >= 32 && char.codePointAt(0) !== 127);
const canonicalRepository = value => value === REPOSITORY || value === REPOSITORY.slice(0, -4);
const validVersion = value => typeof value === 'string' && VERSION.test(value);

function compareVersions(left, right) {
  const a = VERSION.exec(left), b = VERSION.exec(right);
  if (!a || !b) return undefined;
  for (const index of [1, 2, 3]) {
    const av = BigInt(a[index]), bv = BigInt(b[index]);
    if (av < bv) return -1; if (av > bv) return 1;
  }
  const ab = a[4] ?? null, bb = b[4] ?? null;
  if (ab === bb) return 0; if (ab === null) return -1; if (bb === null) return 1;
  return ab < bb ? -1 : 1;
}

function digestEntries(entries) {
  const normalized = entries.map(entry => ({
    path: entry.path,
    gitMode: entry.gitMode,
    sha256: createHash('sha256').update(entry.bytes).digest('hex'),
  })).sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

async function walk(directory, root, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('package_symlink');
    if (entry.isDirectory()) await walk(path, root, files);
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      const mode = (entry.isFile() && (await lstat(path)).mode & 0o111) === 0 ? '100644' : '100755';
      files.push({ path: relative(root, path).split(sep).join('/'), bytes, gitMode: mode });
    } else throw new Error('package_entry_invalid');
  }
}

/** Read and verify only the current CLI-native package declarations. */
export async function inspectPackage(packageRoot = PACKAGE_ROOT) {
  if (!safePath(packageRoot)) throw new Error('invalid_package_root');
  const root = resolve(packageRoot);
  const item = await lstat(root);
  if (item.isSymbolicLink() || !item.isDirectory() || await realpath(root) !== root) throw new Error('invalid_package_root');
  const files = []; await walk(root, root, files);
  const paths = new Set(files.map(file => file.path));
  const missing = REQUIRED_FILES.filter(path => !paths.has(path));
  if (missing.length) throw new Error('package_files_missing');
  if (paths.has('plugin.json') || paths.has('mcp.json')) throw new Error('legacy_manifest_present');
  let manifest, mcp, hooks;
  try {
    manifest = JSON.parse((await readFile(join(root, '.codex-plugin/plugin.json'))).toString('utf8'));
    mcp = JSON.parse((await readFile(join(root, '.mcp.json'))).toString('utf8'));
    hooks = JSON.parse((await readFile(join(root, 'hooks/hooks.json'))).toString('utf8'));
  } catch { throw new Error('package_json_invalid'); }
  if (!object(manifest) || manifest.name !== PLUGIN || !validVersion(manifest.version)
    || manifest.skills !== './skills/' || manifest.mcpServers !== './.mcp.json' || manifest.hooks !== './hooks/hooks.json') throw new Error('manifest_invalid');
  const server = mcp?.mcpServers?.['aidesk-authority'];
  if (!object(server) || server.type !== 'http' || server.url !== MCP_URL
    || server.http_headers?.['X-Aidesk-Plugin-Version'] !== manifest.version) throw new Error('mcp_invalid');
  if (!object(hooks?.hooks) || Object.keys(hooks.hooks).sort().join(',') !== 'PostToolUse,PreToolUse') throw new Error('hooks_invalid');
  for (const phase of ['PreToolUse', 'PostToolUse']) for (const group of hooks.hooks[phase] ?? []) for (const hook of group.hooks ?? [])
    if (hook.type !== 'command' || typeof hook.command !== 'string' || !hook.command.includes('${PLUGIN_ROOT}/scripts/lifecycle-hook.mjs')) throw new Error('hooks_invalid');
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { packageRoot: root, name: manifest.name, version: manifest.version, packageDigest: digestEntries(files), files: files.map(file => file.path) };
}

function installedSource(item) {
  const source = item?.source?.path;
  return safePath(source) ? resolve(source) : null;
}

/** A disabled old copy is ignored; an enabled same-name foreign copy blocks. */
export function inspectInstallation(value) {
  if (!object(value) || !Array.isArray(value.installed)) return { error: 'invalid_host_inventory' };
  const named = value.installed.filter(item => item?.name === PLUGIN);
  const canonical = named.filter(item => item?.pluginId === ID && item?.marketplaceName === MARKETPLACE);
  if (canonical.length !== 1) return { error: canonical.length ? 'ambiguous_plugin' : 'plugin_not_installed' };
  if (named.some(item => item !== canonical[0] && item?.enabled === true)) return { error: 'ambiguous_plugin' };
  const plugin = canonical[0];
  if (!plugin.installed || !plugin.enabled) return { error: 'plugin_disabled' };
  const source = plugin.marketplaceSource ?? {};
  const sourceType = source.sourceType ?? source.source_type;
  if (sourceType !== 'git' || !canonicalRepository(source.source)) return { error: 'different_installation_source' };
  if (source.ref !== undefined && source.ref !== null && source.ref !== 'main') return { error: 'pinned_source' };
  const sourcePath = installedSource(plugin);
  if (!sourcePath || !sourcePath.endsWith(`${sep}${PLUGIN}`) && sourcePath !== PLUGIN) return { error: 'invalid_source_path' };
  if (!validVersion(plugin.version)) return { error: 'unrecognized_installed_version' };
  return { version: plugin.version, pluginId: ID, sourcePath };
}

function projectMarketplace(value) {
  const entry = value?.config?.marketplaces?.[MARKETPLACE];
  if (!object(entry) || entry.source_type !== 'git' || !canonicalRepository(entry.source)
    || entry.ref !== undefined && entry.ref !== null && (typeof entry.ref !== 'string' || !entry.ref.trim() || entry.ref.length > 1024)) throw new Error('marketplace_source_unavailable');
  return { source_type: 'git', source: entry.source, ref: entry.ref ?? null };
}

class HostCommandError extends Error { constructor(message, { indeterminate = false } = {}) { super(message); this.indeterminate = indeterminate; } }

export function runCommand(executable, args, timeoutMs = 30_000) {
  if (!safePath(executable) || !Array.isArray(args)) return Promise.reject(new HostCommandError('host_command_unavailable'));
  return new Promise((resolvePromise, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, args, { cwd: tmpdir(), shell: false, detached: grouped, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, timedOut = false, settled = false, killTimer, closeTimer;
    const stop = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Process may have exited. */ } };
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer); child.stdout.destroy(); child.stderr.destroy(); child.unref(); if (error) reject(error); else resolvePromise(value); };
    const abort = () => { if (settled) return; timedOut = true; stop('SIGTERM'); killTimer = setTimeout(() => stop('SIGKILL'), 500); closeTimer = setTimeout(() => finish(new HostCommandError('host_command_timeout', { indeterminate: true })), 1000); };
    const timer = setTimeout(abort, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', part => { bytes += Buffer.byteLength(part); if (bytes > 1_048_576) abort(); else output += part; }); child.stderr.resume();
    child.once('error', () => finish(new HostCommandError('host_command_unavailable')));
    child.once('close', code => {
      if (settled) return; if (timedOut || code !== 0) return finish(new HostCommandError(timedOut ? 'host_command_timeout' : 'host_command_failed', { indeterminate: timedOut }));
      if (!output.trim()) return finish(null, {});
      try { const value = JSON.parse(output); finish(object(value) ? null : new HostCommandError('host_response_invalid'), value); } catch { finish(new HostCommandError('host_response_invalid')); }
    });
  });
}

/** Bounded plain-text probe used only for CLI discovery (--version/help). */
export function runTextCommand(executable, args, timeoutMs = 3_000) {
  if (!safePath(executable) || !Array.isArray(args)) return Promise.reject(new HostCommandError('host_command_unavailable'));
  return new Promise((resolvePromise, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, args, { cwd: tmpdir(), shell: false, detached: grouped, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, timedOut = false, settled = false, killTimer, closeTimer;
    const stop = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Process may have exited. */ } };
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer); child.stdout.destroy(); child.stderr.destroy(); child.unref(); if (error) reject(error); else resolvePromise(value); };
    const abort = () => { if (settled) return; timedOut = true; stop('SIGTERM'); killTimer = setTimeout(() => stop('SIGKILL'), 500); closeTimer = setTimeout(() => finish(new HostCommandError('host_command_timeout', { indeterminate: true })), 1000); };
    const timer = setTimeout(abort, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stdout.on('data', part => { bytes += Buffer.byteLength(part); if (bytes > 32_768) abort(); else output += part; }); child.stderr.resume();
    child.once('error', () => finish(new HostCommandError('host_command_unavailable')));
    child.once('close', code => { if (settled) return; if (timedOut || code !== 0) return finish(new HostCommandError(timedOut ? 'host_command_timeout' : 'host_command_failed', { indeterminate: timedOut })); finish(null, output); });
  });
}

export function readMarketplaceSource(executable, timeoutMs = 30_000) {
  if (!safePath(executable)) return Promise.reject(new HostCommandError('host_command_unavailable'));
  return new Promise((resolvePromise, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, ['app-server', '--stdio'], { cwd: tmpdir(), shell: false, detached: grouped, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', result, state = 'init', settled = false, timedOut = false, killTimer, closeTimer;
    const stop = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Process may have exited. */ } };
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer); child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref(); if (error) reject(error); else resolvePromise(value); };
    const abort = () => { if (settled) return; timedOut = true; stop('SIGTERM'); killTimer = setTimeout(() => stop('SIGKILL'), 500); closeTimer = setTimeout(() => finish(new HostCommandError('host_command_timeout', { indeterminate: true })), 1000); };
    const timer = setTimeout(abort, timeoutMs);
    const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
    const receive = line => {
      let message; try { message = JSON.parse(line); } catch { throw new HostCommandError('host_response_invalid'); }
      if (!object(message)) throw new HostCommandError('host_response_invalid');
      if (typeof message.method === 'string' && !Object.hasOwn(message, 'id')) return;
      if (Object.hasOwn(message, 'error') || !object(message.result)) throw new HostCommandError('host_response_invalid');
      if (state === 'init' && message.id === 1) { state = 'config'; send({ method: 'initialized', params: {} }); send({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: tmpdir() } }); return; }
      if (state === 'config' && message.id === 2) { result = projectMarketplace(message.result); state = 'done'; child.stdin.end(); return; }
      throw new HostCommandError('host_response_invalid');
    };
    child.stdout.setEncoding('utf8'); child.stdout.on('data', part => { buffer += part; if (Buffer.byteLength(buffer) > 1_048_576) return abort(); let end; try { while ((end = buffer.indexOf('\n')) !== -1) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line.trim()) receive(line); } } catch (error) { finish(error); } }); child.stderr.resume();
    child.once('error', () => finish(new HostCommandError('host_command_unavailable')));
    child.once('close', code => { if (settled) return; if (timedOut || code !== 0) return finish(new HostCommandError(timedOut ? 'host_command_timeout' : 'host_command_failed', { indeterminate: timedOut })); if (state !== 'done' || buffer.trim()) return finish(new HostCommandError('host_response_invalid')); finish(null, result); });
    child.stdin.on('error', () => finish(new HostCommandError('host_response_invalid')));
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'aidesk_plugin_updater', version: '1.0.0' } } });
  });
}

function parseRelease(value, now = Date.now()) {
  if (!object(value) || Reflect.ownKeys(value).length !== 9 || value.schemaVersion !== 1 || value.plugin !== PLUGIN || value.repository !== 'aideskx/aidesk' || value.channel !== 'stable'
    || !validVersion(value.latestVersion) || !validVersion(value.minimumSupportedVersion) || compareVersions(value.minimumSupportedVersion, value.latestVersion) === 1
    || !HASH.test(value.packageDigest) || typeof value.notes !== 'string' || value.notes.length > 500 || typeof value.publishedAt !== 'string') throw new Error('release_invalid');
  const published = new Date(value.publishedAt); const iso = value.publishedAt.includes('.') ? value.publishedAt : value.publishedAt.replace('Z', '.000Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value.publishedAt) || !Number.isFinite(published.getTime()) || published.toISOString() !== iso || published.getTime() > now + 300_000) throw new Error('release_invalid');
  return { latestVersion: value.latestVersion, minimumSupportedVersion: value.minimumSupportedVersion, packageDigest: value.packageDigest, notes: value.notes, publishedAt: value.publishedAt };
}

export async function fetchRelease({ fetchImpl = globalThis.fetch, timeoutMs = 3_000, now = Date.now } = {}) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(RELEASE_SOURCE, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: controller.signal, headers: { accept: 'application/json' } });
    if (response.redirected || response.url && response.url !== RELEASE_SOURCE || response.status !== 200) throw new Error('release_unavailable');
    const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase(); const length = response.headers.get('content-length');
    if (!['application/json', 'text/plain'].includes(type ?? '') || !response.body || length !== null && (!/^\d+$/u.test(length) || Number(length) > 16_384)) throw new Error('release_invalid');
    const reader = response.body.getReader(); const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 16_384) throw new Error('release_invalid');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
    return parseRelease(JSON.parse(text), now());
  } finally { clearTimeout(timer); controller.abort(); }
}

export async function discoverCodex(explicit) {
  const paths = explicit !== undefined ? [explicit] : [process.env.CODEX_BIN, ...(process.platform === 'darwin' ? ['/Applications/ChatGPT.app/Contents/Resources/codex'] : []), ...(process.env.PATH ?? '').split(delimiter).map(directory => join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex'))].filter(Boolean);
  for (const candidate of [...new Set(paths)]) {
    if (!safePath(candidate)) continue;
    try {
      await access(candidate, constants.X_OK); const resolved = await realpath(candidate);
      const version = await runTextCommand(resolved, ['--version'], 3_000);
      if (!/^codex-cli\s+[0-9A-Za-z.+-]+\s*$/u.test(version)) continue;
      const help = await runTextCommand(resolved, ['plugin', '--help'], 3_000);
      if (/\bplugin\b/u.test(help) && /\bmarketplace\b/u.test(help)) return resolved;
    } catch { /* Try the next executable candidate. */ }
  }
  return null;
}

export async function acquireLock(path = join(tmpdir(), `aidesk-runtime-update-${createHash('sha256').update(homedir()).digest('hex').slice(0, 20)}.lock`)) {
  const token = cryptoRandomId();
  const openOwned = async () => {
    const handle = await open(path, 'wx', 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, token }) + '\n'); await handle.sync();
    return handle;
  };
  let handle;
  try { handle = await openOwned(); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let previous;
    try { previous = await readFile(path, 'utf8'); const owner = JSON.parse(previous); if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.token !== 'string') return null; process.kill(owner.pid, 0); return null; }
    catch (ownerError) { if (ownerError?.code !== 'ESRCH') return null; }
    try { if (await readFile(path, 'utf8') !== previous) return null; await rm(path); }
    catch { return null; }
    try { handle = await openOwned(); } catch { return null; }
  }
  return async () => {
    try { await handle.close(); }
    finally {
      try { const current = JSON.parse(await readFile(path, 'utf8')); if (current?.token === token) await rm(path); } catch { /* Never remove unknown lock contents. */ }
    }
  };
}

function cryptoRandomId() { return randomUUID(); }

async function verified(root, version, packageDigest) {
  const inspection = await inspectPackage(root);
  if (inspection.version !== version || packageDigest !== undefined && inspection.packageDigest !== packageDigest) throw new Error('package_verification_failed');
  return inspection;
}

/** Deterministic check/apply transaction. All host effects are adapter-injected for offline tests. */
export async function updatePlugin({ packageRoot = PACKAGE_ROOT, inventory, readSource, release = fetchRelease, command = runCommand, apply = false, codex = null } = {}) {
  if (typeof inventory !== 'function' || typeof readSource !== 'function') return { status: 'unknown', changed: false, reason: 'host_unavailable' };
  let before, packageInfo;
  try { before = inspectInstallation(await inventory()); packageInfo = await inspectPackage(packageRoot); } catch { return { status: 'unknown', changed: false, reason: 'host_unavailable' }; }
  if (before.error) return { status: 'unknown', changed: false, reason: before.error };
  const base = { pluginId: ID, previousVersion: before.version, installedVersion: before.version };
  if (packageInfo.version !== before.version) return { ...base, status: 'unknown', changed: false, reason: 'installed_version_mismatch' };
  let source;
  try { source = await readSource(); } catch { return { ...base, status: 'unknown', changed: false, reason: 'marketplace_source_unavailable' }; }
  if (source?.source_type !== 'git' || !canonicalRepository(source.source) || source.ref !== null && source.ref !== 'main') return { ...base, status: 'unknown', changed: false, reason: source?.ref ? 'pinned_source' : 'marketplace_source_unavailable' };
  let published;
  try { published = await release(); } catch { return { ...base, status: 'unknown', changed: false, reason: 'release_unavailable' }; }
  const comparison = compareVersions(before.version, published.latestVersion);
  if (comparison === undefined) return { ...base, status: 'unknown', changed: false, reason: 'release_invalid' };
  const target = { ...base, targetVersion: published.latestVersion, packageDigest: published.packageDigest, minimumSupportedVersion: published.minimumSupportedVersion };
  if (comparison >= 0) {
      try { await verified(packageRoot, before.version, comparison === 0 ? published.packageDigest : undefined); } catch { return { ...target, status: 'unknown', changed: false, reason: 'package_verification_failed' }; }
    return { ...target, status: comparison === 0 ? 'current' : 'ahead', changed: false };
  }
  if (!apply) return {
    ...target,
    status: compareVersions(before.version, published.minimumSupportedVersion) === -1 ? 'update_required' : 'update_available',
    changed: false,
  };
  const fresh = inspectInstallation(await inventory());
  if (fresh.error || fresh.version !== before.version || fresh.sourcePath !== before.sourcePath) return { ...target, installedVersion: fresh.version ?? null, status: 'unknown', changed: null, reason: fresh.error ?? 'installed_version_changed' };
  try { const currentSource = await readSource(); if (currentSource.ref !== null && currentSource.ref !== 'main') return { ...target, status: 'unknown', changed: false, reason: 'pinned_source' }; } catch { return { ...target, status: 'unknown', changed: false, reason: 'marketplace_source_unavailable' }; }
  const structuredCommandError = outcome => object(outcome) && Array.isArray(outcome.errors) && outcome.errors.length > 0
    ? new Error('host_command_failed') : null;
  let commandError = null;
  try {
    const outcome = await command(codex, ['plugin', 'marketplace', 'upgrade', MARKETPLACE, '--json'], 120_000);
    const structuredError = structuredCommandError(outcome);
    if (structuredError) commandError = structuredError;
  } catch (error) { commandError = error; }
  let after;
  try { after = inspectInstallation(await inventory()); } catch { return { ...target, status: 'unknown', changed: null, reason: 'readback_failed' }; }
  if (after.error || after.sourcePath !== before.sourcePath)
    return { ...target, installedVersion: after.version ?? null, status: 'unknown', changed: null, reason: after.error ?? 'source_changed' };
  const packageRootFor = version => {
    if (!validVersion(version)) return null;
    const root = resolve(dirname(packageRoot), version);
    const relativeRoot = relative(resolve(dirname(packageRoot)), root);
    return relativeRoot === version ? root : null;
  };
  const checkInstalled = async () => {
    if (after.error || after.sourcePath !== before.sourcePath) return false;
    const candidateRoot = packageRootFor(after.version);
    if (!candidateRoot) return false;
    try { await verified(candidateRoot, published.latestVersion, published.packageDigest); return true; } catch { return false; }
  };
  if (!(await checkInstalled())) {
    if (commandError?.indeterminate) return { ...target, installedVersion: after.version ?? null, status: 'unknown', changed: null, reason: 'host_command_timeout' };
    try {
      const currentSource = await readSource(); if (currentSource.ref !== null && currentSource.ref !== 'main') return { ...target, installedVersion: after.version ?? null, status: 'unknown', changed: null, reason: 'pinned_source' };
      const outcome = await command(codex, ['plugin', 'add', ID, '--json'], 120_000);
      commandError ??= structuredCommandError(outcome);
    } catch (error) {
      try { after = inspectInstallation(await inventory()); } catch { return { ...target, status: 'unknown', changed: null, reason: 'readback_failed' }; }
      if (error?.indeterminate) return { ...target, installedVersion: after.version ?? null, status: 'unknown', changed: null, reason: 'host_command_timeout' };
    }
    try { after = inspectInstallation(await inventory()); } catch { return { ...target, status: 'unknown', changed: null, reason: 'readback_failed' }; }
    if (after.error || after.sourcePath !== before.sourcePath)
      return { ...target, installedVersion: after.version ?? null, status: 'unknown', changed: null, reason: after.error ?? 'source_changed' };
  }
  if (!(await checkInstalled())) return { ...target, installedVersion: after.version ?? null, status: 'failed', changed: after.version !== before.version, reason: commandError?.message ?? 'package_verification_failed' };
  return { ...target, installedVersion: after.version, status: 'installed_pending_activation', changed: true, commandReportedError: commandError !== null };
}

export function parseArguments(args) {
  if (!Array.isArray(args)) throw new Error('invalid_arguments');
  let apply = false, check = false, explicit;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--apply') { apply = true; continue; }
    if (argument === '--check') { check = true; continue; }
    if (argument === '--codex') {
      if (explicit !== undefined || index + 1 >= args.length || typeof args[index + 1] !== 'string' || args[index + 1].startsWith('--')) throw new Error('invalid_arguments');
      explicit = args[++index]; continue;
    }
    throw new Error('invalid_arguments');
  }
  if (apply === check) throw new Error('invalid_arguments');
  return { apply, check, explicit };
}

async function main() {
  const { apply, explicit } = parseArguments(process.argv.slice(2));
  const codex = await discoverCodex(explicit); if (!codex) { console.log(JSON.stringify({ status: 'unknown', changed: false, reason: 'host_unavailable' })); return; }
  const releaseLock = await acquireLock(); if (!releaseLock) { console.log(JSON.stringify({ status: 'unknown', changed: false, reason: 'update_busy' })); return; }
  try {
    const inventory = () => runCommand(codex, ['plugin', 'list', '--json'], 30_000);
    const result = await updatePlugin({ packageRoot: PACKAGE_ROOT, inventory, readSource: () => readMarketplaceSource(codex), command: runCommand, apply, codex });
    console.log(JSON.stringify({ ...result, mode: apply ? 'apply' : 'check' }));
  } finally { await releaseLock(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(() => { console.log(JSON.stringify({ status: 'unknown', changed: false, reason: 'host_unavailable' })); process.exitCode = 2; });
