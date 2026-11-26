import { expect, test, type Page } from 'playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import type { RuntimeControl } from './runtime-control';

test('renders with Wasm compilation but without JavaScript eval', async ({ page }) => {
  await page.route('http://127.0.0.1:5173/tests/', async route => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy':
          "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'",
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/tests/');
  await expect(page.getByTestId('first').locator('svg')).toBeVisible();
});

test('default compiler access reports missing files and packages', async () => {
  const modulePath = pathToFileURL(resolve('../compiler/pkg/typst_ts_web_compiler.mjs')).href;
  const { default: init, TypstCompilerBuilder } = await import(modulePath);
  const wasm = await readFile(resolve('../compiler/pkg/typst_ts_web_compiler_bg.wasm'));
  await init({ module_or_path: wasm });
  const builder = new TypstCompilerBuilder();
  builder.set_dummy_access_model();
  const compiler = await builder.build();
  try {
    compiler.add_source('/main.typ', '#read("missing.txt")');
    const file = compiler.compile('/main.typ', null, '_dummy', 3);
    expect(file.hasError).toBe(true);
    expect(file.diagnostics[0].message).toContain('access denied');

    compiler.add_source('/package.typ', '#import "@preview/fixture:1.0.0": x');
    const registry = compiler.compile('/package.typ', null, '_dummy', 3);
    expect(registry.hasError).toBe(true);
    expect(registry.diagnostics[0].message).toContain(
      'Dummy Registry, please initialize compiler with withPackageRegistry()',
    );
  } finally {
    compiler.free();
  }
});

test('finds actual Typst function calls without matching literal lookalikes', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const result = await page.evaluate(async () => {
    const path = '/dist/index.es.js';
    const { findTypstFunctionCalls } = await import(path);
    const source = '🧮 #lumina-note("41")[\\[^a\\]]\n' +
      '#raw("#lumina-note(\\"41\\")[fake]")\n' +
      '\\#lumina-note("41")[literal]';
    const calls: { start: number; end: number }[] =
      await findTypstFunctionCalls(source, 'lumina-note');
    return calls.map(call => ({
      ...call,
      source: source.slice(call.start, call.end),
    }));
  });
  expect(result).toEqual([{
    start: 3,
    end: 29,
    source: '#lumina-note("41")[\\[^a\\]]',
  }]);
});

test('finds nested calls and rejects malformed Typst source', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const result = await page.evaluate(async () => {
    const path = '/dist/index.es.js';
    const { findTypstFunctionCalls } = await import(path);
    const source = '#quote[#lumina-note("41")[#lumina-note("42")[x]]] ' +
      '`#lumina-note("43")[raw]`';
    const calls: { start: number; end: number }[] =
      await findTypstFunctionCalls(source, 'lumina-note');
    let malformed: string | undefined;
    try {
      await findTypstFunctionCalls('#lumina-note("41")[', 'lumina-note');
    } catch (error) {
      malformed = String(error);
    }
    return { calls: calls.map(call => source.slice(call.start, call.end)), malformed };
  });
  expect(result.calls).toEqual([
    '#lumina-note("41")[#lumina-note("42")[x]]',
    '#lumina-note("42")[x]',
  ]);
  expect(result.malformed).toContain('Invalid Typst syntax');
});

test('validates math without executing scripting or non-math calls', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const result = await page.evaluate(async () => {
    const path = '/dist/index.es.js';
    const { validateTypstMath } = await import(path);
    const inputs = [
      '$x^2$',
      '$ x / 2 $',
      '$mat(a, b; c, d)$',
      '$text("$")$',
      '$x /* $ /* $ */ $ */ + y$',
      '$x^$',
      '$notarealmathfunction(x)$',
      '$#read("secret")$',
      '$std.read("secret")$',
      '$x$ #read("secret")',
    ];
    const results = await Promise.all(inputs.map(source => validateTypstMath(source)));
    return [...results, await validateTypstMath('$ x^2 $', true)];
  });
  expect(result).toEqual([true, true, true, true, true, false, false, false, false, false, false]);
});

