// Read-only fallback for an unavailable MCP release check. No account access,
// installation, background jobs or outer retry loop; the original updater owns
// release comparison, source protection and package verification semantics.
import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join, isAbsolute, delimiter, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { inspectInstallation, updatePlugin, runCli, readMarketplaceSource } from './update.mjs';
import { createPluginUpdateChecker } from './lib/release-check.mjs';
import { validatePluginReleaseCandidate } from './lib/package-integrity.mjs';

const ownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const safePath = value => typeof value === 'string' && isAbsolute(value)
  && value.length < 4096 && [...value].every(c => c.codePointAt(0) >= 32 && c.codePointAt(0) !== 127);

export function runProbe(executable, args, timeout) {
  return new Promise((accept, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(executable, args, { shell: false, cwd: tmpdir(), windowsHide: true,
      detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', bytes = 0, stopped = false, settled = false, killTimer, closeTimer;
    const stop = signal => { try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* Already exited. */ } };
    const finish = (error, value) => {
      if (settled) return; settled = true;
      if (stopped) stop('SIGKILL');
      clearTimeout(timer); clearTimeout(killTimer); clearTimeout(closeTimer);
      child.stdout.destroy(); child.stderr.destroy(); child.unref();
      if (error) reject(error); else accept(value);
    };
    const unavailable = () => Object.assign(new Error('host_probe_unavailable'), { terminal: stopped });
    const abort = () => {
      if (stopped) return; stopped = true; stop('SIGTERM');
      killTimer = setTimeout(() => stop('SIGKILL'), 100);
      // Never wait indefinitely for close, including inherited child pipes.
      closeTimer = setTimeout(() => finish(unavailable()), 500);
    };
    const timer = setTimeout(abort, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', part => { bytes += Buffer.byteLength(part); if (bytes > 32768) { output = ''; abort(); } else output += part; });
    child.stderr.resume();
    child.once('error', () => finish(unavailable()));
    child.once('close', code => { if (stopped || code !== 0) finish(unavailable()); else finish(null, output); });
  });
}

export async function discoverCodex({ explicit, platform = process.platform, path = process.env.PATH ?? '',
  exists = async candidate => { await access(candidate, constants.X_OK); return realpath(candidate); },
  command = runProbe,
  now = () => performance.now(), budgetMs = 6000 } = {}) {
  if (explicit !== undefined && !safePath(explicit)) return null;
  const candidates = explicit !== undefined ? [explicit] : [
    ...(platform === 'darwin' ? ['/Applications/ChatGPT.app/Contents/Resources/codex'] : []),
    ...path.split(delimiter).filter(safePath).map(directory => join(directory, platform === 'win32' ? 'codex.exe' : 'codex')),
  ];
  const deadline = now() + budgetMs;
  let attempts = 0;
  for (const candidate of [...new Set(candidates)]) {
    if (now() >= deadline || attempts >= 3) break;
    try {
      const executable = await exists(candidate);
      if (!safePath(executable)) continue;
      attempts++;
      const version = await command(executable, ['--version'], Math.max(1, Math.min(2000, deadline - now())));
      if (!/^codex-cli [0-9A-Za-z.+-]+\s*$/u.test(version) || now() >= deadline) continue;
      const help = await command(executable, ['plugin', '--help'], Math.max(1, Math.min(2000, deadline - now())));
      if (now() < deadline && /\bplugin\b/u.test(help) && /\bmarketplace\b/u.test(help)) return executable;
    } catch (error) { if (error.terminal) return null; /* Do not retry a timed-out or overflowing host process. */ }
  }
  return null;
}

export async function checkEntryUpdate({ discover = discoverCodex, explicit, nodeVersion = process.versions.node,
  inventory = codex => runCli(codex, ['plugin', 'list', '--json'], 5000),
  readSource = codex => readMarketplaceSource(codex, 5000),
  check = installed => createPluginUpdateChecker().check(installed),
  verify = async (version, release) => {
    // As in update.mjs, only the actual installed cache can vouch for its disk.
    if (basename(dirname(ownRoot)) !== 'aidesk-runtime' || basename(dirname(dirname(ownRoot))) !== 'aidesk')
      throw new Error('installed_package_required');
    const target = resolve(dirname(ownRoot), version);
    if (await realpath(target) !== target) throw new Error('invalid_installed_root');
    return validatePluginReleaseCandidate(target, { expectedVersion: version,
      expectedDigest: release.packageDigest, expectedMcpUrl: 'https://aideskx.com/mcp',
      requirePluginVersionHeader: true }).packageDigest;
  }, nodePath = process.execPath } = {}) {
  if (!/^\d+\./u.test(nodeVersion) || Number(nodeVersion.split('.')[0]) < 20)
    return { status: 'host_unavailable', reason: 'node_version_unsupported', changed: false };
  let codex;
  try {
    codex = await discover({ explicit });
    if (!codex) return { status: 'host_unavailable', changed: false };
    const value = await inventory(codex);
    const installed = inspectInstallation(value);
    if (installed.error) return { status: 'blocked', reason: installed.error, changed: false };
    const result = await updatePlugin({ apply: false, inventory: async () => value,
      readSource: () => readSource(codex), check, verify });
    return { ...result, host: { nodePath, codexPath: codex } };
  } catch { return { status: 'check_unavailable', changed: false }; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let explicit;
  let valid = true;
  for (let n = 0; n < args.length; n++) {
    if (args[n] === '--codex' && explicit === undefined && args[n + 1]) explicit = args[++n];
    else if (args[n] !== '--check') valid = false;
  }
  const result = valid ? await checkEntryUpdate({ explicit })
    : { status: 'host_unavailable', reason: 'invalid_arguments', changed: false };
  console.log(JSON.stringify(result));
}
