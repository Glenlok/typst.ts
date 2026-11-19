# Typst.vue3

Vue 3 component for rendering Typst source as SVG in the browser.

## Installation

Build and pack the packages from the fork checkout. Store the generated
archives outside source control:

```bash
yarn turbo run build --filter=./packages/typst.vue3
mkdir -p /path/to/local-packages
npm pack --ignore-scripts --pack-destination /path/to/local-packages \
  ./packages/compiler ./packages/renderer ./packages/typst.ts ./packages/typst.vue3
```

In the consuming application, install all four generated archives together:

```bash
npm install --ignore-scripts vue@3.5.17 \
  /path/to/local-packages/myriaddreamin-typst-ts-web-compiler-0.8.0-rc4.tgz \
  /path/to/local-packages/myriaddreamin-typst-ts-renderer-0.8.0-rc4.tgz \
  /path/to/local-packages/myriaddreamin-typst.ts-0.8.0-rc4.tgz \
  /path/to/local-packages/myriaddreamin-typst.vue3-0.8.0-rc4.tgz
```

Use the archive names produced by the checkout if its version differs.
Installing the `@myriaddreamin` names directly from a registry can select
upstream packages instead of this fork. Vue and other dependencies may still
need to be obtained separately during installation.

## Usage

```vue
<script setup lang="ts">
import Typst from '@myriaddreamin/typst.vue3';

const sourceCode = '= Hello World!';
</script>

<template>
  <Typst v-bind:content="sourceCode" />
</template>
```

The component uses fork-local compiler and renderer WASM. It does not load
fonts or fetch packages from a CDN by default. Configure fonts and packages
before mounting the first component.

## Fonts

To include the optional Libertinus Serif subsets in a bundled application:

```ts
import { configureTypst } from '@myriaddreamin/typst.vue3';
import libertinus from '@myriaddreamin/typst.vue3/libertinus';

configureTypst({ fonts: libertinus });
```

Alternatively, supply local font URLs or `Uint8Array` font bytes:

```ts
import { configureTypst } from '@myriaddreamin/typst.vue3';
import extraFontUrl from './assets/extra-font.otf?url';

configureTypst({ fonts: [extraFontUrl] });
```

The `?url` syntax is supplied by Vite; use your bundler's equivalent for other
tools. Fonts are selected during compiler initialization, not replaced after
mounting. Without any available fonts, text may not render; missing-font
diagnostics are not guaranteed by the compiler. If no fonts were supplied
through `configureTypst`, each mounted component emits one non-blocking
`warning` event. Fonts may also have been supplied outside the wrapper.

## Updates and Events

Changing the `content` prop compiles and renders the new source. The component
emits a `diagnostics` event with an array of `TypstDiagnostic` values for each
current compilation, including an empty array when there are no diagnostics.
It emits an `error` event containing an `Error` when initialization or rendering
fails. A `warning` event contains a string.

When compilation produces no artifact, or rendering fails, the last successful
SVG remains visible. An artifact accompanied by diagnostics is still rendered.
The wrapper serializes its own compilation and rendering work across component
instances and suppresses results and events from superseded requests. Direct
use of the shared Typst runtime outside the wrapper is not serialized by it.

## Package Imports

Hosts can bundle version-pinned `@preview` package archives for offline use:

```ts
import { configureTypst } from '@myriaddreamin/typst.vue3';
import libertinus from '@myriaddreamin/typst.vue3/libertinus';
import archiveUrl from './assets/example-1.0.0.tgz?url';

const response = await fetch(archiveUrl);
if (!response.ok) throw new Error(`Could not load package archive: ${response.status}`);
const data = new Uint8Array(await response.arrayBuffer());
configureTypst({
  fonts: libertinus,
  packages: [{ name: 'example', version: '1.0.0', data }],
});
```

The archive must be served as gzip file data, not with `Content-Encoding: gzip`,
which makes browsers decompress it before Typst can read it. Vite's development
server can apply that encoding to `.gz` filenames; use `.tgz` instead.
Include the archives of any transitive dependencies as well. Bundled packages
are resolved first. Set `allowRemotePackageImports: true` to allow a missing
`@preview` package to be fetched from the remote registry; otherwise no remote
package fetch is attempted.

Calling `configureTypst` after the first component starts initialization throws.
When using the Universal Module Definition (UMD) build, call
`Typst.configureTypst(...)` on the component global before mounting it.
The optional Libertinus import above is an ES module; UMD hosts can supply
their own font URLs or bytes.

## Documentation

See [Vue3 Library Docs](https://myriad-dreamin.github.io/typst.ts/cookery/guide/renderer/vue3.html).

## Development

Run the example project:

```bash
cd packages/typst.vue3 && yarn build && yarn dev
```

Run the browser tests with `yarn test`. Run the additional `@tar` tests with
`yarn test:tar`. These tests use `tar` to create a temporary package archive
from the fixture sources.
