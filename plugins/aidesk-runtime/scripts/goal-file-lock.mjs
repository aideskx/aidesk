/** Same-process native lock for the goal Plugin's local recovery store.
 * Only a same-package, hash-checked native artifact may load by default.
 * Explicit artifactRoot is a development/test seam, never Hook event input.
 * No downloads, compilers, lock-age guesses, PID probes or directory deletion.
 */
import { constants, openSync, closeSync, lstatSync, fstatSync, readFileSync, writeFileSync,
  fsyncSync, linkSync, unlinkSync, realpathSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const loadedBindings = new Map();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const header = Buffer.from('aidesk-goal-file-lock-v1\n');
const sourcePath = fileURLToPath(new URL('./goal-file-lock.c', import.meta.url));
const packagedRoot = resolve(fileURLToPath(new URL(`./native/goal-file-lock/${process.platform}-${process.arch}/`, import.meta.url)));
export class GoalFileLockError extends Error {
  constructor(code, options) { super(code, options); this.code = code; }
}
const need = (ok, code) => { if (!ok) throw new GoalFileLockError(code); };
const regular = info => info.isFile() && !info.isSymbolicLink();
function privateDirectory(path) {
  need(isAbsolute(path) && resolve(path) === path && realpathSync(path) === path, 'LOCK_DIRECTORY_UNSAFE');
  const info = lstatSync(path);
  need(info.isDirectory() && !info.isSymbolicLink(), 'LOCK_DIRECTORY_UNSAFE');
  if (process.platform !== 'win32') need(info.uid === process.getuid() && (info.mode & 0o777) === 0o700, 'LOCK_DIRECTORY_UNSAFE');
}
function syncDirectory(path) {
  // Windows directory fsync is not exposed by the Node fs API. This candidate
  // tests process termination, not power-loss durability on an untested OS.
  if (process.platform === 'win32') return;
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function loadGoalFileLockBinding({ artifactRoot = packagedRoot } = {}) {
  need(Number(process.versions.node.split('.')[0]) >= 20 && Number(process.versions.napi) >= 8, 'LOCK_RUNTIME_UNSUPPORTED');
  try {
    need(isAbsolute(artifactRoot) && resolve(artifactRoot) === artifactRoot && realpathSync(artifactRoot) === artifactRoot, 'LOCK_ARTIFACT_UNSAFE');
    const manifestPath = join(artifactRoot, 'artifact.json'), binaryPath = join(artifactRoot, 'goal-file-lock.node');
    for (const path of [manifestPath, binaryPath]) need(regular(lstatSync(path)), 'LOCK_ARTIFACT_UNSAFE');
    need(lstatSync(manifestPath).size <= 4096 && lstatSync(binaryPath).size <= 2 * 1024 * 1024, 'LOCK_ARTIFACT_UNSAFE');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    need(manifest?.contract === 'aidesk-goal-file-lock-artifact-v1' && manifest.platform === process.platform
      && manifest.arch === process.arch && manifest.napiVersion === 8 && manifest.nodeMinimum === 20
      && manifest.file === 'goal-file-lock.node' && /^[a-f0-9]{64}$/u.test(manifest.sha256)
      && manifest.sourceSha256 === hash(readFileSync(sourcePath)) && manifest.sha256 === hash(readFileSync(binaryPath)), 'LOCK_ARTIFACT_MISMATCH');
    const loaded = loadedBindings.get(binaryPath);
    if (loaded) {
      need(loaded.sha256 === manifest.sha256 && loaded.sourceSha256 === manifest.sourceSha256, 'LOCK_BINDING_CHANGED');
      return loaded.binding;
    }
    // Native require caches by path. Never verify new bytes while returning a
    // previously loaded module, or delete its cache entry to force unsafe reload.
    need(!require.cache[binaryPath], 'LOCK_BINDING_PRELOADED_UNVERIFIED');
    const binding = require(binaryPath);
    need(binding.napiVersion === 8 && typeof binding.tryLock === 'function' && typeof binding.unlock === 'function', 'LOCK_ARTIFACT_MISMATCH');
    loadedBindings.set(binaryPath, { binding, sha256: manifest.sha256, sourceSha256: manifest.sourceSha256 });
    return binding;
  } catch (error) {
    if (error instanceof GoalFileLockError) throw error;
    throw new GoalFileLockError(error.code === 'ENOENT' ? 'LOCK_BINDING_UNAVAILABLE' : 'LOCK_BINDING_UNVERIFIED', { cause: error });
  }
}
function openStableLock(path) {
  const parent = dirname(path);
  privateDirectory(parent);
  let existing;
  try { existing = lstatSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) need(regular(existing), existing.isDirectory() ? 'LEGACY_LOCK_REQUIRES_QUIESCENCE' : 'LOCK_FILE_UNSAFE');
  else {
    // Publish a complete immutable marker. A killed preparer can leave its own
    // temporary file, but never a half-written stable lock or an empty mkdir lock.
    const temporary = join(parent, `.goal-lock-${randomUUID()}.tmp`);
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { writeFileSync(fd, header); fsyncSync(fd); } finally { closeSync(fd); }
    try {
      try { linkSync(temporary, path); syncDirectory(parent); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    } finally { unlinkSync(temporary); syncDirectory(parent); }
  }
  const fd = openSync(path, constants.O_RDWR | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    need(regular(opened) && regular(current) && opened.ino === current.ino && opened.dev === current.dev
      && opened.size === BigInt(header.length), 'LOCK_FILE_UNSAFE');
    if (process.platform !== 'win32') need(opened.uid === BigInt(process.getuid()) && (opened.mode & 0o777n) === 0o600n, 'LOCK_FILE_UNSAFE');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}
export async function withGoalFileLock(path, run, { artifactRoot, timeoutMs = 500, pollMs = 10 } = {}) {
  need(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && typeof run === 'function', 'LOCK_ARGUMENTS_INVALID');
  need(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 5000
    && Number.isSafeInteger(pollMs) && pollMs >= 1 && pollMs <= 100, 'LOCK_ARGUMENTS_INVALID');
  const binding = loadGoalFileLockBinding({ artifactRoot });
  const fd = openStableLock(path), started = performance.now();
  let held = false;
  try {
    do {
      held = binding.tryLock(fd);
      if (held) break;
      if (performance.now() - started >= timeoutMs) throw new GoalFileLockError('GOAL_LOCK_BUSY');
      await delay(Math.min(pollMs, Math.max(1, timeoutMs - (performance.now() - started))));
    } while (!held);
    const opened = fstatSync(fd, { bigint: true }), current = lstatSync(path, { bigint: true });
    need(regular(current) && opened.ino === current.ino && opened.dev === current.dev, 'LOCK_FILE_CHANGED');
    need(readFileSync(fd).equals(header), 'LOCK_FILE_UNSAFE');
    return await run();
  } finally {
    try { if (held) binding.unlock(fd); } finally { closeSync(fd); }
    // Keep the inode and marker. The kernel owns liveness, not pathname age.
  }
}
