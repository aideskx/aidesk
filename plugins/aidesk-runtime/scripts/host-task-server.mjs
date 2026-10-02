#!/usr/bin/env node
// Declared, bundled STDIO MCP owner. Model arguments never select filesystem
// paths, CLI flags, credentials, caller identity or trusted Hook observations.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { readHostSource } from './domain/host-task-contract.mjs';
import { readHostDataBinding } from './lib/host-data-binding.mjs';
import { prepareTaskContext, readPreparedContext, readOwnedTaskContext } from './lib/host-task-context.mjs';
import { prepareTaskAccess, assertTaskAccessContext, consumeTaskAccess } from './lib/host-task-access.mjs';
import { startTaskRun, readTaskRun, interruptTaskRun } from './lib/host-task-runner.mjs';
import { handleHostUpdate } from './lib/host-update-owner.mjs';
import { exportHostTaskMetadata, cleanHostTaskMetadata, readHostDeletionWitness } from './lib/host-task-data-rights.mjs';
import { prepareDataExport, consumeDataExport } from './lib/host-data-access.mjs';
import { discoverCodex, runTextCommand } from './update.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuidSchema = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const objectSchema = properties => ({ type: 'object', properties, additionalProperties: false });
const annotation = (readOnlyHint, openWorldHint = false) => ({ readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint });
export const HOST_TOOLS = [
  { name: 'aidesk_host_update_read', description: 'check仅测量当前加载包目录的字节/版本并与可信公开发行比较；scope=loaded_package，安装状态与配置来源均未核验，不启动宿主命令。status只按原ticket读取已保存回执。均不创建ticket、不安装或修改配置；unknown不等于已完成对账。',
    inputSchema: { ...objectSchema({ action: { enum: ['check', 'status'] }, ticket: hashSchema }), required: ['action'] }, annotations: annotation(true, true) },
  { name: 'aidesk_host_update', description: '有更新且获准时，prepare创建本轮更新ticket，随后apply该ticket一次。保留宿主对修改的审批；unknown只用只读工具查询原ticket，不重试。安装成功仍需新连接读回。',
    inputSchema: { ...objectSchema({ action: { enum: ['prepare', 'apply'] }, ticket: hashSchema }), required: ['action'] }, annotations: annotation(false, true) },
  { name: 'aidesk_host_task_context', description: 'source读取宿主实际调用来源；prepare_creation先建立本机上下文，再按同一reservationInput调用真实任务reserve；prepare_access为本人已有任务准备一次snapshot读取，随后才能从新对话read/resume/interrupt。不能自造来源或回执。',
    inputSchema: { ...objectSchema({ action: { enum: ['source', 'prepare_creation', 'prepare_access'] },
      reservationInput: { type: 'object' }, expectedAccountSubject: { type: 'string', maxLength: 512 },
      goalId: { type: 'string', maxLength: 128 }, contextId: hashSchema, accessAction: { enum: ['read', 'resume', 'interrupt'] } }), required: ['action'] }, annotations: annotation(false) },
  { name: 'aidesk_host_task_dispatch', description: '用户明确要求独立开展后，只凭同次真实fresh reserve Hook见证create一次。resume/interrupt要求prepare_access后的真实snapshot见证；可省略contextId，提供时必须与accessId绑定的原上下文一致。恢复保持原threadId。返回starting/unknown不等于已创建或已完成，不重号重建。',
    inputSchema: { ...objectSchema({ action: { enum: ['create', 'resume', 'interrupt'] }, contextId: hashSchema,
      accessId: uuidSchema, prompt: { type: 'string', minLength: 1, maxLength: 65536 } }), required: ['action'] }, annotations: annotation(false, true) },
  { name: 'aidesk_host_task_read', description: '读取本机owner观察的准确任务ID和进程状态。原发起对话可按contextId读取；新对话先prepare_access+真实snapshot，再用accessId。同时提供contextId时须与该access绑定一致，仍消费一次access。CLI回合完成不等于目标已完成或成果已验证。',
    inputSchema: objectSchema({ contextId: hashSchema, accessId: uuidSchema }), annotations: { ...annotation(true), idempotentHint: false } },
  { name: 'aidesk_host_task_data', description: 'prepare_export准备本人准确目标的只读服务核验；调用返回的真实preview后，export用scopeId/accessId导出本机摘要，无需已有宿主任务。clean只凭真实云端删除或原号对账Hook给出的scopeId/witnessId清理准确元数据。活跃或未知任务不清理；工作文件、宿主聊天和独立导出保留。',
    inputSchema: { ...objectSchema({ action: { enum: ['prepare_export', 'export', 'clean'] }, expectedAccountSubject: { type: 'string', maxLength: 512 }, goalId: uuidSchema,
      accessId: uuidSchema, scopeId: hashSchema, witnessId: hashSchema }), required: ['action'] },
    annotations: { ...annotation(false), destructiveHint: true } },
];
function exact(value, keys) {
  if (!object(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) throw new Error('invalid_arguments');
}
function accessArguments(args, keys) {
  exact(args, Object.hasOwn(args, 'contextId') ? [...keys, 'contextId'] : keys);
  if (Object.hasOwn(args, 'contextId') && (typeof args.contextId !== 'string' || !/^[a-f0-9]{64}$/u.test(args.contextId))) throw new Error('invalid_context_id');
}
function prompt(value) {
  if (typeof value !== 'string' || !value.trim() || !value.isWellFormed() || Buffer.byteLength(value) > 65536) throw new Error('invalid_prompt');
  return value;
}
async function executionCli() {
  const cli = await discoverCodex(); if (!cli) throw new Error('host_unavailable');
  // Check capabilities, not a hard-coded CLI version. No sandbox/model/auth flags.
  const exec = await runTextCommand(cli, ['exec', '--help']);
  const resume = await runTextCommand(cli, ['exec', 'resume', '--help']);
  if (!exec.includes('--json') || !exec.includes('--skip-git-repo-check') || !resume.includes('SESSION_ID') || !resume.includes('--json')) throw new Error('host_unavailable');
  return cli;
}
export async function handleHostTool(params) {
  if (!object(params) || typeof params.name !== 'string' || !object(params.arguments)) throw new Error('invalid_arguments');
  const args = params.arguments;
  if (params.name === 'aidesk_host_update_read' || params.name === 'aidesk_host_update') {
    const actions = params.name === 'aidesk_host_update_read' ? ['check', 'status'] : ['prepare', 'apply'];
    if (!actions.includes(args.action)) throw new Error('invalid_arguments');
    return handleHostUpdate(params);
  }
  const source = readHostSource(params);
  if (params.name === 'aidesk_host_task_context' && args.action === 'source') {
    exact(args, ['action']);
    let dataAvailable = false;
    try { await readHostDataBinding(); dataAvailable = true; } catch { /* History binding is not current trust. */ }
    return { status: 'source_observed', sourceThreadId: source.threadId, hostId: 'local', dataAvailable,
      scope: 'calling local Codex host; not physical-device attestation', creationAuthorized: false };
  }
  const { dataRoot } = await readHostDataBinding();
  if (params.name === 'aidesk_host_task_data') {
    if (args.action === 'prepare_export') {
      exact(args, ['action', 'expectedAccountSubject', 'goalId']);
      return prepareDataExport(dataRoot, { params, expectedAccountSubject: args.expectedAccountSubject, goalId: args.goalId });
    }
    if (args.action === 'export') {
      exact(args, ['action', 'scopeId', 'accessId']);
      const scope = await consumeDataExport(dataRoot, { params, scopeId: args.scopeId, accessId: args.accessId });
      return exportHostTaskMetadata(dataRoot, scope);
    }
    if (args.action === 'clean') {
      exact(args, ['action', 'scopeId', 'witnessId']);
      const proof = await readHostDeletionWitness(dataRoot, { scopeId: args.scopeId, witnessId: args.witnessId, params });
      try {
        return { ...await cleanHostTaskMetadata(dataRoot, proof.scope, { confirm: true }), cloudDeletionVerified: true };
      } catch (error) {
        return { status: 'cleanup_pending', cloudDeletionVerified: true, scopeId: proof.scopeId,
          cleanupId: proof.cleanupId, reason: safeError(error), automaticRetry: false };
      }
    }
    throw new Error('invalid_arguments');
  }
  if (params.name === 'aidesk_host_task_context') {
    if (args.action === 'prepare_creation') {
      exact(args, ['action', 'reservationInput']);
      if (args.reservationInput?.hostId !== 'local') throw new Error('host_mismatch');
      return { status: 'prepared', ...await prepareTaskContext(dataRoot, { params, reservationInput: args.reservationInput }), creationAuthorized: false };
    }
    if (args.action === 'prepare_access') {
      exact(args, ['action', 'expectedAccountSubject', 'goalId', 'contextId', 'accessAction']);
      return prepareTaskAccess(dataRoot, { params, expectedAccountSubject: args.expectedAccountSubject,
        goalId: args.goalId, contextId: args.contextId, action: args.accessAction });
    }
  } else if (params.name === 'aidesk_host_task_dispatch') {
    if (args.action === 'create') {
      exact(args, ['action', 'contextId', 'prompt']); prompt(args.prompt);
      const executable = await executionCli();
      const prepared = await readPreparedContext(dataRoot, args.contextId, params);
      return startTaskRun({ dataRoot, scope: prepared.context, directory: prepared.directory, contextId: prepared.contextId,
        contextSha256: prepared.context.contextSha256, sourceThreadId: source.threadId,
        prompt: args.prompt, executable });
    }
    if (args.action === 'resume') {
      accessArguments(args, ['action', 'accessId', 'prompt']); prompt(args.prompt);
      if (Object.hasOwn(args, 'contextId')) await assertTaskAccessContext(dataRoot, { accessId: args.accessId, contextId: args.contextId });
      const executable = await executionCli();
      const access = await consumeTaskAccess(dataRoot, { params, accessId: args.accessId, action: 'resume', contextId: args.contextId });
      return startTaskRun({ dataRoot, scope: access.witness, directory: access.directory, contextId: access.contextId,
        contextSha256: access.contextSha256, sourceThreadId: source.threadId,
        prompt: args.prompt, executable, action: 'resume', threadId: access.taskThreadId,
        expectedOwnerRunId: access.ownerState.runId });
    }
    if (args.action === 'interrupt') {
      accessArguments(args, ['action', 'accessId']);
      const access = await consumeTaskAccess(dataRoot, { params, accessId: args.accessId, action: 'interrupt', contextId: args.contextId });
      return interruptTaskRun({ dataRoot, scope: access.witness, directory: access.directory,
        expectedOwnerRunId: access.ownerState.runId, threadId: access.taskThreadId });
    }
  } else if (params.name === 'aidesk_host_task_read') {
    if (!Object.hasOwn(args, 'accessId')) {
      exact(args, ['contextId']);
      const owned = await readOwnedTaskContext(dataRoot, args.contextId, params);
      return readTaskRun(owned.directory);
    }
    accessArguments(args, ['accessId']);
    const access = await consumeTaskAccess(dataRoot, { params, accessId: args.accessId, action: 'read', contextId: args.contextId });
    return readTaskRun(access.directory);
  }
  throw new Error('invalid_arguments');
}

function safeError(error) {
  // Explicit contract error kinds contain no raw paths, stack traces or output.
  const candidates = [error?.kind, error?.message];
  return candidates.find(value => typeof value === 'string' && /^[a-z_]{1,80}$/u.test(value)) ?? 'host_owner_unavailable';
}
export async function serveHostMcp({ input = process.stdin, output = process.stdout, dispatch = handleHostTool } = {}) {
  const manifest = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'));
  const send = value => output.write(JSON.stringify(value) + '\n');
  let initialized = false;
  const receive = async message => {
    if (!object(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return;
    if (!Object.hasOwn(message, 'id')) return;
    const id = message.id;
    if (!(typeof id === 'string' && id.length <= 256 || Number.isSafeInteger(id))) return;
    if (message.method === 'initialize') {
      initialized = true;
      const requested = message.params?.protocolVersion;
      return send({ jsonrpc: '2.0', id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18'].includes(requested) ? requested : '2025-03-26',
        capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aidesk-host', version: manifest.version } } });
    }
    if (!initialized) return send({ jsonrpc: '2.0', id, error: { code: -32002, message: 'Initialize required' } });
    if (message.method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: HOST_TOOLS } });
    if (message.method !== 'tools/call') return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    try {
      if (!HOST_TOOLS.some(tool => tool.name === message.params?.name)) throw new Error('unknown_tool');
      const result = await dispatch(message.params);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } });
    } catch (error) {
      const reason = safeError(error);
      const result = { status: ['dispatch_not_confirmed', 'worker_unreachable', 'invalid_control_response'].includes(reason) ? 'unknown' : 'unavailable', reason, automaticRetry: false };
      send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } });
    }
  };
  input.setEncoding('utf8'); let buffer = '';
  for await (const chunk of input) {
    buffer += chunk;
    if (Buffer.byteLength(buffer) > 1024 * 1024) throw new Error('mcp_input_too_large');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
      await receive(message);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await serveHostMcp(); } catch { process.exitCode = 1; }
}
