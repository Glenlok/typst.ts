import { expect, test, type Page } from 'playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
import type { RuntimeControl } from './runtime-control';

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
  await expect(page.getByTestId('warnings')).toHaveText('[]');
});

test('updates the SVG when the source changes', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');

  await page.getByLabel('Typst source').fill('= Updated document');
  await expect(page.locator('svg')).toContainText('Updated document');
  await expect(page.locator('svg')).not.toContainText('Hello World!');
});

test('reports compilation diagnostics and retains the last SVG until recovery', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');

  await page.getByLabel('Typst source').fill('#not_defined');
  await expect(page.getByTestId('diagnostics')).toContainText('unknown variable: not_defined');
  await expect(page.locator('svg')).toContainText('Hello World!');

  await page.getByLabel('Typst source').fill('= Recovered document');
  await expect(page.locator('svg')).toContainText('Recovered document');
  await expect(page.getByTestId('diagnostics')).toHaveText('[]');
});

test('emits an initialization error without a CDN fallback', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  let blockedAsset = false;
  await page.route('**/*typst_ts_web_compiler_bg.wasm', route => {
    blockedAsset = true;
    return route.abort();
  });
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.getByTestId('errors')).toContainText('"isError":true');
  expect(blockedAsset).toBe(true);
  expect(externalRequests).toEqual([]);
});

test('renders an artifact accompanied by diagnostics', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.warnNext = true;
  });
  await page.getByLabel('Typst source').fill('= Rendered with warning');
  await expect(page.getByTestId('diagnostics')).toContainText('Test warning');
  await expect(page.locator('svg')).toContainText('Rendered with warning');
});

test('skips superseded sources while a compilation is pending', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.holdNext = true;
  });
  await page.getByLabel('Typst source').fill('#not_defined');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.started,
      ),
    )
    .toBe(true);
  await page.getByLabel('Typst source').fill('= Superseded document');
  await page.getByLabel('Typst source').fill('= Latest document');
  expect(
    await page.evaluate(
      () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.calls,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    (window as typeof window & { typstTest: RuntimeControl }).typstTest.release(),
  );
  await expect(page.locator('svg')).toContainText('Latest document');
  await expect(page.getByTestId('diagnostic-events')).not.toContainText('not_defined');
  expect(
    await page.evaluate(() => {
      const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
      return { calls: control.calls, maxActive: control.maxActive };
    }),
  ).toEqual({ calls: 2, maxActive: 1 });
});

test('suppresses an error from a superseded request', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.holdNext = true;
    control.failHeld = true;
  });
  await page.getByLabel('Typst source').fill('= Held document');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.started,
      ),
    )
    .toBe(true);
  await page.getByLabel('Typst source').fill('= Latest document');
  await page.evaluate(() =>
    (window as typeof window & { typstTest: RuntimeControl }).typstTest.release(),
  );
  await expect(page.locator('svg')).toContainText('Latest document');
  await expect(page.getByTestId('errors')).toHaveText('[]');
});

test('normalizes a current render failure and permits a later update', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.holdNext = true;
    control.failHeld = true;
  });
  await page.getByLabel('Typst source').fill('= Failing document');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.started,
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (window as typeof window & { typstTest: RuntimeControl }).typstTest.release(),
  );
  await expect(page.getByTestId('errors')).toHaveText(
    '[{"isError":true,"message":"Test failure"}]',
  );
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.getByLabel('Typst source').fill('= Recovered document');
  await expect(page.locator('svg')).toContainText('Recovered document');
});

test('reports a compilation that returns no artifact or diagnostics', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.emptyNext = true;
  });
  await page.getByLabel('Typst source').fill('= Missing artifact');
  await expect(page.getByTestId('errors')).toContainText('Typst compilation produced no artifact');
  await expect(page.locator('svg')).toContainText('Hello World!');
});

test('reports an empty renderer result and retains the last SVG', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.locator('svg')).toContainText('Hello World!');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.emptySvgNext = true;
    control.warnNext = true;
  });
  await page.getByLabel('Typst source').fill('= Empty result');
  await expect(page.getByTestId('errors')).toContainText('Typst renderer produced no SVG');
  await expect(page.getByTestId('diagnostics')).toContainText('Test warning');
  await expect(page.locator('svg')).toContainText('Hello World!');
});

test('serializes components and discards results after unmount', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?two');
  await expect(page.getByTestId('first').locator('svg')).toContainText('Hello World!');
  await expect(page.getByTestId('second').locator('svg')).toContainText('Second document');
  await page.evaluate(async () => {
    const control = (window as typeof window & { typstTest: RuntimeControl }).typstTest;
    await control.install();
    control.holdNext = true;
    control.failHeld = true;
  });
  await page.getByLabel('Typst source', { exact: true }).fill('= Held document');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.started,
      ),
    )
    .toBe(true);
  await page.getByLabel('Second Typst source').fill('= Second updated');
  expect(
    await page.evaluate(
      () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.calls,
    ),
  ).toBe(1);
  await page.getByRole('button', { name: 'Unmount first' }).click();
  await page.evaluate(() =>
    (window as typeof window & { typstTest: RuntimeControl }).typstTest.release(),
  );
  await expect(page.getByTestId('second').locator('svg')).toContainText('Second updated');
  await expect(page.getByTestId('errors')).toHaveText('[]');
  expect(
    await page.evaluate(
      () => (window as typeof window & { typstTest: RuntimeControl }).typstTest.maxActive,
    ),
  ).toBe(1);
});

test('warns once per component when no fonts were configured', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?noFonts&two');
  const warning = 'No fonts configured through configureTypst; text may not render.';
  await expect(page.getByTestId('warnings')).toHaveText(JSON.stringify([warning, warning]));
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[]]');

  await page.getByLabel('Typst source', { exact: true }).fill('= New document');
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[],[]]');
  await expect(page.getByTestId('warnings')).toHaveText(JSON.stringify([warning, warning]));
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

  test('does not fetch a missing preview package by default', async ({ page }) => {
    const externalRequests = await blockExternalRequests(page);
    await page.goto('http://127.0.0.1:5173/tests/package.html?remotePackage');

    await expect(page.getByTestId('diagnostics')).toContainText('package not found');
    await expect(page.getByTestId('diagnostics')).toContainText('@preview/fixture:1.0.0');
    await expect(page.locator('svg')).toHaveCount(0);
    expect(externalRequests).toEqual([]);
  });

  test('fetches a missing preview package when remote imports are enabled', async ({ page }) => {
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