test('standalone encoded display math renders between surrounding paragraphs', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#let lumina-math(source) = eval(str(bytes(source)), mode: "markup")\n' +
      'Before #lumina-math((36,32,120,94,50,32,36)) after',
  );
  const before = first.locator('.tsel').filter({ hasText: 'Before' });
  const after = first.locator('.tsel').filter({ hasText: 'after' });
  await expect(before).toBeVisible();
  await expect(after).toBeVisible();
  const beforeBox = await before.boundingBox();
  const afterBox = await after.boundingBox();
  expect(beforeBox).not.toBeNull();
  expect(afterBox).not.toBeNull();
  expect(afterBox!.y).toBeGreaterThan(beforeBox!.y + beforeBox!.height);
  const text = (await first.locator('.tsel').allTextContents()).join('');
  expect(text).toMatch(/[x𝑥]\s*2/);
  expect(text).not.toContain('$');
});

test('navigates footnote locations by keyboard without inline handlers', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    'Reference#footnote[Footnote content.]',
  );
  await expect(first.locator('svg')).toContainText('Footnote content.');
  const reference = first.getByRole('link', { name: '1' }).first();
  await expect(reference).toBeVisible();
  expect(await first.locator('svg [onclick]').count()).toBe(0);
  await reference.focus();
  await page.keyboard.press('Enter');
  const target = first.locator('[data-typst-location-target]');
  await expect(target).toBeFocused();
  const targetBox = await target.boundingBox();
  const footnoteBox = await first.getByText('Footnote content.', { exact: true }).boundingBox();
  expect(targetBox).not.toBeNull();
  expect(footnoteBox).not.toBeNull();
  expect(Math.abs(targetBox!.y - footnoteBox!.y)).toBeLessThan(30);
});

test('delegates only the configured fragment prefix to the host', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly&delegateFragments');
  const first = page.getByTestId('first');
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#link("#preview-reference-1")[Open note] #link("https://example.test")[External]',
  );
  const link = first.getByRole('link', { name: 'Open note' });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('fragments')).toHaveText('["preview-reference-1"]');
  await expect(page.getByTestId('errors')).toHaveText('[]');
  await expect(first.getByRole('link', { name: 'External' })).toHaveCount(0);
});

test('navigates each repeated-footnote backlink to its own reference', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    'References#box[#footnote[Note #link(<ref-one>)[Back one] ' +
      '#link(<ref-two>)[Back two]] <note>] <ref-one>' +
      '#box[#footnote(<note>)] <ref-two>',
  );
  await expect(first.getByRole('link', { name: 'Back two' })).toBeVisible();
  const referenceLinks = first.getByRole('link', { name: '1', exact: true });
  const boxes = await referenceLinks.all();
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  for (const [index, name] of ['Back one', 'Back two'].entries()) {
    const referenceBox = await boxes[index].boundingBox();
    await first.getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    const target = boxes[index];
    await expect(target).toBeFocused();
    const targetBox = await target.boundingBox();
    expect(referenceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(Math.abs(targetBox!.y - referenceBox!.y)).toBeLessThan(20);
  }

  await first.evaluate(element => {
    element.style.transform = 'scale(0.1)';
    element.style.transformOrigin = 'top left';
  });
  for (const [index, name] of ['Back one', 'Back two'].entries()) {
    await first.getByRole('link', { name }).focus();
    await page.keyboard.press('Enter');
    await expect(boxes[index]).toBeFocused();
  }
});

test('navigates to a labelled target on another page and reports missing targets', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#link(<later>)[Go later]\n#pagebreak()\n= Second page <later>',
  );
  const link = first.getByRole('link', { name: 'Go later' });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press('Enter');
  const target = first.locator('[data-typst-location-target]');
  await expect(target).toBeFocused();
  await expect(target).toContainText('Second page');

  await first.locator('[data-typst-label^="typst.ts:target:"]').evaluateAll(groups => {
    for (const group of groups) group.removeAttribute('data-typst-label');
  });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('errors')).toContainText('Typst location target has no readable content.');
});

