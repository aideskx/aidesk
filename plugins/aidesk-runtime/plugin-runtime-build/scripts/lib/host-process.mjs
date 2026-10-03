import process from 'node:process';
import { ChildProcess } from 'node:child_process';

const interruptions = new WeakMap();
export function requestOwnedInterruption(child, { platform = process.platform } = {}) {
  if (!(child instanceof ChildProcess)) throw new Error('owned_child_required');
  const previous = interruptions.get(child);
  if (previous) return { ...previous, requested: false, alreadyRequested: true };
  if (child.exitCode !== null || child.signalCode !== null) return { requested: false, alreadyExited: true };
  // Node's SIGINT forcibly terminates the owned child on Windows. Sending it
  // proves neither graceful shutdown, child exit nor descendant termination.
  const accepted = child.kill('SIGINT');
  const receipt = { requested: accepted, signal: 'SIGINT', method: platform === 'win32' ? 'windows_force_termination' : 'posix_sigint',
    gracefulShutdownVerified: false, processExitVerified: false, descendantExitVerified: false };
  if (accepted) interruptions.set(child, receipt);
  return receipt;
}
export function classifyOwnedClose({ request, code, signal, turnCompleted = false, protocolFailure = null }) {
  // Called only from ChildProcess.close. Windows code 130 without the actual
  // matching signal is not evidence of an acknowledged interruption.
  const status = protocolFailure ? 'unknown' : code === 0 && turnCompleted ? 'completed' : request?.requested
    && (signal === request.signal || request.method === 'posix_sigint' && code === 130) ? 'interrupted' : 'failed';
  return { status, exitCode: code, exitSignal: signal, processExitVerified: true,
    interruptionMethod: request?.method ?? null, gracefulShutdownVerified: false, descendantExitVerified: false,
    durableThreadState: 'requires_host_readback', automaticRetry: false };
}
