// Same-package update owner. Transport metadata identifies the caller; model
// arguments never select paths, executables, adapters, or source witnesses.
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { runUpdater, updateFromHost, fetchRelease, inspectPackage, compareVersions } from '../update.mjs';
import { readHostSource } from '../domain/host-task-contract.mjs';
import { sha256 } from './contract.mjs';
import { ensurePrivateDirectory, verifyPrivateDirectory, createPrivateDirectoryExclusive,
  readPrivateJson, writePrivateJsonExclusive, removePrivateJson } from './host-data-binding.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+codex\.\d{14})?$/u;
const WINDOW_MS = 15 * 60 * 1000;
const AVAILABLE = new Set(['update_available', 'update_required']);
const STATUSES = new Set([...AVAILABLE, 'current', 'ahead', 'installed_pending_activation', 'unknown', 'failed']);
const REASONS = new Set(['host_unavailable', 'marketplace_source_unavailable', 'pinned_source', 'release_unavailable', 'release_invalid',
  'package_verification_failed', 'package_changed', 'readback_failed', 'source_changed', 'installed_version_changed', 'installed_version_mismatch',
  'host_command_timeout', 'host_command_failed', 'update_busy', 'invalid_host_inventory', 'ambiguous_plugin', 'plugin_not_installed',
  'plugin_disabled', 'different_installation_source', 'invalid_source_path', 'unrecognized_installed_version', 'apply_outcome_unknown', 'updater_result_invalid', 'updater_failure', 'ticket_expired', 'update_guard_rejected']);
const PHASES = new Set(['arguments', 'cli_discovery', 'lock_acquire', 'update_execution', 'lock_release', 'source_read']);
const KINDS = new Set(['spawn', 'process_exit', 'protocol', 'projection', 'timeout', 'unavailable', 'unknown']);
const CODES = new Set(['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EEXIST', 'EROFS', 'ENOSPC', 'EDQUOT', 'EMFILE', 'ENFILE', 'EIO',
  'EBADF', 'EINVAL', 'ENOMEM', 'ETIMEDOUT', 'EAGAIN', 'EBUSY', 'ESRCH']);
const TICKET_KEYS = ['format', 'sourceSha256', 'homeSha256', 'currentVersion', 'targetVersion', 'targetDigest', 'issuedAt', 'expiresAt'];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const version = value => typeof value === 'string' && value.length <= 64 && VERSION.test(value);
const stamp = value => new Date(value).toISOString();
class UpdateOwnerError extends Error { constructor(kind) { super(kind); this.kind = kind; } }
const need = (ok, kind) => { if (!ok) throw new UpdateOwnerError(kind); };
const unknown = (reason, changed = null) => ({ status: 'unknown', changed, reason });
const reply = (action, value, ticket) => ({ ...value, action, ...(ticket ? { ticket } : {}),
  automaticRetry: false, connectionActivationVerified: false });
const loadedReply = value => reply('check', { ...value, changed: false, scope: 'loaded_package',
  installationVerified: false, configuredSourceVerified: false,
  loadedPackageDigestVerified: value.loadedPackageDigestVerified === true });
async function optional(path) {
  try { return await readPrivateJson(path, 16384); } catch (error) { if (error.kind === 'not_found') return null; throw error; }
}

// Project only the updater's public contract. No arbitrary error text or
// adapter-returned properties reach a durable receipt or a tool response.
function project(value) {
  if (!plain(value) || !STATUSES.has(value.status) || ![true, false, null].includes(value.changed)) return unknown('updater_result_invalid');
  const result = { status: value.status, changed: value.changed };
  for (const key of ['previousVersion', 'installedVersion', 'targetVersion', 'minimumSupportedVersion']) {
    if (version(value[key])) result[key] = value[key];
  }
  if (HASH.test(value.packageDigest ?? '')) result.packageDigest = value.packageDigest;
  if (value.pluginId === 'aidesk-runtime@aidesk') result.pluginId = value.pluginId;
  if (value.reason !== undefined) result.reason = REASONS.has(value.reason) ? value.reason : 'updater_failure';
  if (typeof value.commandReportedError === 'boolean') result.commandReportedError = value.commandReportedError;
  if (Array.isArray(value.diagnostics)) result.diagnostics = value.diagnostics.slice(0, 8).filter(d => plain(d) && PHASES.has(d.phase)).map(d => ({
    phase: d.phase, code: CODES.has(d.code) ? d.code : null, ...(KINDS.has(d.kind) ? { kind: d.kind } : {}),
    ...(Number.isInteger(d.exitCode) && d.exitCode >= 0 && d.exitCode <= 255 ? { exitCode: d.exitCode } : {}),
  }));
  return result;
}

