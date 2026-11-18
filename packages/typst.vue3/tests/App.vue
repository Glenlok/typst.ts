<script setup lang="ts">
import { ref } from 'vue';
import Typst from '../dist/index.es.js';

const params = new URLSearchParams(window.location.search);
const sourceCode = ref(
  params.has('package') || params.has('remotePackage')
    ? '#import "@preview/fixture:1.0.0": greeting\n#greeting'
    : '= Hello World!\nThis is a typst document compiled in browser.',
);
const diagnostics = ref<{ severity: string; message: string }[]>([]);
const diagnosticEvents = ref<{ severity: string; message: string }[][]>([]);
const errors = ref<{ isError: boolean; message: string }[]>([]);
const warnings = ref<string[]>([]);
const showFirst = ref(true);
const secondSource = ref('= Second document');

function onDiagnostics(value: { severity: string; message: string }[]) {
  diagnostics.value = value;
  diagnosticEvents.value.push(value);
}

function onError(error: unknown) {
  errors.value.push({
    isError: error instanceof Error,
    message: error instanceof Error ? error.message : String(error),
  });
}
</script>

<template>
  <textarea aria-label="Typst source" v-model="sourceCode" />
  <output data-testid="diagnostics">{{ JSON.stringify(diagnostics) }}</output>
  <output data-testid="diagnostic-events">{{ JSON.stringify(diagnosticEvents) }}</output>
  <output data-testid="errors">{{ JSON.stringify(errors) }}</output>
  <output data-testid="warnings">{{ JSON.stringify(warnings) }}</output>
  <button @click="showFirst = false">Unmount first</button>
  <div data-testid="first">
    <Typst
      v-if="showFirst"
      v-bind:content="sourceCode"
      @diagnostics="onDiagnostics"
      @error="onError"
      @warning="warnings.push($event)"
    />
  </div>
  <div v-if="params.has('two')" data-testid="second">
    <textarea aria-label="Second Typst source" v-model="secondSource" />
    <Typst v-bind:content="secondSource" @error="onError" @warning="warnings.push($event)" />
  </div>
</template>
