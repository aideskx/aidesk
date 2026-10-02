import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HostDataBindingError } from './rpc-client.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/u;
const fail = () => { throw new HostDataBindingError('helper_artifact_unavailable'); };
async function regular(url, max) {
  const item = await lstat(url);
  if (!item.isFile() || item.isSymbolicLink() || item.nlink !== 1 || item.size < 1 || item.size > max) fail();
  return readFile(url);
}
// The artifact and sources must themselves be inside the distribution's exact
// package digest. This is build provenance, never a mutable user trust record.
export function validateArtifact(metadata, source, binary) {
  if (metadata?.schema !== 'aidesk-windows-helper-artifact-v1'
    || metadata.source !== 'windows-safe-io.cs' || metadata.executable !== 'windows-safe-io.exe'
    || metadata.runtime !== 'net-framework-4.x' || metadata.platform !== 'anycpu'
    || !HASH.test(metadata.sourceSha256 ?? '') || !HASH.test(metadata.executableSha256 ?? '')
    || hash(source) !== metadata.sourceSha256 || hash(binary) !== metadata.executableSha256) fail();
}
export async function verifiedHelperArtifact() {
  try {
    const metadata = JSON.parse(await regular(new URL('./native-bin/artifact.json', import.meta.url), 16384));
    const executable = new URL('./native-bin/windows-safe-io.exe', import.meta.url);
    const [source, binary] = await Promise.all([regular(new URL('./windows-safe-io.cs', import.meta.url), 262144), regular(executable, 4194304)]);
    validateArtifact(metadata, source, binary);
    return { executable: fileURLToPath(executable), sourceSha256: metadata.sourceSha256, executableSha256: metadata.executableSha256 };
  } catch { fail(); }
}
