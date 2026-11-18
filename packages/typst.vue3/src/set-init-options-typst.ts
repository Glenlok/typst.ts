import {
  $typst,
  FetchPackageRegistry,
  initOptions,
  MemoryAccessModel,
} from '@myriaddreamin/typst.ts';
import type { PackageSpec } from '@myriaddreamin/typst.ts/internal.types';
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url&no-inline';
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url&no-inline';

export interface TypstConfiguration {
  allowRemotePackageImports?: boolean;
  fonts?: (string | Uint8Array)[];
  packages?: BundledPackage[];
}

export interface BundledPackage {
  name: string;
  version: string;
  data: Uint8Array;
}

let inited = false;
let allowRemotePackageImports = false;
let fonts: (string | Uint8Array)[] = [];
let packages: BundledPackage[] = [];

export function configureTypst(options: TypstConfiguration): void {
  if (inited) {
    throw new Error('Typst has already been initialized');
  }
  if (
    !options ||
    (options.allowRemotePackageImports !== undefined &&
      typeof options.allowRemotePackageImports !== 'boolean')
  ) {
    throw new TypeError('allowRemotePackageImports must be a boolean');
  }
  if (
    options.fonts !== undefined &&
    (!Array.isArray(options.fonts) ||
      options.fonts.some(font => typeof font !== 'string' && !(font instanceof Uint8Array)))
  ) {
    throw new TypeError('fonts must contain URLs or byte arrays');
  }
  if (
    options.packages !== undefined &&
    (!Array.isArray(options.packages) ||
      options.packages.some(
        pkg =>
          !pkg ||
          typeof pkg.name !== 'string' ||
          !pkg.name ||
          typeof pkg.version !== 'string' ||
          !pkg.version ||
          !(pkg.data instanceof Uint8Array),
      ))
  ) {
    throw new TypeError('packages must contain a name, version and archive bytes');
  }
  const packageKeys = options.packages?.map(pkg => JSON.stringify([pkg.name, pkg.version])) ?? [];
  if (new Set(packageKeys).size !== packageKeys.length) {
    throw new TypeError('duplicate bundled package');
  }

  allowRemotePackageImports = options.allowRemotePackageImports ?? false;
  fonts = options.fonts ? [...options.fonts] : [];
  packages = options.packages ? [...options.packages] : [];
}

function usePackageRegistry() {
  const accessModel = new MemoryAccessModel();
  class BundledPackageRegistry extends FetchPackageRegistry {
    override pullPackageData(spec: PackageSpec): Uint8Array | undefined {
      const pkg = packages.find(item => item.name === spec.name && item.version === spec.version);
      if (pkg) return pkg.data;
      return allowRemotePackageImports ? super.pullPackageData(spec) : undefined;
    }
  }

  $typst.use(
    {
      key: 'access-model',
      forRoles: ['compiler'],
      provides: [initOptions.withAccessModel(accessModel)],
    },
    {
      key: 'package-registry',
      forRoles: ['compiler'],
      provides: [initOptions.withPackageRegistry(new BundledPackageRegistry(accessModel))],
    },
  );
}

export default function setTypst() {
  if (!inited) {
    inited = true;
    $typst.setCompilerInitOptions({
      beforeBuild: [initOptions.disableDefaultFontAssets(), initOptions.loadFonts(fonts)],
      getModule: () => compilerWasmUrl,
    });

    $typst.setRendererInitOptions({
      beforeBuild: [],
      getModule: () => rendererWasmUrl,
    });
    usePackageRegistry();
  }
  return fonts.length > 0;
}
