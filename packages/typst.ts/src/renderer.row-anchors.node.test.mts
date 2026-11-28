import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTypstCompiler } from './compiler.mjs';
import { loadFonts } from './options.init.mjs';
import { createTypstRenderer } from './renderer.mjs';

const readWasm = (path: string) =>
  readFileSync(new URL(path, import.meta.url));

describe('row anchors', () => {
  it('returns SVG labels for requested rows and rejects missing rows', async () => {
    const compiler = createTypstCompiler();
    await compiler.init({
      beforeBuild: [
        loadFonts([
          new Uint8Array(
            readFileSync(
              new URL('../../../assets/data/LibertinusSerif-Regular-subset.otf', import.meta.url),
            ),
          ),
        ]),
      ],
      getModule: () => readWasm('../../compiler/pkg/typst_ts_web_compiler_bg.wasm'),
    });
    await compiler.addSource(
      '/main.typ',
      '$ #metadata("typst.ts:row-anchor:start:1") x = 1 #metadata("typst.ts:row-anchor:end:1") \\\\ #metadata("typst.ts:row-anchor:start:2") y = 2 #metadata("typst.ts:row-anchor:end:2") $',
    );
    const compiled = await compiler.compile({ mainFilePath: '/main.typ' });
    if (!compiled.result) {
      throw new Error(
        `Expected compiled Typst output: ${
          compiled.diagnostics?.map(({ message }) => message).join('; ')
        }`,
      );
    }

    const renderer = createTypstRenderer();
    await renderer.init({
      getModule: () => readWasm('../../renderer/pkg/typst_ts_renderer_bg.wasm'),
    });
    const rendered = await renderer.renderSvgWithRowAnchors({
      format: 'vector',
      artifactContent: compiled.result,
      rowNumbers: [1, 2],
    });

    expect(rendered.svg).toContain('<svg');
    expect(rendered.rowAnchors.map(({ row }) => row)).toEqual([1, 2]);
    for (const { label } of rendered.rowAnchors) {
      expect(rendered.svg).toContain(`data-typst-label="${label}"`);
    }

    await expect(
      renderer.renderSvgWithRowAnchors({
        format: 'vector',
        artifactContent: compiled.result,
        rowNumbers: [3],
      }),
    ).rejects.toThrow('Renderer.MissingRowAnchor');
  });

  it('rejects row anchors that are no longer in the current incremental document', async () => {
    const compiler = createTypstCompiler();
    await compiler.init({
      beforeBuild: [
        loadFonts([
          new Uint8Array(
            readFileSync(
              new URL('../../../assets/data/LibertinusSerif-Regular-subset.otf', import.meta.url),
            ),
          ),
        ]),
      ],
      getModule: () => readWasm('../../compiler/pkg/typst_ts_web_compiler_bg.wasm'),
    });

    const mainFilePath = '/main.typ';
    const rowOne =
      '$ #metadata("typst.ts:row-anchor:start:1") x = 1 #metadata("typst.ts:row-anchor:end:1") \\\\ ';
    const rowTwo =
      '#metadata("typst.ts:row-anchor:start:2") y = 2 #metadata("typst.ts:row-anchor:end:2") $';
    compiler.addSource(mainFilePath, rowOne + rowTwo);

    let firstDelta!: Uint8Array;
    let secondDelta!: Uint8Array;
    await compiler.withIncrementalServer(async incrementalServer => {
      const firstCompile = await compiler.compile({ mainFilePath, incrementalServer });
      if (!firstCompile.result) {
        throw new Error(
          `Expected compiled Typst output: ${
            firstCompile.diagnostics?.map(({ message }) => message).join('; ')
          }`,
        );
      }
      firstDelta = firstCompile.result;

      compiler.addSource(mainFilePath, '$ ' + rowTwo);
      const secondCompile = await compiler.compile({ mainFilePath, incrementalServer });
      if (!secondCompile.result) {
        throw new Error(
          `Expected compiled Typst output: ${
            secondCompile.diagnostics?.map(({ message }) => message).join('; ')
          }`,
        );
      }
      secondDelta = secondCompile.result;
    });

    const renderer = createTypstRenderer();
    await renderer.init({
      getModule: () => readWasm('../../renderer/pkg/typst_ts_renderer_bg.wasm'),
    });
    const session = await renderer.createModule();
    session.manipulateData({ action: 'merge', data: firstDelta });
    session.manipulateData({ action: 'merge', data: secondDelta });

    await expect(
      renderer.renderSvgWithRowAnchors({
        renderSession: session,
        rowNumbers: [1],
      }),
    ).rejects.toThrow('Renderer.MissingRowAnchor');
  });
});
