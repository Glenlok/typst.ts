# Typst.vue3

Vue 3 component for rendering Typst source as SVG in the browser.

## Installation

```bash
yarn add vue @myriaddreamin/typst.ts @myriaddreamin/typst-ts-web-compiler @myriaddreamin/typst-ts-renderer @myriaddreamin/typst.vue3
```

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
diagnostic reporting is not yet exposed by this component.

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
