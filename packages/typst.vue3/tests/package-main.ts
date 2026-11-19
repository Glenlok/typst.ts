import { createApp } from 'vue';
import App from './App.vue';
import { configureTypst } from '../dist/index.es.js';
import libertinus from '../dist/libertinus.js';
import archiveUrl from './.generated/fixture.tgz?url&no-inline';

const params = new URLSearchParams(window.location.search);
const packages = [];
if (params.has('package')) {
  const response = await fetch(archiveUrl);
  if (!response.ok) throw new Error(`Could not load package archive: ${response.status}`);
  packages.push({
    name: 'fixture',
    version: '1.0.0',
    data: new Uint8Array(await response.arrayBuffer()),
  });
}

configureTypst({
  fonts: libertinus,
  packages,
  allowRemotePackageImports: params.has('allowRemotePackageImports'),
});

createApp(App).mount('#app');
