import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';
const npx = isWindows ? 'npx.cmd' : 'npx';

if (args.includes('visual') || args.includes('test:visual')) {
  const result = spawnSync(npm, ['run', 'test:visual'], {
    stdio: 'inherit',
    shell: true
  });
  process.exit(result.status ?? 0);
}

const result = spawnSync(npx, ['vitest', 'run', '--maxWorkers=1', ...args], {
  stdio: 'inherit',
  shell: true
});
process.exit(result.status ?? 0);
