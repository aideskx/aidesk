// Internal worker adapter. This is not an MCP surface or a user profile file.
// Call only within an authorized dispatch after its exact stored-pair readback.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { TextDecoder } from 'node:util';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { sha256 } from './contract.mjs';
import { readCodexDefaultAppId } from './windows-backend.mjs';

const HASH = /^[a-f0-9]{64}$/u, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const PROFILE = 'codex_desktop_local_default_v1', WINDOWS_PROFILE = 'codex_windows_desktop_local_default_v1', LIMIT = 524288;
const LINUX_PROFILE = 'codex_linux_desktop_local_default_v1';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const textHash = v => createHash('sha256').update(v).digest('hex');
const path = v => typeof v === 'string' && !v.includes('\0') && isAbsolute(v) && resolve(v) === v;
const inside = (root, target) => { const r = relative(root, target); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };
const need = v => { if (!v) throw Error('desktop_entry_unqualified'); };
const ref = (e, hash) => `aidesk-host-entry:v1:${e.contextId}:${e.runId}:${e.threadId}:${hash}`;

function boundReadback(state) {
  if (!object(state) || !object(state.namespaceReadback) || !object(state.namespace)) return false;
  const p = state.namespaceReadback;
  return ['create', 'resume'].includes(state.action) && ['completed', 'interrupted', 'failed'].includes(state.status)
    && state.processExitVerified === true && UUID.test(state.threadId ?? '') && UUID.test(state.runId ?? '')
    && HASH.test(state.contextId ?? '') && HASH.test(state.intentSha256 ?? '') && HASH.test(state.sourceThreadIdSha256 ?? '')
    && p.status === 'stored' && p.nativeStoredPair === true && p.selectedHomePathEvidence === 'corroborated'
    && p.reason === null && HASH.test(p.readerReceiptSha256 ?? '')
    && p.contextId === state.contextId && p.runId === state.runId && p.threadId === state.threadId
    && p.intentSha256 === state.intentSha256 && p.sourceThreadIdSha256 === state.sourceThreadIdSha256
    && HASH.test(p.homeSha256 ?? '') && HASH.test(p.workspaceSha256 ?? '')
    && p.homeSha256 === state.namespace.homeSha256 && p.workspaceSha256 === state.namespace.workspaceSha256;
}

/** Public read projection only: no filesystem, process, navigation or registration. */
export function projectDesktopEntryProof({ proof, state }) {
  try {
    need(boundReadback(state) && exact(proof, ['evidence', 'evidenceSha256', 'evidenceRef', 'creationVisible', 'entryAccessible']));
    const e = proof.evidence, p = state.namespaceReadback;
    need(exact(e, ['format', 'profile', 'runAction', 'contextId', 'runId', 'threadId', 'hostId', 'intentSha256',
      'sourceThreadIdSha256', 'homeSha256', 'workspaceSha256', 'namespaceReceiptSha256', 'bundleMetadataSha256', 'entryUri'])
      && e.format === 1 && [PROFILE, WINDOWS_PROFILE, LINUX_PROFILE].includes(e.profile) && e.hostId === 'local' && e.runAction === state.action
      && ['contextId', 'runId', 'threadId', 'intentSha256', 'sourceThreadIdSha256'].every(k => e[k] === state[k])
      && e.homeSha256 === p.homeSha256 && e.workspaceSha256 === p.workspaceSha256
      && e.namespaceReceiptSha256 === p.readerReceiptSha256 && HASH.test(e.bundleMetadataSha256 ?? '')
      && e.entryUri === `codex://threads/${state.threadId}`
      && proof.evidenceSha256 === sha256(e) && proof.evidenceRef === ref(e, proof.evidenceSha256)
      && proof.creationVisible === true && proof.entryAccessible === 'unknown');
    return { evidence: { ...e }, evidenceSha256: proof.evidenceSha256, evidenceRef: proof.evidenceRef,
      creationVisible: true, entryAccessible: 'unknown' };
  } catch { return null; }
}

// macOS's existing binary/XML plist parser, fixed executable and fixed args.
// Raw public metadata goes over stdin; no caller-supplied file can reach plutil.
function convertPlist(bytes) {
  return new Promise((resolveResult, reject) => {
    const child = execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], {
      encoding: 'utf8', timeout: 1500, maxBuffer: LIMIT, killSignal: 'SIGKILL', windowsHide: true,
    }, (error, stdout) => error ? reject(Error('plist_unavailable')) : resolveResult(stdout));
    child.stdin.on('error', () => reject(Error('plist_unavailable')));
    child.stdin.end(bytes);
  });
}

