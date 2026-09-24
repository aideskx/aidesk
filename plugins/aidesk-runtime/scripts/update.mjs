import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, unlink, rmdir, lstat, realpath } from 'node:fs/promises';
import { dirname, basename, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { comparePluginVersions, createPluginUpdateChecker, parsePluginRelease } from './lib/release-check.mjs';
import { validatePluginReleaseCandidate } from './lib/package-integrity.mjs';

const PLUGIN = 'aidesk-runtime';
const MARKETPLACE = 'aidesk';
const ID = `${PLUGIN}@${MARKETPLACE}`;
const REPOSITORY = 'https://github.com/aideskx/aidesk.git';
const MCP_URL = 'https://aideskx.com/mcp';
const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validVersion = value => typeof value === 'string' && comparePluginVersions(value, value) === 0;
const canonicalRepository = value => value === REPOSITORY || value === REPOSITORY.slice(0, -4);

/** Never return raw CLI stderr, config, other installed plugins or credentials. */
export function inspectInstallation(value) {
  if (!isObject(value) || !Array.isArray(value.installed)) return { error: 'invalid_host_inventory' };
  const matches = value.installed.filter(item => item?.name === PLUGIN);
  if (matches.length !== 1) return { error: matches.length ? 'ambiguous_plugin' : 'plugin_not_installed' };
  const plugin = matches[0];
  if (plugin.pluginId !== ID || plugin.marketplaceName !== MARKETPLACE || !plugin.installed)
    return { error: 'different_installation_source' };
  if (!plugin.enabled) return { error: 'plugin_disabled' };
  if (!validVersion(plugin.version)) return { error: 'unrecognized_installed_version' };
  if (plugin.marketplaceSource?.sourceType !== 'git' || !canonicalRepository(plugin.marketplaceSource.source))
    return { error: 'different_installation_source' };
  if (plugin.marketplaceSource.ref && plugin.marketplaceSource.ref !== 'main') return { error: 'pinned_source' };
  if (value.installed.some(item => item?.marketplaceName === MARKETPLACE && item.name !== PLUGIN))
    return { error: 'marketplace_contains_other_installed_plugins' };
  const sourcePath = plugin.source?.path;
  if (typeof sourcePath !== 'string' || !isAbsolute(sourcePath)
    || basename(sourcePath) !== PLUGIN || basename(dirname(sourcePath)) !== 'plugins')
    return { error: 'invalid_source_path' };
  return { version: plugin.version, pluginId: ID, sourcePath };
}

// config/read may include unrelated private settings. Never return that response.
function marketplaceProjection(value) {
  const entry = isObject(value?.config?.marketplaces) ? value.config.marketplaces[MARKETPLACE] : null;
  if (!isObject(entry) || entry.source_type !== 'git' || !canonicalRepository(entry.source)
    || entry.ref != null && (typeof entry.ref !== 'string' || !entry.ref.trim() || entry.ref.length > 1024))
    throw new Error('invalid_marketplace_configuration');
  return { source_type: entry.source_type, source: entry.source, ref: entry.ref ?? null };
}

async function configuredSourceError(readSource) {
  try {
    const value = await readSource();
    if (!isObject(value) || value.source_type !== 'git' || !canonicalRepository(value.source)
      || !Object.hasOwn(value, 'ref') || value.ref !== null && (typeof value.ref !== 'string' || !value.ref.trim() || value.ref.length > 1024))
      return 'marketplace_source_unavailable';
    return value.ref !== null && value.ref !== 'main' ? 'pinned_source' : null;
  } catch { return 'marketplace_source_unavailable'; }
}

// A release check, package verification or source RPC may outlive the user's
// installation choice. Re-read just before each mutation; never repair over a
// different version or treat the earlier inventory as current authorization.
async function mutationInstallation(inventory, expected) {
  let current;
  try { current = inspectInstallation(await inventory()); }
  catch { return { error: 'readback_failed', version: null }; }
  if (current.error) return { error: current.error, version: null };
  const error = current.sourcePath !== expected.sourcePath ? 'source_changed'
    : current.version !== expected.version ? 'installed_version_changed' : null;
  return { error, version: current.version };
}

/** Deterministic transaction, with host and network effects supplied by adapters. */
export async function updatePlugin({ inventory, readSource, check, upgrade, repair, snapshot, verify, apply = false }) {
  let before;
  try { before = inspectInstallation(await inventory()); }
  catch { return { status: 'host_unavailable', changed: false }; }
  if (before.error) return { status: 'blocked', reason: before.error, changed: false };
  const base = { pluginId: ID, previousVersion: before.version, installedVersion: before.version };
  const sourceError = await configuredSourceError(readSource);
  if (sourceError) return { ...base, status: 'blocked', reason: sourceError, changed: false };
  let release;
  try { release = await check(before.version); }
  catch { return { ...base, status: 'check_unavailable', changed: false }; }
  if (!isObject(release) || !['current', 'ahead', 'update_available', 'update_required'].includes(release.status))
    return { ...base, status: 'check_unavailable', changed: false };
  if (!validVersion(release.latestVersion) || release.installedVersion !== before.version
    || !/^[a-fA-F0-9]{64}$/.test(release.packageDigest ?? ''))
    return { ...base, status: 'check_unavailable', reason: 'invalid_release_comparison', changed: false };
  const comparison = comparePluginVersions(before.version, release.latestVersion);
  if (release.status === 'current' && comparison !== 0 || release.status === 'ahead' && comparison !== 1
    || ['update_available', 'update_required'].includes(release.status) && comparison !== -1)
    return { ...base, status: 'check_unavailable', reason: 'invalid_release_comparison', changed: false };
  const target = { ...base, targetVersion: release.latestVersion, required: release.status === 'update_required' };
  if (comparison >= 0) {
    if (comparison === 0) {
      try { await verify(before.version, release); }
      catch { return { ...target, status: 'installed_unverified', changed: false, reason: 'package_verification_failed' }; }
    }
    return { ...target, status: comparison === 0 ? 'current' : 'ahead', changed: false };
  }
  if (!apply) return { ...target, status: 'update_available', changed: false };
  let previousDigest;
  try { previousDigest = await verify(before.version, null); } catch { /* Update may repair an incomplete old cache. */ }
  // Settings may have changed while checking the release or verifying the package.
  const beforeUpgradeError = await configuredSourceError(readSource);
  if (beforeUpgradeError) return { ...target, status: 'blocked', reason: beforeUpgradeError, changed: false };
  const upgradeInstallation = await mutationInstallation(inventory, before);
  if (upgradeInstallation.error) return { ...target, installedVersion: upgradeInstallation.version,
    status: 'blocked', reason: upgradeInstallation.error, changed: null };
  // One fetch/upgrade, then at most one verified single-plugin cache repair.
  let commandFailed;
  let indeterminate = false;
  try {
    const outcome = await upgrade();
    commandFailed = !isObject(outcome) || !Array.isArray(outcome.errors) || outcome.errors.length !== 0;
  } catch (error) { commandFailed = true; indeterminate = error?.indeterminate === true; }
  for (let phase = 0; phase < 2; phase++) {
    let after;
    try { after = inspectInstallation(await inventory()); }
    catch { return { ...target, status: 'installation_unknown', changed: null, reason: 'readback_failed' }; }
    if (after.error || after.sourcePath !== before.sourcePath)
      return { ...target, status: 'installation_unknown', changed: null, reason: after.error ?? 'source_changed' };
    const afterSourceError = await configuredSourceError(readSource);
    if (afterSourceError) return { ...target, status: 'installation_unknown', changed: null, reason: afterSourceError };
    const result = { ...target, installedVersion: after.version };
    const advanced = comparePluginVersions(after.version, before.version);
    if (advanced !== 0 && advanced !== 1)
      return { ...result, status: 'installation_unknown', changed: true, reason: 'unexpected_version' };
    let actualRelease = release;
    if (advanced === 1 && after.version !== release.latestVersion) {
      try { actualRelease = await check(after.version); } catch { actualRelease = null; }
      if (!isObject(actualRelease) || actualRelease.status !== 'current'
        || actualRelease.installedVersion !== after.version || actualRelease.latestVersion !== after.version
        || !/^[a-fA-F0-9]{64}$/.test(actualRelease.packageDigest ?? ''))
        return { ...result, status: 'installed_unverified', changed: true, reason: 'release_changed_during_update' };
    }
    let intact = false;
    try {
      if (advanced === 1) { await verify(after.version, actualRelease); intact = true; }
      else if (typeof previousDigest === 'string') {
        intact = await verify(after.version, { packageDigest: previousDigest }) === previousDigest;
      }
    } catch { /* Readback of a version string alone does not prove usable files. */ }
    if (advanced === 1 && intact)
      return { ...result, targetVersion: after.version, status: 'installed_pending_activation', changed: true,
        commandReportedError: commandFailed, repaired: phase === 1 };
    if (phase === 0 && !indeterminate && typeof snapshot === 'function' && typeof repair === 'function') {
      let ready = false;
      try { ready = await snapshot(release.latestVersion, release) === true; } catch { /* No verified snapshot, no repair. */ }
      if (ready) {
        const beforeRepairError = await configuredSourceError(readSource);
        if (beforeRepairError) return { ...result, status: 'installation_unknown', changed: null, reason: beforeRepairError };
        const repairInstallation = await mutationInstallation(inventory, after);
        if (repairInstallation.error) return { ...result, installedVersion: repairInstallation.version,
          status: 'installation_unknown', reason: repairInstallation.error, changed: null };
        try { await repair(); } catch (error) { commandFailed = true; indeterminate = error?.indeterminate === true; }
        continue;
      }
    }
    if (advanced === 0 && intact)
      return { ...result, status: 'failed_unchanged', changed: false, oldPackageVerified: true,
        reason: indeterminate ? 'host_command_timeout' : commandFailed ? 'upgrade_failed' : 'version_not_advanced' };
    return { ...result, status: advanced === 1 ? 'installed_unverified' : 'installation_unknown',
      changed: advanced === 1 ? true : null, reason: 'package_verification_failed' };
  }
}

export function readMarketplaceSource(executable, timeoutMs = 30_000) {
  return runCli(executable, ['app-server'], timeoutMs, 'marketplace-config');
}

export function runCli(executable, args, timeoutMs = 30_000, mode = 'json') {
  if (!['json', 'marketplace-config'].includes(mode)) return Promise.reject(new Error('invalid_host_mode'));
  return new Promise((resolvePromise, reject) => {
    // A stable working directory survives the host removing the executing old package.
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, args, { cwd: tmpdir(), shell: false, windowsHide: true,
      detached: grouped, stdio: [mode === 'marketplace-config' ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let output = ''; let overflow = false; let timedOut = false; let settled = false;
    let rpcState = 'initialize'; let rpcResult; let rpcBytes = 0; let protocolFailed = false;
    let killTimer; let closeTimer;
    const stop = signal => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch { /* Process may already have ended. */ }
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
      output = ''; rpcResult = undefined;
      child.stdin?.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
      if (error) reject(error); else resolvePromise(value);
    };
    const abort = () => {
      if (settled) return;
      stop('SIGTERM');
      killTimer ??= setTimeout(() => stop('SIGKILL'), 1_000);
      closeTimer ??= setTimeout(() => finish(Object.assign(new Error('host_command_timeout'), { indeterminate: true })), 2_000);
    };
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    const receive = line => {
      const message = JSON.parse(line);
      if (!isObject(message)) throw new Error('invalid_rpc_response');
      // Notifications are not retained. Interactive requests are not approved.
      if (typeof message.method === 'string' && !Object.hasOwn(message, 'id')) return;
      if (Object.hasOwn(message, 'error') || Object.hasOwn(message, 'method') || !isObject(message.result))
        throw new Error('invalid_rpc_response');
      if (rpcState === 'initialize' && message.id === 1) {
        rpcState = 'config';
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: tmpdir() } });
      } else if (rpcState === 'config' && message.id === 2) {
        rpcResult = marketplaceProjection(message.result);
        rpcState = 'done';
        child.stdin.end();
      } else throw new Error('unexpected_rpc_response');
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => {
      if (settled || overflow || protocolFailed) return;
      output += part;
      rpcBytes += Buffer.byteLength(part);
      if (output.length > 1_048_576 || mode === 'marketplace-config' && rpcBytes > 1_048_576) {
        overflow = true; output = ''; abort(); return;
      }
      if (mode === 'marketplace-config') {
        try {
          let end;
          while ((end = output.indexOf('\n')) !== -1) {
            const line = output.slice(0, end); output = output.slice(end + 1);
            if (line.trim()) receive(line);
          }
        } catch { protocolFailed = true; output = ''; rpcResult = undefined; abort(); }
      }
    });
    child.stderr.resume();
    child.once('error', () => finish(new Error('host_command_unavailable')));
    child.once('close', code => {
      if (timedOut || overflow || code !== 0) {
        finish(Object.assign(new Error(timedOut ? 'host_command_timeout' : 'host_command_failed'),
          { indeterminate: timedOut || overflow })); return;
      }
      if (mode === 'marketplace-config') {
        if (protocolFailed || rpcState !== 'done' || output.trim()) finish(new Error('invalid_host_response'));
        else finish(null, rpcResult);
        return;
      }
      try { finish(null, JSON.parse(output)); } catch { finish(new Error('invalid_host_response')); }
    });
    if (mode === 'marketplace-config') {
      child.stdin.on('error', () => { protocolFailed = true; abort(); });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'aidesk_plugin_updater', version: '1.0.0' } } });
    }
  });
}