test('navigates to a coordinate-based position in fragment-only mode', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#link((page: 2, x: 10pt, y: 20pt))[Go to position]\n#pagebreak()\n= Target page',
  );
  const link = first.getByRole('link', { name: 'Go to position' });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('errors')).toHaveText('[]');
  await expect(first.getByRole('heading', { name: 'Target page' })).toBeInViewport();
});

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

test('exposes a styled heading once before the following paragraph', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill('= Test *bold* heading\n\nReadable paragraph.');
  await expect(first.locator('svg')).toContainText('Readable paragraph.');

  await expect(first.getByRole('heading', { name: 'Test bold heading', level: 1 })).toHaveCount(1);
  const snapshot = await first.ariaSnapshot();
  expect(snapshot).toContain('Readable paragraph.');
  expect(snapshot.indexOf('heading "Test bold heading"')).toBeLessThan(
    snapshot.indexOf('Readable paragraph.'),
  );
});

test('exposes nested list structure in reading order', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill('- First\n  - Nested\n- Second');
  await expect(first.locator('svg')).toContainText('Second');

  await expect(first.getByRole('list')).toHaveCount(2);
  await expect(first.getByRole('listitem')).toHaveCount(3);
  await expect(first).toMatchAriaSnapshot(`
    - img:
      - list:
        - listitem:
          - text: First
          - list:
            - listitem: Nested
        - listitem: Second
  `);
});

test('exposes table headers and cells in row order', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 2, table.header([Parameter], [Value]), [Length], [5 m])',
  );
  await expect(first.locator('svg')).toContainText('5 m');

  await expect(first.getByRole('table')).toHaveCount(1);
  await expect(first.getByRole('row')).toHaveCount(2);
  await expect(first.getByRole('columnheader', { name: 'Parameter' })).toHaveCount(1);
  await expect(first.getByRole('columnheader', { name: 'Value' })).toHaveCount(1);
  await expect(first.getByRole('cell', { name: 'Length' })).toHaveCount(1);
  await expect(first.getByRole('cell', { name: '5 m' })).toHaveCount(1);
});

test('preserves outer table header roles around a nested table', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 1, table.header(table.cell([Before #table(columns: 1, [Nested]) After])))',
  );
  await expect(first.locator('svg')).toContainText('Nested');

  await expect(first.getByRole('table')).toHaveCount(2);
  await expect(first.getByRole('columnheader', { name: /Before.*After/ })).toHaveCount(1);
  await expect(first.getByRole('cell')).toHaveCount(1);
});

test('preserves auto-kind outer table headers around nested tables', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 1, table.header([Before #table(columns: 1, [Nested]) After]))',
  );
  await expect(first.locator('svg')).toContainText('Nested');

  await expect(first.getByRole('table')).toHaveCount(2);
  await expect(first.getByRole('columnheader', { name: /Before.*After/ })).toHaveCount(1);
  await expect(first.getByRole('cell')).toHaveCount(1);
});

test('nests tables inside their parent table cell', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 1, [Outer #table(columns: 1, [Nested])])',
  );
  await expect(first.locator('svg')).toContainText('Nested');

  const tables = first.getByRole('table');
  await expect(tables).toHaveCount(2);
  const parentCell = tables.nth(0).getByRole('cell').first();
  await expect(parentCell.getByRole('table')).toHaveCount(1);
  await expect(parentCell.getByRole('table').getByRole('cell', { name: 'Nested' }))
    .toHaveCount(1);
});

test('keeps a table cell together semantically when it spans pages', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#set page(height: 110pt, width: 180pt, margin: 10pt)\n' +
      '#table(columns: 1, table.header([Header]), [First #lorem(80) Last])',
  );
  await expect(first.locator('svg')).toContainText('Last');
  expect(await first.locator('svg .typst-page').count()).toBeGreaterThan(1);
  await expect(first.getByRole('columnheader', { name: 'Header' })).toHaveCount(1);
  await expect(first.getByRole('cell', { name: /First.*Last/ })).toHaveCount(1);
});

