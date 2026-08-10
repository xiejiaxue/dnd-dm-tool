import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Expected the generated Worker type file path.');
  process.exit(2);
}

const source = readFileSync(file, 'utf8');
const normalized = source.replace(/[\t ]+$/gmu, '');
if (normalized !== source) writeFileSync(file, normalized);
