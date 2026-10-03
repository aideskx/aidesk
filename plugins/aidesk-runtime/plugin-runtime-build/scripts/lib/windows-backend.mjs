import { win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { createRpcClient, HostDataBindingError } from './rpc-client.mjs';
import { verifiedHelperArtifact } from './helper-artifact.mjs';
export { HostDataBindingError } from './rpc-client.mjs';
const fail = kind => { throw new HostDataBindingError(kind); };
const HASH = /^[a-f0-9]{64}$/u, LIMIT = 1048576;
let ownerPromise;

async function owner() {
  if (process.platform !== 'win32') fail('unsupported_platform');
  if (!ownerPromise) ownerPromise = (async () => {
    const artifact = await verifiedHelperArtifact();
    // No runtime compilation, PowerShell, PATH search or environment lookup.
    // Original 2200 ms / 2000 ms bounds remain unchanged.
    return createRpcClient({ executable: artifact.executable, args: [] });
  })();
  return ownerPromise;
}
function path(path) {
  if (typeof path !== 'string' || path.length > 4096 || !/^[A-Za-z]:\\/u.test(path)
    || path.includes('/') || path.includes('\0') || path.slice(2).includes(':')
    || (path.length > 3 && path.endsWith('\\')) || win32.normalize(path) !== path) fail('unsafe_path');
  return path;
}
function limit(value) { if (!Number.isSafeInteger(value) || value < 1 || value > LIMIT) fail('invalid_limit'); return value; }
function expected(value) { if (typeof value !== 'string' || !HASH.test(value)) fail('invalid_expected_digest'); return value; }
function bytes(value) {
  let raw; try { const json = JSON.stringify(value); if (json === undefined) fail('invalid_json'); raw = Buffer.from(`${json}\n`); }
  catch { fail('invalid_json'); }
  if (raw.length > LIMIT) fail('invalid_json'); return raw;
}
function decodeBytes(result) {
  if (!result || typeof result.base64 !== 'string' || typeof result.sha256 !== 'string' || !HASH.test(result.sha256)
    || !result.identity || Object.keys(result.identity).sort().join(',') !== 'born,device,inode,owner'
    || !Object.values(result.identity).every(v => typeof v === 'string' && v.length > 0)) fail('helper_protocol_failed');
  const raw = Buffer.from(result.base64, 'base64');
  if (raw.toString('base64') !== result.base64 || createHash('sha256').update(raw).digest('hex') !== result.sha256) fail('helper_protocol_failed');
  return { bytes: raw, sha256: result.sha256, identity: result.identity };
}
function decode(result) {
  const raw = decodeBytes(result);
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw.bytes)); } catch { fail('invalid_json'); }
  return { value, sha256: raw.sha256, identity: raw.identity };
}
function rawBytes(value) {
  if (!(value instanceof Uint8Array) || value.byteLength > LIMIT) fail('invalid_bytes');
  return Buffer.from(value).toString('base64');
}
export async function readPrivateBytes(file, maxBytes = LIMIT) {
  return decodeBytes(await call('read', { path: path(file), limit: limit(maxBytes) }));
}
export async function readPrivateBytesLocked(file, maxBytes = LIMIT) {
  return decodeBytes(await call('read_locked', { path: path(file), limit: limit(maxBytes) }));
}
export async function writePrivateBytesExclusive(file, value) {
  return decodeBytes(await call('write', { path: path(file), base64: rawBytes(value) }));
}
export async function replacePrivateBytes(file, value, { expectedSha256 } = {}) {
  return decodeBytes(await call('replace', { path: path(file), base64: rawBytes(value), expectedSha256: expected(expectedSha256) }));
}
export async function removePrivateBytes(file, { expectedSha256 } = {}) {
  return call('remove', { path: path(file), expectedSha256: expected(expectedSha256) });
}
async function call(op, values) { return (await owner()).call(op, values); }
export async function inspectDirectory(directory, { privateMode = false, owned = false } = {}) {
  return call('inspect', { path: path(directory), privateMode, owned });
}
export async function verifyPrivateDirectory(directory) { return inspectDirectory(directory, { privateMode: true }); }
export async function ensurePrivateDirectory(directory) { return call('ensure', { path: path(directory) }); }
export async function createPrivateDirectoryExclusive(directory) { return call('mkdir_exclusive', { path: path(directory) }); }
export async function readPrivateJson(file, maxBytes = 65536) { return decode(await call('read', { path: path(file), limit: limit(maxBytes) })); }
export async function writePrivateJsonExclusive(file, value) { return decode(await call('write', { path: path(file), base64: bytes(value).toString('base64') })); }
export async function replacePrivateJson(file, value, { expectedSha256 } = {}) {
  return decode(await call('replace', { path: path(file), base64: bytes(value).toString('base64'), expectedSha256: expected(expectedSha256) }));
}
export async function removePrivateJson(file, { expectedSha256 } = {}) {
  return call('remove', { path: path(file), expectedSha256: expected(expectedSha256) });
}
// Internal fixed-query result validator; no protocol/path/user is configurable.
export function validateCodexDefaultAppId(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'defaultProtocolAppId')
    || typeof value.defaultProtocolAppId !== 'string' || value.defaultProtocolAppId.length !== 30
    || !/^OpenAI\.Codex_[a-z0-9]{13}!App$/u.test(value.defaultProtocolAppId)) fail('helper_protocol_failed');
  return value.defaultProtocolAppId;
}
export async function readCodexDefaultAppId() { return validateCodexDefaultAppId(await call('codex_default_app_id')); }
export async function backendDiagnostics() { return call('ping'); }
export async function closeWindowsBackend() { if (ownerPromise) await (await ownerPromise).close(); }
