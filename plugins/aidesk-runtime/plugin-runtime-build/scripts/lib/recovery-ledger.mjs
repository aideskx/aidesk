// Shared recovery ledger owner used by the actual Hook, CLI and local MCP rights.
import { readdir, lstat, realpath } from 'node:fs/promises';
import { TextDecoder } from 'node:util';
import { ensurePrivateDirectory, verifyPrivateDirectory, readPrivateBytes, readPrivateBytesLocked, writePrivateBytesExclusive, replacePrivateBytes, removePrivateBytes } from './host-data-binding.mjs';
import { dirname, join, resolve } from 'node:path';
import { sha256, operationId } from './contract.mjs';
import { withHostTaskScope } from './host-task-scope.mjs';
function isNonEmptyString(value,max=256){return typeof value==='string' && value.length>0 && value.length<=max;}
function boundedString(value,max=256){return isNonEmptyString(value,max)?value:null;}
const TARGET_IDENTIFIER_FIELDS = ['id', 'kind', 'goalId', 'publicId', 'publicVersion', 'commentId', 'notificationId', 'familyId', 'learnerId', 'sourceId'];
function associationFromArgs(args, tool = null) {
  const target = args?.target && typeof args.target === 'object' && !Array.isArray(args.target) ? args.target : {};
  // Service acceptance references a goal through the formal v1/v2 goalRef;
  // do not search arbitrary nested request content for a cleanup association.
  const goalRef = tool === 'aidesk_goal_service_cooperate'
    && ['aidesk-goal-service-v1', 'aidesk-goal-service-v2'].includes(args?.contract)
    && args.goalRef && typeof args.goalRef === 'object' && !Array.isArray(args.goalRef) ? args.goalRef : {};
  const referenceGoalId = boundedString(goalRef.goalId, 512);
  const directGoalIds = [args?.goalId, target.goalId].map(value => boundedString(value, 512)).filter(Boolean);
  if (referenceGoalId && directGoalIds.some(value => value !== referenceGoalId)) throw new Error('goal association conflict');
  const values = {};
  for (const field of TARGET_IDENTIFIER_FIELDS) {
    const value = target[field] ?? args?.[field];
    if (field === 'publicVersion' && Number.isSafeInteger(value)) values[field] = String(value);
    else if (boundedString(value, 512)) values[field] = value;
  }
  if (!values.kind && boundedString(args?.targetKind, 128)) values.kind = args.targetKind;
  if (!values.id && boundedString(args?.targetId, 512)) values.id = args.targetId;
  const targetKind = boundedString(values.kind, 128);
  const goalId = directGoalIds[0] ?? referenceGoalId;
  // Normalize the primary object identifier so a target can be addressed by
  // --target-kind/--target-id without having to reproduce unrelated public
  // version or display metadata from the original request.
  const primaryField = ['id', 'goalId', 'publicId', 'commentId', 'notificationId', 'familyId', 'learnerId', 'sourceId']
    .find(field => boundedString(values[field], 512));
  const identity = primaryField ? { kind: targetKind, id: values[primaryField] } : null;
  return {
    goalIdSha256: goalId ? sha256(goalId) : null,
    targetSha256: identity ? sha256(identity) : null,
    targetKind,
  };
}
function projectRecord(record) {
  return {
    phase: record.phase ?? null,
    tool: record.tool ?? null,
    operationId: record.operationId ?? null,
    accountSubjectSha256: record.accountSubjectSha256 ?? null,
    requestSha256: record.requestSha256 ?? null,
    goalIdSha256: record.goalIdSha256 ?? null,
    targetSha256: record.targetSha256 ?? null,
    targetKind: record.targetKind ?? null,
    observedSessionId: record.observedSessionId ?? null,
    observedCallId: record.observedCallId ?? null,
    responseSha256: record.responseSha256 ?? null,
    responseIsError: typeof record.responseIsError === 'boolean' ? record.responseIsError : null,
    at: record.at ?? null,
    ...(typeof record.contextSha256 === 'string' ? { contextSha256: record.contextSha256 } : {}),
  };
}
function operationPath(dataRoot, subject, id) {
  // Keep the user-supplied operation id out of a path unless it is a portable filename.
  // The account directory is a one-way subject hash, so records from two subjects cannot collide.
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(id)) return null;
  return join(resolve(dataRoot), 'operations', sha256(subject), `${id}.jsonl`);
}
async function assertDirectory(path, { create = true } = {}) {
  return (await (create ? ensurePrivateDirectory : verifyPrivateDirectory)(resolve(path))).path;
}
function textOf(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw Error('ledger_corrupt'); }
}
async function appendRecoveryRecord(dataRoot, args, record, { scopeHeld = false } = {}) {
  const root = resolve(dataRoot);
  await assertDirectory(root, { create: true });
  // All identified goal rows share the fence, including the first ever write.
  // Reserve's Pre callback already owns this scope and must not lock twice.
  if (!scopeHeld && record.goalIdSha256) {
    return withHostTaskScope(await realpath(root), { accountSubjectSha256: record.accountSubjectSha256, goalIdSha256: record.goalIdSha256 },
      () => appendRecoveryRecord(dataRoot, args, record, { scopeHeld: true }), { allowDeleted: record.tool === 'aidesk_goal_data_delete' });
  }
  const operations = join(root, 'operations');
  await assertDirectory(operations, { create: true });
  const subject = args.expectedAccountSubject;
  const subjectDir = join(operations, sha256(subject));
  await assertDirectory(subjectDir, { create: true });
  const path = operationPath(root, subject, record.operationId);
  if (!path) throw new Error('unsafe operation id');
  const previous = await readPrivateBytesLocked(path).catch(error => {
    if (error?.kind === 'not_found') return null;
    throw error;
  });
  const text = previous ? textOf(previous.bytes) : '';
  if (text && !text.endsWith('\n')) throw Error('ledger_corrupt');
  const rows = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  if (rows.some(row => row.operationId !== record.operationId || row.accountSubjectSha256 !== record.accountSubjectSha256)) throw new Error('ledger identity conflict');
  if (rows.some(row => row.requestSha256 !== record.requestSha256)) throw new Error('idempotency conflict');
  const existing = rows.find(row => row.requestSha256 === record.requestSha256 && row.phase === record.phase);
  if (existing) return { created: false, record: existing };
  const bytes = Buffer.concat([previous?.bytes ?? Buffer.alloc(0), Buffer.from(`${JSON.stringify(record)}\n`)]);
  // Shared owner acquires the same exact <operation>.jsonl.lock, checks old
  // bytes while locked, then publishes complete bytes without changing format.
  const committed = previous
    ? await replacePrivateBytes(path, bytes, { expectedSha256: previous.sha256 })
    : await writePrivateBytesExclusive(path, bytes);
  const matched = textOf(committed.bytes).split('\n').filter(Boolean).map(line => JSON.parse(line))
    .filter(row => row.phase === record.phase && row.operationId === record.operationId);
  if (matched.length !== 1) throw new Error('ledger identity conflict');
  return { created: true, record: matched[0] };
}
async function readLedgerFile(path) { return textOf((await readPrivateBytes(path)).bytes); }

