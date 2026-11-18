import { createApp } from 'vue';
import App from './App.vue';
import { configureTypst } from '../dist/index.es.js';
import libertinus from '../dist/libertinus.js';
import './runtime-control';

const params = new URLSearchParams(window.location.search);
const fonts = params.has('noFonts')
  ? []
  : params.has('fontBytes')
    ? [new Uint8Array(await (await fetch(libertinus[0])).arrayBuffer())]
    : libertinus;

configureTypst({
  fonts,
  allowRemotePackageImports: params.has('allowRemotePackageImports'),
});

createApp(App).mount('#app');
