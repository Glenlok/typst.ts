<template>
  <div v-html="typst.compiled" />
</template>

<script setup lang="ts">
import { reactive, onBeforeUnmount, onMounted, watch } from 'vue';
import { renderTypst, type TypstDiagnostic } from './render-typst.ts';
import setTypst from './set-init-options-typst.ts';

interface prop {
  content: string;
}

const typst = reactive({
  compiled: '',
});

const props = withDefaults(defineProps<prop>(), {
  content: '',
});

const emit = defineEmits<{
  diagnostics: [diagnostics: TypstDiagnostic[]];
  error: [error: Error];
  warning: [warning: string];
}>();

let requestId = 0;
let unmounted = false;

async function render(content: string, initial = false) {
  const id = ++requestId;
  const isCurrent = () => !unmounted && id === requestId;
  try {
    const hasFonts = setTypst();
    if (initial && !hasFonts) {
      emit('warning', 'No fonts configured through configureTypst; text may not render.');
    }
    const svg = await renderTypst(content, isCurrent, diagnostics =>
      emit('diagnostics', diagnostics),
    );
    if (svg !== undefined && isCurrent()) typst.compiled = svg;
  } catch (error) {
    if (isCurrent()) emit('error', error instanceof Error ? error : new Error(String(error)));
  }
}

onBeforeUnmount(() => {
  unmounted = true;
});

onMounted(async () => {
  await render(props.content, true);
});

watch(
  () => props.content,
  async content => {
    await render(content);
  },
);
</script>

<style lang="css"></style>
