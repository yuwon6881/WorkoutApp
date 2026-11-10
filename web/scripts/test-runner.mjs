import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

if (args.includes('visual') || args.includes('test:visual')) {
  const result = spawnSync(npm, ['run', 'test:visual'], {
    stdio: 'inherit',
    shell: isWindows
  });
  process.exit(result.status ?? 0);
}

const vitestEntry = resolve(import.meta.dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitestEntry, 'run', '--maxWorkers=1', ...args], {
  stdio: 'inherit'
});
process.exit(result.status ?? 0);
