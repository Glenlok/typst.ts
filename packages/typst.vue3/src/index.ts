import Typst from './Typst.vue';
import { $typst } from '@myriaddreamin/typst.ts';
import { configureTypst } from './set-init-options-typst';
import setTypst from './set-init-options-typst';
import { renderTypst } from './render-typst';

Object.assign(Typst, { configureTypst });

export { configureTypst };
export async function findTypstFunctionCalls(
  source: string,
  name: string,
): Promise<{ start: number; end: number }[]> {
  setTypst();
  return (await $typst.getCompiler()).findFunctionCalls(source, name);
}

export async function validateTypstMath(source: string, inlineOnly = false): Promise<boolean> {
  setTypst();
  if (!await (await $typst.getCompiler()).isSafeMath(source, inlineOnly)) return false;
  let hasError = false;
  const result = await renderTypst(source, [], [], true, () => true, diagnostics => {
    hasError = diagnostics.some(diagnostic => diagnostic.severity === 'error');
  });
  return result !== undefined && !hasError;
}
export type { BundledPackage, TypstConfiguration } from './set-init-options-typst';
export type { TypstDiagnostic, TypstRowAnchorBounds } from './render-typst';
export default Typst;