function validateTicket(value) {
  need(exact(value, TICKET_KEYS) && value.format === 1 && HASH.test(value.sourceSha256) && HASH.test(value.homeSha256)
    && version(value.currentVersion) && version(value.targetVersion) && HASH.test(value.targetDigest)
    && Number.isSafeInteger(value.issuedAt) && value.expiresAt - value.issuedAt === WINDOW_MS, 'invalid_ticket');
  return value;
}
function keyFor(ticket) {
  // The target digest is deliberately excluded: a republished version must not
  // evade an earlier unknown attempt for this installed -> target transition.
  return sha256({ homeSha256: ticket.homeSha256, currentVersion: ticket.currentVersion, targetVersion: ticket.targetVersion });
}

/** Internal construction seam for package tests, never an MCP argument. */
export function createHostUpdateOwner({ productRoot = join(homedir(), '.aidesk-runtime'),
  hostHome = () => resolve(process.env.CODEX_HOME || join(homedir(), '.codex')),
  now = Date.now, updater = runUpdater, execute = updateFromHost, release = fetchRelease, packageRoot } = {}) {
  const root = join(productRoot, 'updates'), tickets = join(root, 'tickets'), attempts = join(root, 'attempts');
  async function layout(create = false) {
    for (const path of [productRoot, root, tickets, attempts]) await (create ? ensurePrivateDirectory : verifyPrivateDirectory)(path);
  }
  async function load(handle, sourceSha256, homeSha256) {
    need(typeof handle === 'string' && HASH.test(handle), 'invalid_ticket');
    await layout(); const directory = join(tickets, handle); await verifyPrivateDirectory(directory);
    const ticket = validateTicket((await readPrivateJson(join(directory, 'ticket.json'), 16384)).value);
    need(ticket.sourceSha256 === sourceSha256 && ticket.homeSha256 === homeSha256, 'source_mismatch');
    return { handle, directory, ticket };
  }
  async function status(prepared) {
    const intent = await optional(join(prepared.directory, 'apply-intent.json'));
    if (!intent) {
      const claim = await optional(join(attempts, `${keyFor(prepared.ticket)}.json`));
      return reply('status', claim?.value?.ticket === prepared.handle ? unknown('apply_outcome_unknown') : unknown('apply_not_started', false), prepared.handle);
    }
    need(exact(intent.value, ['format', 'ticket', 'attemptKey', 'at']) && intent.value.format === 1
      && intent.value.ticket === prepared.handle && intent.value.attemptKey === keyFor(prepared.ticket), 'invalid_intent');
    const saved = await optional(join(prepared.directory, 'result.json'));
    if (!saved) return reply('status', unknown('apply_outcome_unknown'), prepared.handle);
    need(exact(saved.value, ['format', 'ticket', 'outcome', 'knownBeforeExecution', 'at']) && saved.value.format === 1
      && saved.value.ticket === prepared.handle && typeof saved.value.knownBeforeExecution === 'boolean', 'invalid_result');
    return reply('status', project(saved.value.outcome), prepared.handle);
  }
  async function existing(claim, sourceSha256, homeSha256) {
    need(exact(claim.value, ['format', 'ticket', 'sourceSha256', 'homeSha256', 'attemptKey']) && claim.value.format === 1
      && HASH.test(claim.value.ticket) && HASH.test(claim.value.sourceSha256) && claim.value.homeSha256 === homeSha256, 'invalid_intent');
    if (claim.value.sourceSha256 !== sourceSha256) return reply('status', unknown('existing_update_attempt'));
    const prepared = await load(claim.value.ticket, sourceSha256, homeSha256);
    need(claim.value.attemptKey === keyFor(prepared.ticket), 'invalid_intent');
    const result = await status(prepared);
    // A claimed attempt without its intent is an interrupted handoff, not a
    // fresh check ticket that another process may dispatch.
    return result.reason === 'apply_not_started' ? reply('status', unknown('apply_outcome_unknown'), prepared.handle) : result;
  }
  async function checkLoadedPackage() {
    // Only this module's package directory and the fixed public release GET.
    // CLI discovery/list/config startup can mutate host state, so none of those
    // adapters, nor the update receipt directory, belong to this read path.
    let before, published, after;
    try { before = await inspectPackage(packageRoot); }
    catch { return loadedReply(unknown('package_verification_failed', false)); }
    const loaded = { loadedVersion: before.version, loadedPackageDigest: before.packageDigest };
    try { published = await release(); }
    catch (error) { return loadedReply({ ...loaded, ...unknown(error?.message === 'release_invalid' ? 'release_invalid' : 'release_unavailable', false) }); }
    const comparison = compareVersions(before.version, published?.latestVersion);
    if (comparison === undefined || !version(published?.minimumSupportedVersion) || !HASH.test(published?.packageDigest ?? '')
      || compareVersions(published.minimumSupportedVersion, published.latestVersion) === 1)
      return loadedReply({ ...loaded, ...unknown('release_invalid', false) });
    const target = { ...loaded, targetVersion: published.latestVersion, publishedPackageDigest: published.packageDigest,
      minimumSupportedVersion: published.minimumSupportedVersion };
    try { after = await inspectPackage(packageRoot, comparison === 0 ? { trustedPackageDigest: published.packageDigest } : {}); }
    catch { return loadedReply({ ...target, ...unknown('package_verification_failed', false) }); }
    if (before.version !== after.version || before.packageDigest !== after.packageDigest)
      return loadedReply({ ...target, ...unknown('package_changed', false) });
    if (comparison === 0 && before.packageDigest !== published.packageDigest)
      return loadedReply({ ...target, ...unknown('package_verification_failed', false) });
    // These are bounded package observations, not installation/source proof or
    // permission to retry an earlier unknown installation attempt.
    return loadedReply({ ...target, loadedPackageDigestVerified: after.packageDigestVerified, status: comparison === 0 ? 'loaded_current' : comparison > 0 ? 'loaded_ahead'
      : compareVersions(before.version, published.minimumSupportedVersion) === -1 ? 'update_required' : 'update_available' });
  }
  async function prepare(sourceSha256, homeSha256) {
    const outcome = project((await updater(['--check'], { execute: options => execute({ ...options, release }) })).result);
    if (!AVAILABLE.has(outcome.status)) return reply('prepare', outcome);
    need(version(outcome.installedVersion) && version(outcome.targetVersion) && HASH.test(outcome.packageDigest ?? ''), 'invalid_check_result');
    const at = now(); need(Number.isSafeInteger(at), 'invalid_time');
    const ticket = { format: 1, sourceSha256, homeSha256, currentVersion: outcome.installedVersion,
      targetVersion: outcome.targetVersion, targetDigest: outcome.packageDigest, issuedAt: at, expiresAt: at + WINDOW_MS };
    await layout(true);
    const claimed = await optional(join(attempts, `${keyFor(ticket)}.json`));
    if (claimed) return { ...await existing(claimed, sourceSha256, homeSha256), action: 'prepare' };
    const handle = randomBytes(32).toString('hex'), directory = join(tickets, handle);
    await createPrivateDirectoryExclusive(directory);
    await writePrivateJsonExclusive(join(directory, 'ticket.json'), ticket);
    return reply('prepare', { ...outcome, expiresAt: stamp(ticket.expiresAt) }, handle);
  }
  async function apply(prepared, sourceSha256, homeSha256) {
    const { ticket, directory, handle } = prepared;
    if (await optional(join(directory, 'apply-intent.json'))) return { ...await status(prepared), action: 'apply' };
    const attemptKey = keyFor(ticket), claimPath = join(attempts, `${attemptKey}.json`);
    const previous = await optional(claimPath);
    if (previous) return { ...await existing(previous, sourceSha256, homeSha256), action: 'apply' };
    const validWindow = () => need(now() >= ticket.issuedAt && now() < ticket.expiresAt, 'ticket_expired');
    validWindow();
    // Fail ordinary validation before consuming the transition. A fresh check
    // remains possible after a known target/source/version validation error.
    const fresh = project((await updater(['--check'], { execute: options => execute({ ...options, release }) })).result);
    if (!AVAILABLE.has(fresh.status) || fresh.installedVersion !== ticket.currentVersion
      || fresh.targetVersion !== ticket.targetVersion || fresh.packageDigest !== ticket.targetDigest) {
      return reply('apply', unknown('ticket_check_changed', false), handle);
    }
    validWindow();
    let claim;
    try {
      claim = await writePrivateJsonExclusive(claimPath, { format: 1, ticket: handle, sourceSha256, homeSha256, attemptKey });
      await writePrivateJsonExclusive(join(directory, 'apply-intent.json'), { format: 1, ticket: handle, attemptKey, at: stamp(now()) });
    } catch {
      // Another writer or an interrupted durable publication may own it. Do
      // not remove fences or reinterpret an incomplete receipt as permission.
      return reply('apply', unknown('apply_outcome_unknown'), handle);
    }
    let entered = false, completed = false, outcome, knownBeforeExecution = false;
    try {
      const result = await updater(['--apply'], { execute: options => {
        entered = true;
        return execute({ ...options, expectedInstalledVersion: ticket.currentVersion, assertMayMutate: validWindow, release: async () => {
          validWindow(); const published = await release();
          need(published.latestVersion === ticket.targetVersion && published.packageDigest === ticket.targetDigest, 'ticket_target_changed');
          return published;
        } });
      } });
      outcome = project(result.result); completed = true;
      knownBeforeExecution = !entered && outcome.status === 'unknown' && outcome.changed === false
        && ['update_busy', 'host_unavailable'].includes(outcome.reason);
    } catch { outcome = unknown('apply_outcome_unknown'); }
    try {
      await writePrivateJsonExclusive(join(directory, 'result.json'), { format: 1, ticket: handle, outcome, knownBeforeExecution, at: stamp(now()) });
      // Only an explicitly returned, known pre-execution result releases the
      // transition for a new check. A throw or crash never grants that right.
      if (completed && knownBeforeExecution) await removePrivateJson(claimPath, { expectedSha256: claim.sha256 });
    } catch { return reply('apply', unknown('apply_outcome_unknown'), handle); }
    return reply('apply', outcome, handle);
  }
  return async function handle(params) {
    let action;
    try {
      const args = params?.arguments;
      need(plain(args) && ['check', 'prepare', 'apply', 'status'].includes(args.action), 'invalid_arguments');
      action = args.action;
      need(exact(args, ['check', 'prepare'].includes(action) ? ['action'] : ['action', 'ticket']), 'invalid_arguments');
      const sourceSha256 = sha256(readHostSource(params));
      if (action === 'check') return await checkLoadedPackage();
      const homeSha256 = sha256(hostHome());
      if (action === 'prepare') return await prepare(sourceSha256, homeSha256);
      const prepared = await load(args.ticket, sourceSha256, homeSha256);
      return action === 'status' ? await status(prepared) : await apply(prepared, sourceSha256, homeSha256);
    } catch (error) {
      const reasons = new Set(['invalid_arguments', 'invalid_ticket', 'source_mismatch', 'ticket_expired', 'invalid_time', 'invalid_check_result']);
      const reason = error instanceof UpdateOwnerError && reasons.has(error.kind) ? error.kind
        : error?.kind === 'invalid_source' ? 'invalid_source' : 'update_state_unavailable';
      if (reason === 'update_state_unavailable' && ['apply', 'status'].includes(action)) return reply(action, unknown(reason), params?.arguments?.ticket);
      const rejected = { status: 'rejected', changed: false, reason };
      return action === 'check' ? loadedReply(rejected) : reply(action ?? 'unknown', rejected);
    }
  };
}

export const handleHostUpdate = createHostUpdateOwner();
