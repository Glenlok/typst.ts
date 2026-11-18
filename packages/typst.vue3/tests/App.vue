<script setup lang="ts">
import Typst from '../dist/index.es.js';

const params = new URLSearchParams(window.location.search);
const sourceCode =
  params.has('package') || params.has('remotePackage')
    ? '#import "@preview/fixture:1.0.0": greeting\n#greeting'
    : '= Hello World!\nThis is a typst document compiled in browser.';
</script>

<template>
  <Typst v-bind:content="sourceCode" />
</template>
