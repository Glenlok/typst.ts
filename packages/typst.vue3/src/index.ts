import Typst from './Typst.vue';
import { configureTypst } from './set-init-options-typst';

Object.assign(Typst, { configureTypst });

export { configureTypst };
export type { BundledPackage, TypstConfiguration } from './set-init-options-typst';
export default Typst;
