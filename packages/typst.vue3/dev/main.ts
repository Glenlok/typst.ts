console.log('hello world');
import App from './App.vue';
import { createApp } from 'vue';
import { configureTypst } from '../dist/index.es.js';
import libertinus from '../dist/libertinus.js';

configureTypst({ fonts: libertinus });

const app = createApp(App);

app.mount('#app');
