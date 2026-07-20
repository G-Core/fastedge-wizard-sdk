import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(resolve(root, '../package.json'), 'utf8'));
writeFileSync(
    resolve(root, '../src/version.ts'),
    `export const SDK_VERSION = '${version}';\n`,
);
