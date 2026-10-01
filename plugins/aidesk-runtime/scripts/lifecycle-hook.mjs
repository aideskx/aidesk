#!/usr/bin/env node
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isWriteTool, operationId, sha256, toolFromEvent } from './lib/contract.mjs';

const phase = process.argv[process.argv.indexOf('--hook') + 1] || null;
const input = await new Promise(resolve => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { text += chunk; });
  process.stdin.on('end', () => resolve(text));
});

function output(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function context(message) { return { hookSpecificOutput: { hookEventName: phase, additionalContext: message } }; }
function deny(code, message) {
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
    permissionDecisionReason: `AI书桌新版 Hook 已停止本次调用：${code}。${message}` } };
}

let event;
try { event = JSON.parse(input || '{}'); } catch { output(deny('invalid_event', 'Hook 输入不是有效 JSON。')); process.exit(0); }
const tool = toolFromEvent(event);
if (!tool || !['PreToolUse', 'PostToolUse'].includes(phase) || event.hook_event_name !== phase) { output({}); process.exit(0); }
const args = event.tool_input;
if (!args || typeof args !== 'object' || Array.isArray(args)) { output(deny('invalid_input', '工具输入必须是对象。')); process.exit(0); }
const write = isWriteTool(tool);
if (phase === 'PreToolUse') {
  if (write && !operationId(args)) { output(deny('operation_id_required', '写入必须携带一次性的 operationId；请沿原请求恢复，不要换号重试。')); process.exit(0); }
  if (write && typeof args.contract !== 'string') { output(deny('contract_required', '写入必须携带领域 contract。')); process.exit(0); }
  if (write && typeof args.expectedAccountSubject !== 'string') { output(deny('account_subject_required', '写入必须携带已核实的 expectedAccountSubject。')); process.exit(0); }
  const dataRoot = process.env.PLUGIN_DATA;
  if (write && !dataRoot) { output(deny('plugin_data_unavailable', '宿主没有提供 PLUGIN_DATA，无法建立本机恢复记录。')); process.exit(0); }
  if (write) {
    try {
      const record = { phase, tool, operationId: operationId(args), requestSha256: sha256(args), observedSessionId: typeof event.session_id === 'string' ? sha256(event.session_id) : null, observedCallId: typeof event.tool_use_id === 'string' ? sha256(event.tool_use_id) : null, at: new Date().toISOString() };
      const path = join(dataRoot, 'operations', `${record.operationId}.jsonl`);
      await mkdir(dirname(path), { recursive: true });
      const previous = await readFile(path, 'utf8').catch(() => '');
      const rows = previous.split('\n').filter(Boolean).map(line => JSON.parse(line));
      if (rows.some(row => row.requestSha256 !== record.requestSha256)) { output(deny('idempotency_conflict', '同一 operationId 已对应另一份请求摘要；保留两边事实并重新确认用户意图。')); process.exit(0); }
      if (rows.some(row => row.requestSha256 === record.requestSha256 && row.phase === phase)) { output({}); process.exit(0); }
      await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
    } catch { output(deny('recovery_record_failed', '本机恢复原件没有成功落盘，本次写入停止。')); process.exit(0); }
  }
  output({}); process.exit(0);
}

if (event.tool_response?.isError === true) { output(context(`AI书桌新版结果未知：${tool} 未获得成功回执；保留 operationId，先做原号对账，不换号重试。`)); process.exit(0); }
const digest = event.tool_response ? sha256(event.tool_response) : null;
output(context(`AI书桌新版已观察 ${tool} 的 PostToolUse 回执${digest ? `（回执摘要 ${digest}）` : ''}；这是宿主观察记录，不替代服务终态、宿主任务创建或成果验证。`));
