import Typst from './Typst.vue';
import { $typst } from '@myriaddreamin/typst.ts';
import { configureTypst } from './set-init-options-typst';
import setTypst from './set-init-options-typst';

Object.assign(Typst, { configureTypst });

export { configureTypst };
export async function findTypstFunctionCalls(
  source: string,
  name: string,
): Promise<{ start: number; end: number }[]> {
  setTypst();
  return (await $typst.getCompiler()).findFunctionCalls(source, name);
}
export type { BundledPackage, TypstConfiguration } from './set-init-options-typst';
export type { TypstDiagnostic, TypstRowAnchorBounds } from './render-typst';
export default Typst;