export async function acquireLock(lockParent = tmpdir()) {
  const userKey = createHash('sha256').update(homedir()).digest('hex').slice(0, 20);
  const directory = join(lockParent, `aidesk-plugin-update-${userKey}`);
  const path = join(directory, 'owner.json');
  const token = randomUUID();
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink()) return null;
    let previous;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return null;
      previous = JSON.parse(await readFile(path, 'utf8'));
    } catch { return null; }
    if (previous.pluginId !== ID || !Number.isSafeInteger(previous.pid) || previous.pid < 1
      || typeof previous.token !== 'string') return null;
    try { process.kill(previous.pid, 0); return null; }
    catch (error) { if (error.code !== 'ESRCH') return null; }
    // Only a verified dead owner's exact file is removed, never a live process.
    if (JSON.parse(await readFile(path, 'utf8')).token !== previous.token) return null;
    await unlink(path); await rmdir(directory);
    try { await mkdir(directory, { mode: 0o700 }); } catch { return null; }
  }
  await writeFile(path, JSON.stringify({ pluginId: ID, pid: process.pid, token }), { mode: 0o600, flag: 'wx' });
  return async () => {
    try { if (JSON.parse(await readFile(path, 'utf8')).token === token) { await unlink(path); await rmdir(directory); } }
    catch { /* A later run diagnoses its own lock; never remove unknown contents. */ }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  let codex;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--codex') { if (codex || !args[index + 1]) throw new Error('invalid_arguments'); codex = args[++index]; }
    else if (!['--apply', '--check'].includes(args[index])) throw new Error('invalid_arguments');
  }
  if (!codex || !isAbsolute(codex) || args.includes('--check') && apply) throw new Error('explicit_codex_path_required');
  const manifest = JSON.parse(await readFile(join(ownRoot, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== PLUGIN || !validVersion(manifest.version)) throw new Error('invalid_running_package');
  // The cache location is derived from this installed script, not from a guessed
  // home directory or a marketplace source path. Development copies cannot apply.
  const installedRoot = basename(ownRoot) === manifest.version && basename(dirname(ownRoot)) === PLUGIN
    && basename(dirname(dirname(ownRoot))) === MARKETPLACE;
  if (apply && !installedRoot) throw new Error('run_from_installed_plugin_required');
  const releaseLock = await acquireLock();
  if (!releaseLock) { console.log(JSON.stringify({ status: 'busy', changed: false })); return; }
  try {
    const inventory = () => runCli(codex, ['plugin', 'list', '--json']);
    const initial = inspectInstallation(await inventory());
    const verify = async (version, release) => {
      const target = resolve(dirname(ownRoot), version);
      if (!installedRoot || await realpath(target) !== target) throw new Error('invalid_installed_root');
      const options = { expectedVersion: version, expectedMcpUrl: MCP_URL, requirePluginVersionHeader: true };
      if (release !== null) {
        if (!/^[a-fA-F0-9]{64}$/.test(release?.packageDigest ?? '')) throw new Error('release_digest_unavailable');
        options.expectedDigest = release.packageDigest;
      }
      return validatePluginReleaseCandidate(target, options).packageDigest;
    };
    const result = await updatePlugin({
      apply,
      inventory,
      readSource: () => readMarketplaceSource(codex),
      // A new checker per phase avoids treating the preflight's cached release
      // as the publication after a concurrent Git update.
      check: installedVersion => createPluginUpdateChecker().check(installedVersion),
      upgrade: () => runCli(codex, ['plugin', 'marketplace', 'upgrade', MARKETPLACE, '--json'], 120_000),
      repair: () => runCli(codex, ['plugin', 'add', ID, '--json'], 90_000),
      snapshot: async (version, release) => {
        const current = inspectInstallation(await inventory());
        if (initial.error || current.error || current.sourcePath !== initial.sourcePath) return false;
        const localRelease = parsePluginRelease(JSON.parse(await readFile(join(dirname(dirname(current.sourcePath)), 'release.json'), 'utf8')));
        if (localRelease.latestVersion !== version || localRelease.packageDigest !== release.packageDigest) return false;
        validatePluginReleaseCandidate(current.sourcePath, { expectedVersion: version, expectedMcpUrl: MCP_URL,
          requirePluginVersionHeader: true, expectedDigest: release.packageDigest });
        return true;
      },
      verify,
    });
    console.log(JSON.stringify(result));
  } finally { await releaseLock(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.log(JSON.stringify({ status: 'host_unavailable', changed: null })); process.exitCode = 2; });
}