async function readRecoveryPre(dataRoot, args) {
  const path = operationPath(dataRoot, args.expectedAccountSubject, operationId(args));
  if (!path) throw new Error('unsafe operation id');
  const rows = (await readLedgerFile(path)).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const pre = rows.filter(row => row.phase === 'PreToolUse');
  if (pre.length !== 1) throw new Error('pre binding is not unique');
  return pre[0];
}

function matchesFilter(record, filter) {
  if (filter.goalIdSha256 && record.goalIdSha256 !== filter.goalIdSha256) return false;
  if (filter.targetSha256 && record.targetSha256 !== filter.targetSha256) return false;
  if (filter.targetKind && record.targetKind !== filter.targetKind) return false;
  return true;
}
async function ledgerFiles(dataRoot, accountSubjectSha256) {
  const root = resolve(dataRoot);
  const operations = join(root, 'operations');
  const subjectDir = join(operations, accountSubjectSha256);
  for (const directory of [root, operations, subjectDir]) {
    try {
      await verifyPrivateDirectory(directory);
    } catch (error) {
      if (error?.kind === 'not_found') {
        await verifyPrivateDirectory(dirname(directory));
        return [];
      }
      throw error;
    }
  }
  const entries = await readdir(subjectDir, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.jsonl')) continue;
    const path = join(subjectDir, entry.name);
    const item = await lstat(path);
    if (item.isSymbolicLink() || !item.isFile()) throw new Error('unsafe_data_root');
    paths.push(path);
  }
  return paths.sort();
}
async function readLedgerFiles(paths) {
  const rows = [];
  for (const path of paths) {
    const text = await readLedgerFile(path);
    for (const line of text.split('\n').filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { throw new Error('ledger_corrupt'); }
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('ledger_corrupt');
      rows.push({ path, row });
    }
  }
  return rows;
}

function normalizedScope(scope){
 if(!scope || !/^[a-f0-9]{64}$/u.test(scope.accountSubjectSha256))throw Error('invalid_arguments');
 const filter={goalIdSha256:scope.goalIdSha256 ?? null,targetSha256:scope.targetSha256 ?? null,targetKind:scope.targetKind ?? null};
 for(const key of ['goalIdSha256','targetSha256'])if(filter[key]!==null && !/^[a-f0-9]{64}$/u.test(filter[key]))throw Error('invalid_arguments');
 return filter;
}
export async function exportRecoveryLedger(dataRoot,scope){
 const filter=normalizedScope(scope),rows=await readLedgerFiles(await ledgerFiles(dataRoot,scope.accountSubjectSha256));
 if(rows.some(({row})=>row.accountSubjectSha256!==scope.accountSubjectSha256))throw Error('ledger_corrupt');
 const records=rows.filter(({row})=>matchesFilter(row,filter)).map(({row})=>projectRecord(row));
 return {format:1,status:'ok',accountSubjectSha256:scope.accountSubjectSha256,filter,recordCount:records.length,records,bodyStored:false,credentialsStored:false};
}
export async function cleanRecoveryLedger(dataRoot,scope){
 const filter=normalizedScope(scope);if(!filter.goalIdSha256 && !filter.targetSha256)throw Error('filter_required');
 const paths=await ledgerFiles(dataRoot,scope.accountSubjectSha256);let removed=0,remaining=0;
 for(const path of paths){
  const original=await readLedgerFile(path),records=original.split('\n').filter(Boolean).map(line=>JSON.parse(line));
  if(records.some(row=>row.accountSubjectSha256!==scope.accountSubjectSha256))throw Error('ledger_corrupt');
  const kept=records.filter(record=>!matchesFilter(record,filter));remaining+=kept.length;
  if(kept.length===records.length)continue;
  const expectedSha256=sha256(original);
  if(kept.length===0)await removePrivateBytes(path,{expectedSha256});
  else await replacePrivateBytes(path,Buffer.from(kept.map(JSON.stringify).join('\n')+'\n'),{expectedSha256});
  removed+=records.length-kept.length;
 }
 return {format:1,status:'ok',accountSubjectSha256:scope.accountSubjectSha256,filter,removedRecords:removed,remainingRecords:remaining,bodyStored:false,credentialsStored:false};
}
export { associationFromArgs, appendRecoveryRecord, readRecoveryPre };