test('preserves row order and spanning cells in accessible tables', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 2, table.header([Parameter], [Value]), ' +
      'table.cell(rowspan: 2)[Beam], [First], [Second])',
  );
  await expect(first.locator('svg')).toContainText('Second');
  await expect(first.getByRole('cell', { name: 'Beam' })).toHaveAttribute('aria-rowspan', '2');
  await expect(first).toMatchAriaSnapshot(`
    - img:
      - table:
        - row "Parameter Value":
          - columnheader "Parameter"
          - columnheader "Value"
        - row "Beam First":
          - cell "Beam"
          - cell "First"
        - row "Second":
          - cell "Second"
  `);
});

test('includes empty rows and cells in accessible tables', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source').fill(
    '#table(columns: 2, table.header([Parameter], []), [Length], [], [], [], [Material], [Steel])',
  );
  await expect(first.locator('svg')).toContainText('Steel');

  await expect(first.getByRole('table')).toHaveCount(1);
  await expect(first.getByRole('row')).toHaveCount(4);
  await expect(first.getByRole('columnheader')).toHaveCount(2);
  await expect(first.getByRole('cell')).toHaveCount(6);
  await expect(first.getByRole('row').nth(2).getByRole('cell')).toHaveCount(2);
});

test('documents empty-table structure lost by Typst layout', async ({ page }) => {
  test.fail(true, 'Typst drops cell tags when empty cells produce no frames');
  await page.goto('http://127.0.0.1:5173/tests/?assets');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  const source = page.getByLabel('Typst source', { exact: true });

  await source.fill(
    '#table(columns: 2, stroke: 1pt + black, inset: 5pt, [], [], [], [])',
  );
  await expect(first.getByRole('table')).toHaveCount(1);
});

test('preserves image-only table cells without alt text', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?assets');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  const source = page.getByLabel('Typst source', { exact: true });
  await source.fill('#table(columns: 1, image("assets/demo.svg"))');
  await expect(first.getByRole('table')).toHaveCount(1);
  await expect(first.getByRole('row')).toHaveCount(1);
  await expect(first.getByRole('cell')).toHaveCount(1);
});

test('exposes an image alternative description', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?assets');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#image("assets/demo.svg", alt: "Beam loading schematic")',
  );
  await expect(first.getByRole('img', { name: 'Beam loading schematic' })).toHaveCount(1);
});

test('exposes one named link for styled link text', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#link("#details")[See *details*]',
  );
  await expect(first.locator('svg')).toContainText('details');
  const link = first.getByRole('link', { name: 'See details' });
  await expect(link).toHaveCount(1);
  await link.focus();
  await expect(link).toBeFocused();
});

test('preserves links inside a list and surrounding reading order', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    'Before.\n\n- Read #link("#first")[the *first* item] now.\n' +
      '- Read #link("#second")[the second item].\n\nAfter.',
  );
  await expect(first.locator('svg')).toContainText('After.');
  await expect(first).toMatchAriaSnapshot(`
    - img:
      - text: Before.
      - list:
        - listitem:
          - text: Read
          - link "the first item"
          - text: now.
        - listitem:
          - text: Read
          - link "the second item"
          - text: .
      - text: After.
  `);
});

test('makes external links inert when only fragment links are allowed', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?fragmentLinksOnly');
  const first = page.getByTestId('first');
  await expect(first.locator('svg')).toBeVisible();
  await page.getByLabel('Typst source', { exact: true }).fill(
    '#link("https://example.test")[External] and #link("#details")[Details]',
  );
  await expect(first.locator('svg')).toContainText('Details');
  await expect(first.getByRole('link', { name: 'External' })).toHaveCount(0);
  await expect(first.getByRole('link', { name: 'Details' })).toHaveCount(1);
  expect(await first.locator('svg a').evaluateAll(anchors =>
    anchors.map(anchor => anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))
  )).not.toContain('https://example.test');
});

