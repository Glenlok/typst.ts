import { $typst } from '@myriaddreamin/typst.ts';
import type { TypstCompiler } from '@myriaddreamin/typst.ts';

let releaseHeld: (() => void) | undefined;

const control = {
  warnNext: false,
  emptyNext: false,
  emptySvgNext: false,
  holdNext: false,
  failHeld: false,
  started: false,
  calls: 0,
  active: 0,
  maxActive: 0,

  release() {
    if (!releaseHeld) throw new Error('No compilation is held');
    releaseHeld();
    releaseHeld = undefined;
  },

  async install() {
    const compiler = await $typst.getCompiler();
    const compile = compiler.compile.bind(compiler);
    compiler.compile = (async options => {
      const hold = control.holdNext;
      control.holdNext = false;
      control.calls++;
      control.active++;
      control.maxActive = Math.max(control.maxActive, control.active);
      try {
        const result = await compile(options);
        if (hold) {
          await new Promise<void>(resolve => {
            releaseHeld = resolve;
            control.started = true;
          });
          if (control.failHeld) {
            control.failHeld = false;
            throw 'Test failure';
          }
        }
        if (control.warnNext) {
          control.warnNext = false;
          result.diagnostics = [
            {
              package: '',
              path: options.mainFilePath,
              range: '',
              severity: 'warning',
              message: 'Test warning',
            },
          ];
        }
        if (control.emptyNext) {
          control.emptyNext = false;
          result.result = undefined;
          result.diagnostics = [];
        }
        return result;
      } finally {
        control.active--;
      }
    }) as TypstCompiler['compile'];

    const renderer = await $typst.getRenderer();
    const renderSvg = renderer.renderSvg.bind(renderer);
    renderer.renderSvg = async options => {
      if (control.emptySvgNext) {
        control.emptySvgNext = false;
        return '';
      }
      return renderSvg(options);
    };
  },
};

export type RuntimeControl = typeof control;

Object.assign(window, { typstTest: control });
