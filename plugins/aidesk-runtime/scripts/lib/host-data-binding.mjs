import { constants } from 'node:fs';
import { link, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const SCHEMA = 'aidesk-host-data-binding-v1';
const MAX_JSON_BYTES = 1024 * 1024;
// Normalize the known module-directory suffix only. This does not resolve
// aliases/reparse points; the native inspector still checks every component.
const ownRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const digest = value => createHash('sha256').update(value).digest('hex');

export class HostDataBindingError extends Error {
  constructor(kind) { super(`host_data_binding:${kind}`); this.kind = kind; }
}
function fail(kind) { throw new HostDataBindingError(kind); }
let windowsBackend;
async function native(operation, ...args) {
  windowsBackend ??= import('./windows-backend.mjs');
  try { return await (await windowsBackend)[operation](...args); }
  catch (error) {
    if (/^[a-z_]{1,80}$/u.test(error?.kind ?? '')) fail(error.kind);
    fail('io_unavailable');
  }
}
async function safely(operation) {
  try { return await operation(); } catch (error) {
    if (error instanceof HostDataBindingError) throw error;
    fail(error?.code === 'ENOENT' ? 'not_found' : 'io_unavailable');
  }
}
function userId() {
  // These guarantees require POSIX ownership/modes and no-follow opens.
  // Do not silently claim the same protection on an unqualified platform.
  if (typeof process.getuid !== 'function' || !constants.O_NOFOLLOW) fail('unsupported_platform');
  return BigInt(process.getuid());
}
function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.length > 4096) fail('unsafe_path');
  const normalized = resolve(path);
  if (path.replace(/\/+$/u, '') !== normalized && path !== parse(path).root) fail('unsafe_path');
  return normalized;
}
function identity(item) {
  return { device: String(item.dev), inode: String(item.ino), owner: String(item.uid), born: String(item.birthtimeNs) };
}
function sameIdentity(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function privateItem(item, directory) {
  if (item.isSymbolicLink() || (directory ? !item.isDirectory() : !item.isFile())
    || item.uid !== userId() || Number(item.mode & 0o7777n) !== (directory ? 0o700 : 0o600)
    || (!directory && item.nlink !== 1n)) fail('unsafe_path');
}
async function inspectDirectory(path, { privateMode = false, owned = false } = {}) {
  if (process.platform === 'win32') return native('inspectDirectory', path, { privateMode, owned });
  const target = absolute(path), uid = userId();
  let current = parse(target).root, item;
  const parts = target.slice(current.length).split(/[\\/]/u).filter(Boolean);
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    item = await lstat(current, { bigint: true });
    if (!item.isDirectory() || item.isSymbolicLink() || (item.uid !== 0n && item.uid !== uid)) fail('unsafe_path');
    // Permit a system-owned sticky temporary ancestor, but never a writable
    // non-sticky ancestor. Private leaves are checked separately below.
    const writable = Number(item.mode & 0o022n) !== 0;
    if (writable && !(item.uid === 0n && (item.mode & 0o1000n) !== 0n)) fail('unsafe_path');
  }
  if (await realpath(target) !== target) fail('unsafe_path');
  if (privateMode) privateItem(item, true);
  if (owned && item.uid !== uid) fail('unsafe_path');
  return { path: target, identity: identity(item) };
}
async function unchanged(directory, options) {
  const current = await inspectDirectory(directory.path, options);
  if (!sameIdentity(current.identity, directory.identity)) fail('directory_changed');
}
async function syncDirectory(directory) {
  const handle = await open(directory.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const item = await handle.stat({ bigint: true });
    if (!item.isDirectory() || !sameIdentity(identity(item), directory.identity)) fail('directory_changed');
    await handle.sync();
  } finally { await handle.close(); }
}