test('renders each cell’s own declared image without network access', async ({ page }) => {
  const externalRequests = await blockExternalRequests(page);
  await page.goto('http://127.0.0.1:5173/tests/?assets');

  const first = page.getByTestId('first').locator('svg');
  const second = page.getByTestId('second').locator('svg');
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  expect(await first.screenshot()).not.toEqual(await second.screenshot());
  expect(externalRequests).toEqual([]);
});

async function countPixels(page: Page, screenshot: Buffer, color: [number, number, number]) {
  return await page.evaluate(async ({ data, color }) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] === color[0] && pixels[i + 1] === color[1] && pixels[i + 2] === color[2]) count++;
    }
    return count;
  }, { data: [...screenshot], color });
}

test('preserves a diagram’s CSS-variable background', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?assets&themed');
  const first = page.getByTestId('first').locator('svg');
  await expect(first).toBeVisible();
  const redPixels = await countPixels(page, await first.screenshot(), [255, 0, 0]);
  expect(redPixels).toBeGreaterThan(100);
});

test('updates a diagram when the system color scheme changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://127.0.0.1:5173/tests/?assets&media');
  const first = page.getByTestId('first').locator('svg');
  await expect(first).toBeVisible();
  expect(await countPixels(page, await first.screenshot(), [255, 0, 0])).toBeGreaterThan(100);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(async () => countPixels(page, await first.screenshot(), [0, 0, 255])).toBeGreaterThan(100);
});

test('updates changed images and does not reuse another cell’s image', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?assets&themed');
  const first = page.getByTestId('first').locator('svg');
  await expect(first).toBeVisible();
  expect(await countPixels(page, await first.screenshot(), [255, 0, 0])).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Change first image' }).click();
  await expect.poll(async () => countPixels(page, await first.screenshot(), [0, 0, 255])).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Mutate first image bytes' }).click();
  await expect.poll(async () => countPixels(page, await first.screenshot(), [0, 255, 0])).toBeGreaterThan(100);
  await page.getByRole('button', { name: 'Remove first image' }).click();
  await expect(page.getByTestId('diagnostics')).toContainText('failed to load file');
});

test('returns SVG-space anchors for requested math rows', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?rowAnchors');

  await expect(page.getByTestId('first').locator('svg')).toBeVisible();
  await expect.poll(() =>
    page.getByTestId('row-anchors').evaluate((element) =>
      JSON.parse(element.textContent ?? '[]').length
    )
  ).toBe(2);

  const anchors = await page.getByTestId('row-anchors').evaluate((element) =>
    JSON.parse(element.textContent ?? '[]')
  );
  expect(anchors.map((anchor: { row: number }) => anchor.row)).toEqual([1, 2]);
  expect(anchors[0].height).toBeGreaterThan(0);
  expect(anchors[1].height).toBeGreaterThan(0);
  expect(anchors[1].y).toBeGreaterThan(anchors[0].y);

  const viewBoxes = await page.locator('svg').evaluateAll(elements =>
    elements.map(element => element.getAttribute('viewBox'))
  );
  expect(viewBoxes[0]).toBe(viewBoxes[1]);
});

test('rerenders only when requested row numbers change', async ({ page }) => {
  await page.goto('http://127.0.0.1:5173/tests/?rowAnchors');
  await expect(page.getByTestId('row-anchors')).toContainText('"row":2');
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[]]');

  await page.getByRole('button', { name: 'Recreate rows' }).click();
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[]]');
  await expect(page.getByTestId('row-anchors')).toContainText('"row":2');

  await page.getByRole('button', { name: 'Select first row' }).click();
  await expect(page.getByTestId('row-anchors')).not.toContainText('"row":2');
  await expect(page.getByTestId('row-anchors')).toContainText('"row":1');
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[],[]]');

  await page.getByRole('button', { name: 'Add second row' }).click();
  await expect(page.getByTestId('row-anchors')).toContainText('"row":2');
  await expect(page.getByTestId('diagnostic-events')).toHaveText('[[],[],[]]');
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
