<script setup lang="ts">
import { ref } from 'vue';
import Typst from '../dist/index.es.js';

const params = new URLSearchParams(window.location.search);
const diagram = (color: string) => new TextEncoder().encode(
  params.has('media')
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><style>:root{--lumina-diagram-background:red}@media (prefers-color-scheme:dark){:root{--lumina-diagram-background:blue}}</style><rect width="40" height="40" fill="var(--lumina-diagram-background)"/></svg>`
    : params.has('themed')
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><style>:root{--lumina-diagram-background:${color}}</style><rect width="40" height="40" fill="var(--lumina-diagram-background)"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`,
).buffer;
const firstAssets = ref([{ path: 'assets/demo.svg', bytes: diagram('red') }]);
const secondAssets = ref([{ path: 'assets/demo.svg', bytes: diagram('blue') }]);
const rowAnchoredSource =
  '$ #metadata("typst.ts:row-anchor:start:1") F = m a #metadata("typst.ts:row-anchor:end:1") \\ #metadata("typst.ts:row-anchor:start:2") M = F L #metadata("typst.ts:row-anchor:end:2") $';
const sourceCode = ref(
  params.has('assets')
    ? '#image("assets/demo.svg")'
    : params.has('package') || params.has('remotePackage')
    ? '#import "@preview/fixture:1.0.0": greeting\n#greeting'
    : params.has('rowAnchors')
    ? rowAnchoredSource
    : '= Hello World!\nThis is a typst document compiled in browser.',
);
const diagnostics = ref<{ severity: string; message: string }[]>([]);
const diagnosticEvents = ref<{ severity: string; message: string }[][]>([]);
const errors = ref<{ isError: boolean; message: string }[]>([]);
const warnings = ref<string[]>([]);
const fragments = ref<string[]>([]);
const rowAnchors = ref<
  { row: number; x: number; y: number; width: number; height: number }[]
>([]);
const showFirst = ref(true);
const secondSource = ref(params.has('assets') ? '#image("assets/demo.svg")' : '= Second document');
const requestedRows = ref(params.has('rowAnchors') ? [1, 2] : []);

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

function onRowAnchors(
  value: { row: number; x: number; y: number; width: number; height: number }[],
) {
  rowAnchors.value = value;
}
</script>

<template>
  <textarea aria-label="Typst source" v-model="sourceCode" />
  <output data-testid="diagnostics">{{ JSON.stringify(diagnostics) }}</output>
  <output data-testid="diagnostic-events">{{ JSON.stringify(diagnosticEvents) }}</output>
  <output data-testid="errors">{{ JSON.stringify(errors) }}</output>
  <output data-testid="warnings">{{ JSON.stringify(warnings) }}</output>
  <output data-testid="fragments">{{ JSON.stringify(fragments) }}</output>
  <output data-testid="row-anchors">{{ JSON.stringify(rowAnchors) }}</output>
  <button @click="showFirst = false">Unmount first</button>
  <button v-if="params.has('assets')" @click="firstAssets = [{ path: 'assets/demo.svg', bytes: diagram('blue') }]">
    Change first image
  </button>
  <button v-if="params.has('assets')" @click="firstAssets = []">Remove first image</button>
  <button v-if="params.has('rowAnchors')" @click="requestedRows = [...requestedRows]">
    Recreate rows
  </button>
  <button v-if="params.has('rowAnchors')" @click="requestedRows = [1]">
    Select first row
  </button>
  <button v-if="params.has('rowAnchors')" @click="requestedRows.push(2)">
    Add second row
  </button>
  <div data-testid="first">
    <Typst
      v-if="showFirst"
      v-bind:content="sourceCode"
      v-bind:row-numbers="requestedRows"
      v-bind:assets="params.has('assets') ? firstAssets : []"
      v-bind:fragment-links-only="params.has('fragmentLinksOnly')"
      v-bind:delegated-fragment-prefix="params.has('delegateFragments') ? 'preview-' : undefined"
      @diagnostics="onDiagnostics"
      @error="onError"
      @warning="warnings.push($event)"
      @row-anchors="onRowAnchors"
      @fragment="fragments.push($event)"
    />
  </div>
  <div v-if="params.has('rowAnchors')" data-testid="row-anchor-baseline">
    <Typst content="$ F = m a \\ M = F L $" />
  </div>
  <div v-if="params.has('two') || params.has('assets')" data-testid="second">
    <textarea aria-label="Second Typst source" v-model="secondSource" />
    <Typst v-bind:content="secondSource" v-bind:assets="secondAssets" @error="onError" @warning="warnings.push($event)" />
  </div>
</template>
