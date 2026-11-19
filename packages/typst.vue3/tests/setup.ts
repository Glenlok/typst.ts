import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const generatedDir = resolve('tests/.generated');

export default async function setup() {
  await mkdir(generatedDir);
  try {
    await promisify(execFile)('tar', [
      '-czf',
      resolve(generatedDir, 'fixture.tgz'),
      '-C',
      resolve('tests/fixtures/package'),
      'typst.toml',
      'lib.typ',
    ]);
  } catch (error) {
    await rm(generatedDir, { recursive: true });
    throw error;
  }

  return async () => {
    await rm(generatedDir, { recursive: true });
  };
}
