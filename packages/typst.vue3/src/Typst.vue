<template>
  <div v-html="typst.rendered.svg" @click="navigateLink" />
</template>

<script setup lang="ts">
import { reactive, onBeforeUnmount, onMounted, watch } from 'vue';
import { renderTypst, type TypstAsset, type TypstDiagnostic, type TypstRowAnchorBounds } from './render-typst.ts';
import setTypst from './set-init-options-typst.ts';

interface prop {
  content: string;
  rowNumbers?: number[];
  assets?: TypstAsset[];
  fragmentLinksOnly?: boolean;
  delegatedFragmentPrefix?: string;
}

const typst = reactive({
  rendered: {
    svg: '',
    rowAnchors: [] as TypstRowAnchorBounds[],
  },
});

const props = withDefaults(defineProps<prop>(), {
  content: '',
  rowNumbers: () => [],
  assets: () => [],
  fragmentLinksOnly: false,
});

const emit = defineEmits<{
  diagnostics: [diagnostics: TypstDiagnostic[]];
  error: [error: Error];
  warning: [warning: string];
  rowAnchors: [rowAnchors: TypstRowAnchorBounds[]];
  fragment: [fragment: string];
}>();

let requestId = 0;
let unmounted = false;

function navigateLink(event: MouseEvent) {
  if (!props.fragmentLinksOnly || !(event.target instanceof Element)) return;
  const anchor = event.target.closest('a');
  if (!anchor || !(event.currentTarget instanceof HTMLElement)) return;
  const location = anchor.getAttribute('data-typst-location');
  const href = anchor.getAttribute('href') ??
    anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
  if (!location && !href?.startsWith('#')) return;
  event.preventDefault();
  const root = event.currentTarget;
  if (!location) {
    if (props.delegatedFragmentPrefix && href?.startsWith(`#${props.delegatedFragmentPrefix}`)) {
      emit('fragment', href.slice(1));
      return;
    }
    const target = href && href.length > 1
      ? root.querySelector<HTMLElement | SVGElement>(`#${CSS.escape(href.slice(1))}`)
      : null;
    if (!target) {
      emit('error', new Error('Typst fragment target is unavailable.'));
      return;
    }
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }
  const destinationLabel = anchor.closest('[data-typst-label^="typst.ts:destination:"]')
    ?.getAttribute('data-typst-label');
  if (!destinationLabel) {
    const [pageNumber, x, y] = location.trim().split(/\s+/).map(Number);
    const page = Number.isSafeInteger(pageNumber) && pageNumber > 0
      ? root.querySelectorAll<SVGGElement>('.typst-page')[pageNumber - 1]
      : undefined;
    const transform = page?.getScreenCTM();
    const svg = page?.ownerSVGElement;
    if (!page || !transform || !svg || !Number.isFinite(x) || !Number.isFinite(y)) {
      emit('error', new Error('Typst position target is unavailable.'));
      return;
    }
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screenPoint = point.matrixTransform(transform);
    window.scrollTo({
      left: window.scrollX + screenPoint.x - window.innerWidth * 0.07,
      top: window.scrollY + screenPoint.y - window.innerHeight * 0.382,
      behavior: 'smooth',
    });
    return;
  }
  const destination = destinationLabel.slice('typst.ts:destination:'.length);
  if (!/^\d+$/.test(destination)) {
    emit('error', new Error('Typst location target is unavailable.'));
    return;
  }
  const groups = root.querySelectorAll(
    `[data-typst-label="typst.ts:target:${destination}"]`,
  );
  const links = new Set(
    [...groups].flatMap(group =>
      [...group.querySelectorAll<SVGAElement>('a[role="link"]:not([aria-hidden="true"])')]
    ),
  );
  const target = links.size === 1
    ? [...links][0]
    : [...groups].map(group => group.querySelector<HTMLElement>('.tsel')).find(Boolean);
  if (!target) {
    emit('error', new Error('Typst location target has no readable content.'));
    return;
  }
  root.querySelector('[data-typst-location-target]')?.removeAttribute('data-typst-location-target');
  target.setAttribute('data-typst-location-target', '');
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'center', inline: 'nearest' });
}

async function render(
  content: string,
  rowNumbers: number[],
  assets: TypstAsset[],
  fragmentLinksOnly: boolean,
  initial = false,
) {
  const id = ++requestId;
  const isCurrent = () => !unmounted && id === requestId;
  try {
    const hasFonts = setTypst();
    if (initial && !hasFonts) {
      emit('warning', 'No fonts configured through configureTypst; text may not render.');
    }
    const rendered = await renderTypst(content, rowNumbers, assets, fragmentLinksOnly, isCurrent, diagnostics =>
      emit('diagnostics', diagnostics),
    );
    if (rendered !== undefined && isCurrent()) {
      typst.rendered = rendered;
      emit('rowAnchors', rendered.rowAnchors);
    }
  } catch (error) {
    if (isCurrent()) emit('error', error instanceof Error ? error : new Error(String(error)));
  }
}

onBeforeUnmount(() => {
  unmounted = true;
});

onMounted(async () => {
  await render(props.content, props.rowNumbers, props.assets, props.fragmentLinksOnly, true);
});

watch(
  [
    () => props.content,
    () => [...props.rowNumbers],
    () => props.assets.map(({ path, bytes }) => ({ path, bytes })),
    () => props.fragmentLinksOnly,
  ],
  async ([content, rowNumbers, assets, fragmentLinksOnly], [previousContent, previousRows, previousAssets, previousPolicy]) => {
    if (
      content === previousContent &&
      fragmentLinksOnly === previousPolicy &&
      rowNumbers.length === previousRows.length &&
      rowNumbers.every((row, index) => row === previousRows[index]) &&
      assets.length === previousAssets.length &&
      assets.every((asset, index) =>
        asset.path === previousAssets[index]?.path && asset.bytes === previousAssets[index]?.bytes
      )
    ) return;
    await render(content, rowNumbers, assets, fragmentLinksOnly);
  },
);
</script>

<style lang="css"></style>
