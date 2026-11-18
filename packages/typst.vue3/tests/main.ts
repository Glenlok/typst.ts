import { createApp } from 'vue';
import App from './App.vue';
import { configureTypst } from '../dist/index.es.js';
import libertinus from '../dist/libertinus.js';

const params = new URLSearchParams(window.location.search);
const fonts = params.has('fontBytes')
  ? [new Uint8Array(await (await fetch(libertinus[0])).arrayBuffer())]
  : libertinus;

configureTypst({
  fonts,
  allowRemotePackageImports: params.has('allowRemotePackageImports'),
});

createApp(App).mount('#app');