// Internal filesystem helpers take only paths selected by package code. They
// are not MCP tool arguments. No helper repairs permissions or follows links.
export async function verifyPrivateDirectory(path) {
  return safely(() => inspectDirectory(path, { privateMode: true }));
}
export async function ensurePrivateDirectory(path) {
  if (process.platform === 'win32') return native('ensurePrivateDirectory', path);
  return safely(async () => {
    const target = absolute(path);
    const parent = await inspectDirectory(dirname(target));
    try { await lstat(target); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try { await mkdir(target, { mode: 0o700 }); } catch (creationError) {
        if (creationError?.code !== 'EEXIST') throw creationError;
      }
      await syncDirectory(parent);
    }
    await unchanged(parent);
    return inspectDirectory(target, { privateMode: true });
  });
}
export async function createPrivateDirectoryExclusive(path) {
  if (process.platform === 'win32') return native('createPrivateDirectoryExclusive', path);
  return safely(async () => {
    const target = absolute(path), parent = await inspectDirectory(dirname(target), { privateMode: true });
    try { await mkdir(target, { mode: 0o700 }); } catch (error) {
      if (error?.code === 'EEXIST') fail('already_exists');
      throw error;
    }
    await unchanged(parent, { privateMode: true });
    const directory = await inspectDirectory(target, { privateMode: true });
    await syncDirectory(parent);
    return directory;
  });
}

