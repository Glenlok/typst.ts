import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/types');
const output = resolve(directory, '../deno-types');
await mkdir(output, { recursive: true });
for (const name of await readdir(directory)) {
  if (!name.endsWith('.d.ts')) continue;
  const path = resolve(directory, name);
  const source = await readFile(path, 'utf8');
  const updated = source.replace(
    /((?:from\s+|import\()(['"]))(\.[^'"]+)\2/g,
    (_, prefix, quote, specifier) => {
      if (specifier.endsWith('.d.ts')) return `${prefix}${specifier}${quote}`;
      const base = specifier.endsWith('.ts') ? specifier.slice(0, -3) : specifier;
      const declaration = `${base}.d.ts`;
      if (!existsSync(resolve(directory, declaration))) {
        throw new Error(`Missing declaration for ${specifier} in ${name}`);
      }
      return `${prefix}${declaration}${quote}`;
    },
  );
  await writeFile(resolve(output, name), updated);
}
