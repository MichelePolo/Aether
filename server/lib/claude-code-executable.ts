import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Return the platform Claude Code binary shipped by the Agent SDK.
 *
 * Electron packages JavaScript in app.asar. The SDK can resolve the binary
 * there, but child_process cannot execute an entry inside an ASAR archive.
 * electron-builder extracts executable files into app.asar.unpacked, so use
 * that physical sibling when available.
 */
export function resolveClaudeCodeExecutable(): string | undefined {
  const binary = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const packageName = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

  try {
    const resolved = require.resolve(`${packageName}/${binary}`);
    const unpacked = resolved.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    return existsSync(unpacked) ? unpacked : resolved;
  } catch {
    // The matching optional platform package is absent only in a malformed
    // install. Let the SDK retain its normal fallback and report its own error.
    return undefined;
  }
}
