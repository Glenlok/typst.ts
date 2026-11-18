import { expect, test, type Page } from 'playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';

test('consumer build excludes optional fonts by default', async ({}, testInfo) => {
  const outDir = testInfo.outputPath('consumer');
  await build({
    configFile: false,
    build: {
      outDir,
      rollupOptions: { input: resolve('tests/no-fonts.ts') },
    },
  });
  const assets = await readdir(resolve(outDir, 'assets'));
  expect(assets.filter(name => /LibertinusSerif/.test(name))).toEqual([]);
});

async function blockExternalRequests(page: Page) {
  const externalRequests: string[] = [];

  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.port === '5173' && ['127.0.0.1', 'localhost'].includes(url.hostname)) {
      await route.continue();
      return;
    }

    externalRequests.push(url.href);
    await route.abort();
  });

  return externalRequests;
}

test('renders Typst SVG without external network access', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);

  await page.goto('http://127.0.0.1:5173/tests/');

  const svg = page.locator('svg');
  await expect.poll(async () => externalRequests.length > 0 || (await svg.isVisible())).toBe(true);
  expect(externalRequests).toEqual([]);

  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Hello World!');
});

test('allows remote package imports to be enabled before mounting', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);

  await page.goto('http://127.0.0.1:5173/tests/?allowRemotePackageImports=true');

  const svg = page.locator('svg');
  await expect(svg).toBeVisible();
  await expect(svg).toContainText('Hello World!');
  expect(externalRequests).toEqual([]);
});

test.describe('package archives', { tag: '@tar' }, () => {
  test('consumer build includes the bundled archive', async ({}, testInfo) => {
    const outDir = testInfo.outputPath('consumer');
    await build({
      configFile: false,
      build: {
        outDir,
        rollupOptions: { input: resolve('tests/with-package.ts') },
      },
    });
    const assets = await readdir(resolve(outDir, 'assets'));
    expect(assets.some(name => name.startsWith('fixture-') && name.endsWith('.tgz'))).toBe(true);
  });

  for (const remote of [false, true]) {
    test(`renders a bundled package offline with remote imports ${remote ? 'enabled' : 'disabled'}`, async ({
      page,
    }) => {
      const externalRequests = await blockExternalRequests(page);
      await page.goto(
        `http://127.0.0.1:5173/tests/package.html?package${remote ? '&allowRemotePackageImports' : ''}`,
      );

      await expect(page.locator('svg')).toContainText('Bundled package works');
      expect(externalRequests).toEqual([]);
    });
  }

  test('fetches a missing preview package only when remote imports are enabled', async ({
    page,
  }) => {
    const requests: string[] = [];
    const packageArchive = await readFile(resolve('tests/.generated/fixture.tgz'));
    await page.route('https://packages.typst.org/preview/fixture-1.0.0.tar.gz', route => {
      requests.push(route.request().url());
      return route.fulfill({
        body: packageArchive,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    });
    await page.goto(
      'http://127.0.0.1:5173/tests/package.html?remotePackage&allowRemotePackageImports',
    );
    await expect(page.locator('svg')).toContainText('Bundled package works');
    expect(requests).toHaveLength(1);
  });
});

test('renders with font bytes supplied before mounting', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await page.goto('http://127.0.0.1:5173/tests/?fontBytes');
  await expect(page.locator('svg')).toContainText('Hello World!');
  expect(externalRequests).toEqual([]);
});

test('rejects configuration after initialization', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toBeVisible();
  const error = await page.evaluate(async moduleUrl => {
    const { configureTypst } = await import(moduleUrl);
    try {
      configureTypst({});
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return null;
  }, '/dist/index.es.js');
  expect(error).toBe('Typst has already been initialized');
});
