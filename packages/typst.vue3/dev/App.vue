<script setup lang="ts">
import Typst from '../dist/index.es.js';

const sourceCode = '= Hello World!\nThis is a typst document compiled in browser.';
</script>

<template>
  <Typst v-bind:content="sourceCode" />
</template>

<style lang="css"></style>