async function readBundleMetadata(bundle, convert) {
  const file = join(bundle, 'Contents', 'Info.plist');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat(); need(before.isFile() && before.size > 0 && before.size <= LIMIT);
    const bytes = Buffer.alloc(before.size + 1); let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, null);
      if (!part.bytesRead) break; length += part.bytesRead;
    }
    const after = await handle.stat();
    need(length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs);
    const raw = bytes.subarray(0, length), converted = await convert(raw);
    need(typeof converted === 'string' && Buffer.byteLength(converted) <= LIMIT);
    const value = JSON.parse(converted); need(object(value));
    return { value, sha256: textHash(raw) };
  } finally { await handle.close(); }
}
function appAncestor(start) {
  let at = start;
  for (let n = 0; n < 24; n += 1) {
    if (basename(at).endsWith('.app')) return at;
    const parent = dirname(at); if (parent === at) return null; at = parent;
  }
  return null;
}

// Fixed, metadata-only OS queries. No caller value is evaluated as PowerShell.
// OpenAI's Windows launcher uses OpenAI.Codex_*!App (codex ff6aec, desktop_app/windows.rs).
// ASSOCF_IS_PROTOCOL uses current-user defaults; ASSOCSTR_APPID is the default
// AppUserModelID: learn.microsoft.com/windows/win32/shell/assocf_str and
// learn.microsoft.com/windows/win32/api/shlwapi/ne-shlwapi-assocstr.
const WINDOWS_METADATA_COMMAND = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1')) -ErrorAction Stop
  Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\Appx\Appx.psd1')) -ErrorAction Stop
  Import-Module ([System.IO.Path]::Combine($PSHOME, 'Modules\StartLayout\StartLayout.psd1')) -ErrorAction Stop
  $packages = @(Appx\Get-AppxPackage -Name 'OpenAI.Codex' -PackageTypeFilter Main)
  if ($packages.Count -ne 1) { throw 'package_unqualified' }
  $package = $packages[0]
  if ($package.Name -cne 'OpenAI.Codex' -or [string]$package.SignatureKind -cne 'Store' -or
      [string]$package.Status -cne 'Ok' -or $package.IsDevelopmentMode -ne $false -or
      $package.IsFramework -ne $false -or $package.IsResourcePackage -ne $false) { throw 'package_unqualified' }
  $appId = [string]$package.PackageFamilyName + '!App'
  $starts = @(StartLayout\Get-StartApps | Where-Object AppID -CEQ $appId)
  if ($starts.Count -ne 1) { throw 'registration_unqualified' }
  $manifest = Appx\Get-AppxPackageManifest -Package $package.PackageFullName
  $xml = [string]$manifest.OuterXml
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($xml)
  if ($bytes.Length -eq 0 -or $bytes.Length -gt 524288) { throw 'manifest_unqualified' }
  $ns = [System.Xml.XmlNamespaceManager]::new($manifest.NameTable)
  $ns.AddNamespace('f', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
  $ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
  $identities = $manifest.SelectNodes('/f:Package/f:Identity', $ns)
  $apps = $manifest.SelectNodes('/f:Package/f:Applications/f:Application[@Id="App"]', $ns)
  if ($identities.Count -ne 1 -or $apps.Count -ne 1) { throw 'manifest_unqualified' }
  $identity = $identities[0]
  if ($identity.GetAttribute('Name') -cne $package.Name -or
      $identity.GetAttribute('Publisher') -cne $package.Publisher -or
      $identity.GetAttribute('Version') -cne [string]$package.Version) { throw 'manifest_unqualified' }
  $protocols = $apps[0].SelectNodes('f:Extensions/uap:Extension[@Category="windows.protocol"]/uap:Protocol[@Name="codex"]', $ns)
  if ($protocols.Count -ne 1) { throw 'protocol_unqualified' }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $manifestHash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  $result = [ordered]@{
    format = 1; discovery = 'current_user_appx_start_apps'; packageName = [string]$package.Name
    packageFamilyName = [string]$package.PackageFamilyName; applicationId = 'App'; appUserModelId = $appId
    installLocation = [string]$package.InstallLocation
    applicationExecutable = $apps[0].GetAttribute('Executable'); protocol = 'codex'
    manifestDocumentSha256 = $manifestHash; signatureKind = [string]$package.SignatureKind
    status = [string]$package.Status; developmentMode = [bool]$package.IsDevelopmentMode
  }
  [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 3))
} catch { [Console]::Error.WriteLine('windows_desktop_metadata_unavailable'); exit 1 }
`;

/** Internal reader/test seam, never an MCP input. No app launch or association write. */
export function readWindowsDesktopMetadata({ systemRoot = process.env.SystemRoot, run = execFile,
  readDefaultAppId = readCodexDefaultAppId } = {}) {
  return new Promise((resolveResult, reject) => {
    if (!path(systemRoot)) { reject(Error('windows_desktop_metadata_unavailable')); return; }
    let child, commandComplete = false, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(deadline);
      if (!commandComplete) child?.kill?.('SIGKILL');
      if (error) reject(Error('windows_desktop_metadata_unavailable')); else resolveResult(value);
    };
    // One overall deadline, including the verified precompiled helper. Both
    // read-only queries start once; no retries or cumulative timeout extension.
    const deadline = setTimeout(() => finish(true), 8000);
    const metadata = new Promise((resolveMetadata, rejectMetadata) => {
      child = run(join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_METADATA_COMMAND, 'utf16le').toString('base64')],
        { encoding: 'utf8', timeout: 8000, maxBuffer: 32768, killSignal: 'SIGKILL', windowsHide: true, shell: false },
        (error, stdout, stderr) => {
          commandComplete = true;
          try {
            need(!error && !stderr && typeof stdout === 'string' && Buffer.byteLength(stdout) <= 32768);
            resolveMetadata(JSON.parse(stdout));
          } catch { rejectMetadata(Error('windows_desktop_metadata_unavailable')); }
        });
      child.stdin.on('error', () => rejectMetadata(Error('windows_desktop_metadata_unavailable')));
      child.stdin.end();
    });
    Promise.all([metadata, Promise.resolve().then(() => readDefaultAppId())]).then(([value, defaultAppId]) => {
      need(object(value) && !Object.hasOwn(value, 'defaultProtocolAppId')
        && typeof defaultAppId === 'string' && defaultAppId.length === 30
        && /^OpenAI\.Codex_[a-z0-9]{13}!App$/u.test(defaultAppId) && defaultAppId === value.appUserModelId);
      finish(false, { ...value, defaultProtocolAppId: defaultAppId });
    }).catch(() => finish(true));
  });
}

async function windowsMetadataHash(executable, readMetadata) {
  const m = await readMetadata();
  need(exact(m, ['format', 'discovery', 'packageName', 'packageFamilyName', 'applicationId', 'appUserModelId',
    'defaultProtocolAppId', 'installLocation', 'applicationExecutable', 'protocol', 'manifestDocumentSha256',
    'signatureKind', 'status', 'developmentMode']) && m.format === 1 && m.discovery === 'current_user_appx_start_apps'
    && m.packageName === 'OpenAI.Codex' && /^OpenAI\.Codex_[a-z0-9]{13}$/u.test(m.packageFamilyName)
    && m.applicationId === 'App' && m.appUserModelId === `${m.packageFamilyName}!App`
    && m.defaultProtocolAppId === m.appUserModelId && m.protocol === 'codex'
    && m.signatureKind === 'Store' && m.status === 'Ok' && m.developmentMode === false
    && HASH.test(m.manifestDocumentSha256 ?? '') && path(m.installLocation));
  const root = await realpath(m.installLocation);
  need(root === m.installLocation && (await stat(root)).isDirectory() && inside(root, executable)
    && typeof m.applicationExecutable === 'string' && m.applicationExecutable.length > 0
    && !/[:\0]/u.test(m.applicationExecutable) && !isAbsolute(m.applicationExecutable));
  const app = resolve(root, m.applicationExecutable);
  need(inside(root, app) && await realpath(app) === app && (await stat(app)).isFile());
  // Persist a digest, not user paths or the full public manifest.
  return sha256({ ...m, installLocation: textHash(root), applicationExecutable: textHash(app), executablePathSha256: textHash(executable) });
}

// Deliberately limited to the observed dpkg desktop package and its public
// launcher contract. Other package formats/launchers supply no proof. No version
// or binary digest is a capability requirement, and no application is launched.
const LINUX_LAUNCHER = '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/ChatGPT" "$@"\n';
const linuxFilePath = v => path(v) && !/[\r\n\t*?[\]\\]/u.test(v);
async function linuxPublicFile(file, uid, executable = false, read = false) {
  need(linuxFilePath(file) && await realpath(file) === file);
  const link = await lstat(file);
  need(link.isFile() && link.uid === uid && (link.mode & 0o022) === 0 && (!executable || (link.mode & 0o111) !== 0));
  // Pre-check refuses special files. NONBLOCK also prevents a file replaced by
  // a FIFO between lstat/open from blocking before the descriptor can be checked.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    need(before.isFile() && before.dev === link.dev && before.ino === link.ino
      && before.uid === uid && before.mode === link.mode && before.mtimeMs === link.mtimeMs && before.ctimeMs === link.ctimeMs);
    if (!read) return null;
    need(before.size > 0 && before.size <= LIMIT);
    const buffer = Buffer.alloc(before.size + 1); let length = 0;
    while (length < buffer.length) {
      const part = await handle.read(buffer, length, buffer.length - length, null);
      if (!part.bytesRead) break; length += part.bytesRead;
    }
    const after = await handle.stat(), bytes = buffer.subarray(0, length);
    need(length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs);
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256: textHash(bytes) };
  } finally { await handle.close(); }
}
function linuxDesktopKeys(text) {
  const keys = {}; let active = false, groups = 0;
  for (const line of text.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) { active = line === '[Desktop Entry]'; if (active) groups++; continue; }
    if (!active) continue;
    const match = /^([A-Za-z0-9-]+(?:\[[^\]\r\n]+\])?)=(.*)$/u.exec(line);
    need(match && !Object.hasOwn(keys, match[1])); keys[match[1]] = match[2];
  }
  need(groups === 1 && keys.Type === 'Application' && keys.MimeType?.split(';').includes('x-scheme-handler/codex')
    && (!keys.Hidden || keys.Hidden === 'false') && (!keys.Terminal || keys.Terminal === 'false')
    && (!keys.DBusActivatable || keys.DBusActivatable === 'false') && !keys.Path && !keys.TryExec);
  // This observed package uses an unquoted command name and one URL field.
  // Unknown Exec syntax is not interpreted or evaluated as a shell command.
  const exec = /^([A-Za-z0-9_./-]+) %([uU])$/u.exec(keys.Exec ?? '');
  need(exec && basename(exec[1]) === 'chatgpt' && (isAbsolute(exec[1]) || exec[1] === 'chatgpt'));
  return exec[1];
}

/** Internal metadata/test seam only. XDG lookup and dpkg ownership are both
 * required; a user override must not be bypassed by reading /usr/share directly.
 * https://specifications.freedesktop.org/basedir/latest/
 * https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html */
export async function readLinuxDesktopMetadata({ executable, userHome = homedir(), env = process.env,
  run = execFile, fileOwnerUid = 0 } = {}) {
  const end = Date.now() + 5000;
  const query = (file, args) => new Promise((resolveResult, reject) => {
    const timeout = end - Date.now(); if (timeout <= 0) { reject(Error('linux_desktop_metadata_unavailable')); return; }
    const child = run(file, args, { encoding: 'utf8', timeout, maxBuffer: 32768, killSignal: 'SIGKILL',
      shell: false, windowsHide: true, env: { ...env, LC_ALL: 'C', LANG: 'C' } }, (error, stdout, stderr) => {
      if (error || stderr || typeof stdout !== 'string' || Buffer.byteLength(stdout) > 32768 || Date.now() > end) reject(Error('linux_desktop_metadata_unavailable'));
      else resolveResult(stdout);
    });
    child.stdin.on('error', () => reject(Error('linux_desktop_metadata_unavailable'))); child.stdin.end();
  });
  try {
    // A staging/rootless dpkg database cannot attest this desktop installation.
    need(linuxFilePath(executable) && path(userHome) && !env.DPKG_ROOT && !env.DPKG_ADMINDIR);
    const defaultDesktopId = await query('/usr/bin/xdg-mime', ['query', 'default', 'x-scheme-handler/codex']);
    need(defaultDesktopId === 'chatgpt.desktop\n');
    const roots = [env.XDG_DATA_HOME || join(userHome, '.local/share'), ...(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')];
    need(roots.length <= 32 && roots.every(v => typeof v === 'string' && isAbsolute(v) && !v.includes('\0')));
    let desktopPath;
    for (const root of roots) {
      const candidate = join(root, 'applications', 'chatgpt.desktop');
      try { await lstat(candidate); desktopPath = candidate; break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    need(desktopPath);
    const desktop = await linuxPublicFile(desktopPath, fileOwnerUid, false, true), command = linuxDesktopKeys(desktop.text);
    let launcherPath = isAbsolute(command) ? command : null;
    if (!launcherPath) {
      const dirs = (env.PATH ?? '').split(':'); need(dirs.length <= 64 && dirs.every(v => path(v)));
      for (const dir of dirs) {
        const candidate = join(dir, command);
        try { await access(candidate, constants.X_OK); launcherPath = candidate; break; }
        catch (error) { if (!['ENOENT', 'EACCES'].includes(error.code)) throw error; }
      }
    }
    need(linuxFilePath(launcherPath));
    const launcherRealPath = await realpath(launcherPath), launcher = await linuxPublicFile(launcherRealPath, fileOwnerUid, true, true);
    need(launcher.text.replaceAll('\r\n', '\n') === LINUX_LAUNCHER);
    const applicationPath = join(dirname(launcherRealPath), 'ChatGPT');
    await linuxPublicFile(applicationPath, fileOwnerUid, true); await linuxPublicFile(executable, fileOwnerUid, true);
    const ownedPaths = [...new Set([executable, desktopPath, launcherPath, launcherRealPath, applicationPath])];
    need(ownedPaths.every(linuxFilePath));
    const ownership = await query('/usr/bin/dpkg-query', ['--search', '--', ...ownedPaths]);
    const ownershipLines = ownership.trimEnd().split('\n');
    need(ownershipLines.length === ownedPaths.length && ownedPaths.every(p => ownershipLines.filter(line => line === `chatgpt: ${p}`).length === 1));
    const packageText = await query('/usr/bin/dpkg-query', ['--show', '--showformat=${binary:Package}\n${Status}\n${Architecture}\n${Version}\n', '--', 'chatgpt']);
    const fields = packageText.split('\n');
    need(fields.length === 5 && fields[0] === 'chatgpt' && fields[1] === 'install ok installed'
      && /^(?:arm64|amd64)$/u.test(fields[2]) && /^[0-9][A-Za-z0-9.+:~-]*$/u.test(fields[3]) && fields[4] === '' && Date.now() <= end);
    return { format: 1, discovery: 'current_user_xdg_dpkg', packageName: 'chatgpt', status: fields[1],
      architecture: fields[2], version: fields[3], defaultDesktopId: 'chatgpt.desktop', protocol: 'codex',
      executablePath: executable, desktopPath, desktopSha256: desktop.sha256,
      launcherPath, launcherRealPath, launcherSha256: launcher.sha256, applicationPath, ownershipSha256: textHash(ownership) };
  } catch { throw Error('linux_desktop_metadata_unavailable'); }
}
async function linuxMetadataHash(executable, userHome, readMetadata) {
  const m = await readMetadata({ executable, userHome });
  need(exact(m, ['format', 'discovery', 'packageName', 'status', 'architecture', 'version', 'defaultDesktopId', 'protocol',
    'executablePath', 'desktopPath', 'desktopSha256', 'launcherPath', 'launcherRealPath', 'launcherSha256', 'applicationPath', 'ownershipSha256'])
    && m.format === 1 && m.discovery === 'current_user_xdg_dpkg' && m.packageName === 'chatgpt'
    && m.status === 'install ok installed' && ['arm64', 'amd64'].includes(m.architecture)
    && /^[0-9][A-Za-z0-9.+:~-]*$/u.test(m.version) && m.defaultDesktopId === 'chatgpt.desktop' && m.protocol === 'codex'
    && m.executablePath === executable && ['desktopSha256', 'launcherSha256', 'ownershipSha256'].every(k => HASH.test(m[k] ?? '')));
  for (const k of ['executablePath', 'desktopPath', 'launcherRealPath', 'applicationPath']) need(linuxFilePath(m[k]) && await realpath(m[k]) === m[k] && (await stat(m[k])).isFile());
  need(linuxFilePath(m.launcherPath) && await realpath(m.launcherPath) === m.launcherRealPath
    && m.applicationPath === join(dirname(m.launcherRealPath), 'ChatGPT'));
  return sha256({ ...m, ...Object.fromEntries(['executablePath', 'desktopPath', 'launcherPath', 'launcherRealPath', 'applicationPath'].map(k => [k, textHash(m[k])])) });
}

/** Worker-only owner inputs. deps is an internal test seam, not tool arguments.
 * Capability identities are fixed; CLI/app versions and binary hashes are not.
 * Any failure preserves the real task but supplies no creation proof. */
export async function buildDesktopEntryProof(input, deps = {}) {
  try {
    const platform = deps.platform ?? process.platform;
    need(exact(input, ['intent', 'state', 'namespace']) && ['darwin', 'win32', 'linux'].includes(platform));
    const { intent, state, namespace } = input;
    need(object(intent) && object(namespace) && boundReadback(state) && state.intentSha256 === sha256(intent)
      && ['contextId', 'runId', 'action', 'sourceThreadIdSha256'].every(k => intent[k] === state[k])
      && object(intent.namespace) && object(state.namespace)
      && ['home', 'workspace', 'homeSha256', 'workspaceSha256'].every(k => intent.namespace[k] === namespace[k] && state.namespace[k] === namespace[k])
      && path(namespace.home) && path(namespace.workspace) && path(intent.executable));
    // Do not assume a split SQLite state store is the desktop default profile.
    // Config files are not opened; known environment overrides fail closed.
    need(!(deps.sqliteHome ?? process.env.CODEX_SQLITE_HOME));
    const userHome = deps.userHome ?? homedir(); need(path(userHome));
    const defaultHome = await realpath(join(userHome, '.codex'));
    need((await stat(defaultHome)).isDirectory() && defaultHome === namespace.home
      && await realpath(namespace.home) === namespace.home && await realpath(namespace.workspace) === namespace.workspace
      && namespace.homeSha256 === textHash(namespace.home) && namespace.workspaceSha256 === textHash(namespace.workspace));
    const executable = await realpath(intent.executable); need(executable === intent.executable && (await stat(executable)).isFile());
    let bundleMetadataSha256;
    if (platform === 'win32') bundleMetadataSha256 = await windowsMetadataHash(executable, deps.readWindowsMetadata ?? readWindowsDesktopMetadata);
    else if (platform === 'linux') bundleMetadataSha256 = await linuxMetadataHash(executable, userHome, deps.readLinuxMetadata ?? readLinuxDesktopMetadata);
    else {
      const cliBundle = appAncestor(dirname(executable)); need(cliBundle);
      const desktopBundle = appAncestor(dirname(cliBundle)); need(desktopBundle && inside(desktopBundle, cliBundle));
      const convert = deps.convertPlist ?? convertPlist;
      const cli = await readBundleMetadata(cliBundle, convert);
      need(cli.value.CFBundleIdentifier === 'com.openai.codex.cli' && cli.value.CFBundleExecutable === 'codex'
        && executable === join(cliBundle, 'Contents', 'MacOS', 'codex'));
      const desktop = await readBundleMetadata(desktopBundle, convert);
      need(desktop.value.CFBundleIdentifier === 'com.openai.codex' && Array.isArray(desktop.value.CFBundleURLTypes)
        && desktop.value.CFBundleURLTypes.some(t => object(t) && Array.isArray(t.CFBundleURLSchemes) && t.CFBundleURLSchemes.includes('codex')));
      bundleMetadataSha256 = sha256({ cliMetadataSha256: cli.sha256, desktopMetadataSha256: desktop.sha256,
        cliBundleId: 'com.openai.codex.cli', desktopBundleId: 'com.openai.codex', uriScheme: 'codex' });
    }
    const evidence = { format: 1, profile: platform === 'win32' ? WINDOWS_PROFILE : platform === 'linux' ? LINUX_PROFILE : PROFILE, runAction: state.action, contextId: state.contextId, runId: state.runId,
      threadId: state.threadId, hostId: 'local', intentSha256: state.intentSha256,
      sourceThreadIdSha256: state.sourceThreadIdSha256, homeSha256: namespace.homeSha256, workspaceSha256: namespace.workspaceSha256,
      namespaceReceiptSha256: state.namespaceReadback.readerReceiptSha256, bundleMetadataSha256,
      entryUri: `codex://threads/${state.threadId}` };
    const evidenceSha256 = sha256(evidence);
    return projectDesktopEntryProof({ state, proof: { evidence, evidenceSha256, evidenceRef: ref(evidence, evidenceSha256),
      creationVisible: true, entryAccessible: 'unknown' } });
  } catch { return null; }
}
