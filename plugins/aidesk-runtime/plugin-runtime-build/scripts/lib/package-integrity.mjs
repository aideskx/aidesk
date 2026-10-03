// One package digest contract for runtime checks and release tooling. A bundled
// mode declaration is only authenticated by a trusted whole-package digest.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

export const MODE_FILE = '.codex-plugin/file-modes.json';
export const HOST_MCP_DECLARATION = Object.freeze({
  command: 'node', args: Object.freeze(['./scripts/host-task-server.mjs']), cwd: '.', env_vars: Object.freeze(['CODEX_HOME']),
});
const hash = value => createHash('sha256').update(value).digest('hex');
const need = (ok, kind) => { if (!ok) throw new Error(kind); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

export function validHostMcpDeclaration(value) {
  return exact(value, ['command', 'args', 'cwd', 'env_vars']) && value.command === 'node' && value.cwd === '.'
    && JSON.stringify(value.args) === JSON.stringify(HOST_MCP_DECLARATION.args)
    && JSON.stringify(value.env_vars) === JSON.stringify(HOST_MCP_DECLARATION.env_vars);
}
export function validatePackagePath(path) {
  need(typeof path === 'string' && path.length > 0 && path.length <= 1024 && path.isWellFormed()
    && !/[\\:<>"|?*\p{Cc}]/u.test(path), 'invalid_package_path');
  for (const part of path.split('/')) need(part && part !== '.' && part !== '..' && !/[. ]$/u.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part), 'invalid_package_path');
}
export function parsePackageModes(bytes) {
  need(bytes.byteLength <= 1_048_576, 'mode_manifest_too_large');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('invalid_mode_manifest'); }
  need(exact(value, ['format', 'algorithm', 'files']) && value.format === 1 && value.algorithm === 'git-file-modes-v1'
    && Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 4096, 'invalid_mode_manifest');
  const names = new Set();
  for (const entry of value.files) {
    need(exact(entry, ['path', 'gitMode']) && ['100644', '100755'].includes(entry.gitMode), 'invalid_mode_manifest');
    validatePackagePath(entry.path);
    const key = entry.path.toLowerCase(); need(!names.has(key), 'duplicate_package_path'); names.add(key);
  }
  need(value.files.some(entry => entry.path === MODE_FILE && entry.gitMode === '100644'), 'mode_manifest_self_missing');
  return value.files;
}
export function digestPackageFiles(records) {
  const sorted = records.map(({ path, gitMode, bytes }) => ({ path, gitMode, sha256: hash(bytes) }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return hash(JSON.stringify(sorted));
}
async function walk(root, directory = root, entries = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name), before = await lstat(file);
    need(!before.isSymbolicLink(), 'package_symlink');
    if (before.isDirectory()) await walk(root, file, entries);
    else {
      need(before.isFile(), 'package_entry_invalid');
      const path = relative(root, file).split(sep).join('/'); validatePackagePath(path);
      const bytes = await readFile(file), after = await lstat(file);
      need(after.isFile() && !after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino
        && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs
        && bytes.length === after.size, 'package_changed');
      entries.push({ path, bytes, mode: after.mode }); need(entries.length <= 4096, 'package_inventory_limit');
    }
  }
  return entries;
}

// Without trustedPackageDigest this is a measurement, never proof of origin.
// Windows uses declared Git modes; POSIX additionally checks actual execute bits.
// Missing mode manifests are rejected on every platform, with no legacy fallback.
export async function inspectPackageFiles(packageRoot, { trustedPackageDigest, platform = process.platform } = {}) {
  if (trustedPackageDigest !== undefined) need(/^[a-f0-9]{64}$/u.test(trustedPackageDigest), 'trusted_digest_required');
  const root = resolve(packageRoot), item = await lstat(root);
  need(item.isDirectory() && !item.isSymbolicLink() && resolve(await realpath(root)) === root, 'invalid_package_root');
  const actual = await walk(root), manifest = actual.find(entry => entry.path === MODE_FILE);
  need(manifest, 'mode_manifest_missing');
  const modes = parsePackageModes(manifest.bytes), byName = new Map(modes.map(entry => [entry.path, entry.gitMode]));
  need(actual.length === modes.length && actual.every(entry => byName.has(entry.path)), 'package_files_mismatch');
  const files = actual.map(entry => {
    const gitMode = byName.get(entry.path);
    if (platform !== 'win32') need(((entry.mode & 0o111) === 0 ? '100644' : '100755') === gitMode, 'package_mode_mismatch');
    return { path: entry.path, bytes: entry.bytes, gitMode, sha256: hash(entry.bytes) };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const packageDigest = digestPackageFiles(files);
  if (trustedPackageDigest !== undefined) need(packageDigest === trustedPackageDigest, 'package_digest_mismatch');
  return { files, packageDigest, packageDigestVerified: trustedPackageDigest !== undefined,
    modeSource: trustedPackageDigest === undefined ? 'bundled_declaration_unverified' : 'bundled_git_manifest_bound_to_trusted_release_digest',
    filesystemExecutableBitsChecked: platform !== 'win32', runtimeGitRequired: false };
}
