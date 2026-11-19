import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function checkExports(t, exports, files) {
  const root = mkdtempSync(join(tmpdir(), 'typst-imports-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = join(root, 'packages');
  const scripts = join(packages, 'typst.ts', 'scripts');
  mkdirSync(scripts, { recursive: true });
  copyFileSync(join(import.meta.dirname, 'test-imports.mjs'), join(scripts, 'test-imports.mjs'));
  symlinkSync(
    join(import.meta.dirname, '../../../node_modules'),
    join(root, 'node_modules'),
    'dir',
  );

  for (const name of [
    'typst-all-in-one.ts',
    'typst.ts',
    'renderer',
    'compiler',
    'parser',
    'typst.react',
    'typst.vue3',
  ]) {
    const dir = join(packages, name);
    mkdirSync(dir, { recursive: true });
    const pkg = name === 'typst.vue3' ? { name, exports: { './fonts': exports } } : { name };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  }
  for (const file of files) writeFileSync(join(packages, 'typst.vue3', file), '');

  return spawnSync(process.execPath, [join(scripts, 'test-imports.mjs')], { encoding: 'utf8' });
}

test('accepts an import-only export with existing files', t => {
  const result = checkExports(t, { types: './fonts.d.ts', import: './fonts.js' }, [
    'fonts.js',
    'fonts.d.ts',
  ]);
  assert.equal(result.status, 0, result.stderr);
});

test('rejects missing supported exports', async t => {
  for (const missing of ['fonts.js', 'fonts.d.ts', 'fonts.cjs']) {
    await t.test(missing, t => {
      const result = checkExports(
        t,
        {
          types: './fonts.d.ts',
          import: './fonts.js',
          ...(missing === 'fonts.cjs' && { require: './fonts.cjs' }),
        },
        ['fonts.js', 'fonts.d.ts'].filter(file => file !== missing),
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /This export does not exist in filesystem/);
      assert.ok(result.stderr.includes(missing), result.stderr);
    });
  }
});
