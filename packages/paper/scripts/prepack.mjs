import { execFileSync } from 'node:child_process';

// Keep npm pack --json machine-readable while still showing build diagnostics.
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', 'build'], {
  stdio: ['inherit', process.stderr, process.stderr],
});
