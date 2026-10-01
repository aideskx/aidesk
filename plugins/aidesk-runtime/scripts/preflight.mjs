#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.CODEX_BIN || 'codex';
const result = { capabilityProfile: 'cli-native-plugin-v1', packageRoot: root, cli, checks: [], status: 'passed' };
const check = (name, ok, detail) => { result.checks.push({ name, ok, detail }); if (!ok) result.status = 'failed'; };
try { const { stdout } = await exec(cli, ['--version']); check('cli_version_observed', true, stdout.trim()); }
catch (error) { check('cli_version_observed', false, String(error.message || error)); }
try { const { stdout } = await exec(cli, ['plugin', '--help']); check('plugin_capability_observed', /plugin/u.test(stdout)); }
catch (error) { check('plugin_capability_observed', false, String(error.message || error)); }
for (const relative of ['.codex-plugin/plugin.json', '.mcp.json', 'hooks/hooks.json', 'skills/aidesk-entry/SKILL.md']) {
  try { const content = await readFile(resolve(root, relative), 'utf8'); check(`package_${relative}`, content.length > 0, `bytes=${Buffer.byteLength(content)}`); }
  catch (error) { check(`package_${relative}`, false, String(error.message || error)); }
}
try { const manifest = JSON.parse(await readFile(resolve(root, '.codex-plugin/plugin.json'), 'utf8')); check('single_cli_native_manifest', manifest.name === 'aidesk-runtime' && manifest.hooks === './hooks/hooks.json', { name: manifest.name, version: manifest.version, hooks: manifest.hooks }); }
catch (error) { check('single_cli_native_manifest', false, String(error.message || error)); }
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === 'passed' ? 0 : 1;
