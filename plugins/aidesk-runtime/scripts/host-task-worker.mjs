#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { runWorker } from './lib/host-task-runner.mjs';

// Launch payload is delivered once over an inherited pipe, not arguments or a
// temporary prompt file. Parent MCP exit does not cancel an accepted task.
let input = '', size = 0;
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  size += Buffer.byteLength(chunk);
  if (size > 131072) throw new Error('worker_input_too_large');
  input += chunk;
}
try { await runWorker(JSON.parse(input)); }
catch { process.exitCode = 1; }