async function readBytes(path, maxBytes) {
  if (process.platform === 'win32') return native('readPrivateBytes', path, maxBytes);
  const target = absolute(path);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_JSON_BYTES) fail('invalid_limit');
  const parent = await inspectDirectory(dirname(target), { privateMode: true });
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true }); privateItem(before, false);
    if (before.size > BigInt(maxBytes)) fail('invalid_json');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await handle.stat({ bigint: true }); privateItem(after, false);
    const current = await lstat(target, { bigint: true }); privateItem(current, false);
    if (length !== Number(before.size) || after.size !== before.size || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs || !sameIdentity(identity(current), identity(before))) fail('file_changed');
    await unchanged(parent, { privateMode: true });
    const content = bytes.subarray(0, length);
    return { bytes: content, sha256: digest(content), identity: identity(before) };
  } finally { await handle.close(); }
}
function jsonResult(result) {
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)); } catch { fail('invalid_json'); }
  return { value, sha256: result.sha256, identity: result.identity };
}
async function readJson(path, maxBytes) { return jsonResult(await readBytes(path, maxBytes)); }
export async function readPrivateBytes(path, maxBytes = MAX_JSON_BYTES) { return safely(() => readBytes(path, maxBytes)); }
// The recovery owner must check an existing operation fence even when a row
// deduplicates. This acquires the same write lock without rewriting its bytes.
export async function readPrivateBytesLocked(path, maxBytes = MAX_JSON_BYTES) {
  if (process.platform === 'win32') return native('readPrivateBytesLocked', path, maxBytes);
  return safely(async () => {
    const target = absolute(path), parent = await inspectDirectory(dirname(target), { privateMode: true });
    const lockPath = `${target}.lock`;
    let lock;
    try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error?.code === 'EEXIST') fail('busy'); throw error; }
    let lockIdentity;
    try {
      const item = await lock.stat({ bigint: true }); privateItem(item, false); lockIdentity = identity(item);
      await lock.sync(); await syncDirectory(parent);
      return await readBytes(target, maxBytes);
    } finally {
      await lock.close(); await unchanged(parent, { privateMode: true });
      if (lockIdentity) await removeOwnedFile(lockPath, lockIdentity);
      await syncDirectory(parent);
    }
  });
}
export async function readPrivateJson(path, maxBytes = 65536) {
  return safely(() => readJson(path, maxBytes));
}
async function removeOwnedFile(path, expected) {
  const item = await lstat(path, { bigint: true }); privateItem(item, false);
  if (!sameIdentity(identity(item), expected)) fail('file_changed');
  await unlink(path);
}
async function writeBytes(path, encoded, expectedSha256) {
  if (!(encoded instanceof Uint8Array) || encoded.byteLength > MAX_JSON_BYTES) fail('invalid_bytes');
  encoded = Buffer.from(encoded);
  if (process.platform === 'win32') return expectedSha256 === null
    ? native('writePrivateBytesExclusive', path, encoded)
    : native('replacePrivateBytes', path, encoded, { expectedSha256 });
  const target = absolute(path), parent = await inspectDirectory(dirname(target), { privateMode: true });
  const lockPath = `${target}.lock`;
  let lock;
  try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if (error?.code === 'EEXIST') fail('busy'); throw error; }
  let temporary, temporaryIdentity, lockIdentity;
  try {
    const lockItem = await lock.stat({ bigint: true }); privateItem(lockItem, false); lockIdentity = identity(lockItem);
    await lock.sync(); await syncDirectory(parent);
    await unchanged(parent, { privateMode: true });
    if (expectedSha256 === null) {
      try { await lstat(target); fail('already_exists'); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    } else {
      const existing = await readBytes(target, MAX_JSON_BYTES);
      if (existing.sha256 !== expectedSha256) fail('file_changed');
    }
    temporary = join(parent.path, `.${basename(target)}.${randomUUID()}.tmp`);
    const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const item = await handle.stat({ bigint: true }); privateItem(item, false); temporaryIdentity = identity(item);
      await handle.writeFile(encoded); await handle.sync();
    } finally { await handle.close(); }
    await unchanged(parent, { privateMode: true });
    if (expectedSha256 === null) {
      // link publishes complete bytes without replacing an unexpectedly
      // created destination, even when that writer did not take our lock.
      try { await link(temporary, target); } catch (error) {
        if (error?.code === 'EEXIST') fail('already_exists');
        throw error;
      }
      await unlink(temporary);
    } else await rename(temporary, target);
    temporary = null;
    await syncDirectory(parent);
    await unchanged(parent, { privateMode: true });
    return await readBytes(target, MAX_JSON_BYTES);
  } finally {
    // An interrupted writer leaves its exclusive lock for explicit recovery;
    // never remove another writer's lock or retry an unknown mutation.
    try {
      if (temporary && temporaryIdentity) await removeOwnedFile(temporary, temporaryIdentity);
    } finally {
      await lock.close();
      await unchanged(parent, { privateMode: true });
      if (lockIdentity) await removeOwnedFile(lockPath, lockIdentity);
      await syncDirectory(parent);
    }
  }
}
async function writeJson(path, value, expectedSha256) {
  let encoded;
  try { const json = JSON.stringify(value); if (json === undefined) fail('invalid_json'); encoded = Buffer.from(`${json}\n`); }
  catch { fail('invalid_json'); }
  if (encoded.length > MAX_JSON_BYTES) fail('invalid_json');
  if (expectedSha256 !== null) await readJson(path, MAX_JSON_BYTES);
  return jsonResult(await writeBytes(path, encoded, expectedSha256));
}
export async function writePrivateBytesExclusive(path, bytes) { return safely(() => writeBytes(path, bytes, null)); }
export async function replacePrivateBytes(path, bytes, { expectedSha256 } = {}) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail('invalid_expected_digest');
  return safely(() => writeBytes(path, bytes, expectedSha256));
}
export async function writePrivateJsonExclusive(path, value) {
  return safely(() => writeJson(path, value, null));
}
export async function replacePrivateJson(path, value, { expectedSha256 } = {}) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail('invalid_expected_digest');
  return safely(() => writeJson(path, value, expectedSha256));
}
export async function removePrivateJson(path, { expectedSha256 } = {}) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail('invalid_expected_digest');
  await readPrivateJson(path, MAX_JSON_BYTES);
  return removePrivateBytes(path, { expectedSha256 });
}
export async function removePrivateBytes(path, { expectedSha256 } = {}) {
  if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256)) fail('invalid_expected_digest');
  if (process.platform === 'win32') return native('removePrivateBytes', path, { expectedSha256 });
  return safely(async () => {
    const target = absolute(path), parent = await inspectDirectory(dirname(target), { privateMode: true });
    const lockPath = `${target}.lock`;
    let lock;
    try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error?.code === 'EEXIST') fail('busy'); throw error; }
    let lockIdentity;
    try {
      const item = await lock.stat({ bigint: true }); privateItem(item, false); lockIdentity = identity(item);
      await lock.sync(); await syncDirectory(parent);
      const existing = await readBytes(target, MAX_JSON_BYTES);
      if (existing.sha256 !== expectedSha256) fail('file_changed');
      await unchanged(parent, { privateMode: true });
      await removeOwnedFile(target, existing.identity);
      await syncDirectory(parent); await unchanged(parent, { privateMode: true });
      return { removed: true, sha256: existing.sha256 };
    } finally {
      await lock.close();
      await unchanged(parent, { privateMode: true });
      if (lockIdentity) await removeOwnedFile(lockPath, lockIdentity);
      await syncDirectory(parent);
    }
  });
}

