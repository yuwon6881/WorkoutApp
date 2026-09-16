import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'CLAUDE.md');
const target = resolve(root, 'AGENTS.md');
const check = process.argv.includes('--check');

if (check) {
  if (!readFileSync(source).equals(readFileSync(target))) {
    console.error('AGENTS.md is out of sync with CLAUDE.md. Run node scripts/sync-docs.mjs.');
    process.exit(1);
  }
  console.log('Documentation copies are in sync.');
} else {
  copyFileSync(source, target);
  console.log('AGENTS.md regenerated from CLAUDE.md.');
}