async function packageRoot() { return inspectDirectory(ownRoot, { owned: true }); }
async function registry(create) {
  const home = await inspectDirectory(homedir(), { owned: true });
  const product = join(home.path, '.aidesk-runtime'), bindings = join(product, 'host-bindings');
  if (create) { await ensurePrivateDirectory(product); await ensurePrivateDirectory(bindings); }
  else { await verifyPrivateDirectory(product); await verifyPrivateDirectory(bindings); }
  await unchanged(home, { owned: true });
  return bindings;
}
function bindingPath(directory, root) { return join(directory, `${digest(root.path)}.json`); }
function validateBinding(value, root) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'dataIdentity,dataRoot,pluginIdentity,pluginRoot,schema'
    || value.schema !== SCHEMA || value.pluginRoot !== root.path
    || !sameIdentity(value.pluginIdentity, root.identity)) fail('binding_conflict');
}
async function inspectBinding(file, root) {
  const stored = await readJson(file, 16384); validateBinding(stored.value, root);
  const data = await inspectDirectory(stored.value.dataRoot, { privateMode: true });
  if (!sameIdentity(data.identity, stored.value.dataIdentity)) fail('binding_conflict');
  await unchanged(root, { owned: true });
  // This is a historical path observation, NOT current Hook trust or a fresh
  // reservation witness. The local owner must enforce its separate handoff.
  return { pluginRoot: root.path, dataRoot: data.path, bindingSha256: stored.sha256 };
}

// The host may supply PLUGIN_DATA before any of its missing parent directories
// exist. Only this Hook-owned bootstrap walks upward; the shared leaf helper
// still requires its parent. Existing safe parents retain their permissions.
async function ensureHookDataDirectory(path) {
  const target = absolute(path), missing = [];
  let current = target, anchor;
  while (!anchor) {
    try { anchor = await inspectDirectory(current, { owned: true }); }
    catch (error) {
      if (error?.code !== 'ENOENT' && error?.kind !== 'not_found') throw error;
      missing.push(current);
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  for (const directory of missing.reverse()) {
    await unchanged(anchor, { owned: true });
    await ensurePrivateDirectory(directory);
  }
  await unchanged(anchor, { owned: true });
  return inspectDirectory(target, { privateMode: true });
}

// Call only from the real Hook entry point with host-provided environment.
// No model-selected path, package root or caller trust boolean is accepted.
export async function registerHostDataBinding() {
  return safely(async () => {
    const root = await packageRoot();
    const supplied = await inspectDirectory(process.env.PLUGIN_ROOT, { owned: true });
    if (supplied.path !== root.path || !sameIdentity(supplied.identity, root.identity)) fail('package_root_mismatch');
    const dataPath = absolute(process.env.PLUGIN_DATA);
    const file = bindingPath(await registry(true), root);
    let stored;
    try { stored = await readJson(file, 16384); } catch (error) { if (error?.code !== 'ENOENT' && error?.kind !== 'not_found') throw error; }
    if (stored) {
      validateBinding(stored.value, root);
      if (stored.value.dataRoot !== dataPath) fail('binding_conflict');
      return { ...await inspectBinding(file, root), registered: false };
    }
    const data = await ensureHookDataDirectory(dataPath);
    const value = { schema: SCHEMA, pluginRoot: root.path, pluginIdentity: root.identity,
      dataRoot: data.path, dataIdentity: data.identity };
    await writeJson(file, value, null);
    await unchanged(data, { privateMode: true });
    return { ...await inspectBinding(file, root), registered: true };
  });
}
export async function readHostDataBinding() {
  return safely(async () => {
    const root = await packageRoot();
    return inspectBinding(bindingPath(await registry(false), root), root);
  });
}
