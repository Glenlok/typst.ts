import { $typst } from '@myriaddreamin/typst.ts';
import type { TypstSvgRowAnchor } from '@myriaddreamin/typst.ts';
export interface TypstDiagnostic {
  package: string;
  path: string;
  severity: string;
  range: string;
  message: string;
}

export interface TypstRowAnchorBounds {
  row: number;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypstRenderResult {
  svg: string;
  rowAnchors: TypstRowAnchorBounds[];
}

export interface TypstAsset {
  path: string;
  bytes: ArrayBuffer;
}

let nextSourceId = 0;
let nextSemanticId = 0;
let queue: Promise<void> = Promise.resolve();

export function renderTypst(
  content: string,
  rowNumbers: number[],
  assets: TypstAsset[],
  fragmentLinksOnly: boolean,
  isCurrent: () => boolean,
  onDiagnostics: (diagnostics: TypstDiagnostic[]) => void,
): Promise<TypstRenderResult | undefined> {
  const task = queue.then(() =>
    isCurrent()
      ? compileTypst(content, rowNumbers, assets, fragmentLinksOnly, isCurrent, onDiagnostics)
      : undefined,
  );
  // Keep the queue usable after failures while returning the rejection to the caller.
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function compileTypst(
  content: string,
  rowNumbers: number[],
  assets: TypstAsset[],
  fragmentLinksOnly: boolean,
  isCurrent: () => boolean,
  onDiagnostics: (diagnostics: TypstDiagnostic[]) => void,
): Promise<TypstRenderResult | undefined> {
  const compiler = await $typst.getCompiler();
  await compiler.reset();
  const directory = `/tmp/typst-vue-${nextSourceId++}`;
  const path = `${directory}/main.typ`;
  const mappedPaths: string[] = [];
  let result;
  try {
    compiler.addSource(path, content);
    mappedPaths.push(path);
    for (const asset of assets) {
      if (
        !asset.path ||
        asset.path.startsWith('/') ||
        asset.path.includes('\\') ||
        asset.path.split('/').some(part => !part || part === '.' || part === '..')
      ) throw new TypeError('Invalid Typst asset path');
      const assetPath = `${directory}/${asset.path}`;
      if (mappedPaths.includes(assetPath)) throw new TypeError('Duplicate Typst asset path');
      compiler.mapShadow(assetPath, new Uint8Array(asset.bytes));
      mappedPaths.push(assetPath);
    }
    result = await compiler.compile({ mainFilePath: path, diagnostics: 'full' });
  } finally {
    for (const mappedPath of mappedPaths) compiler.unmapShadow(mappedPath);
  }
  const diagnostics = result.diagnostics ?? [];
  if (!isCurrent()) return;
  onDiagnostics(diagnostics);
  if (!result.result) {
    if (!diagnostics.length) throw new Error('Typst compilation produced no artifact');
    return;
  }
  if (!isCurrent()) return;
  const renderer = await $typst.getRenderer();
  const rendered = rowNumbers.length
    ? await renderer.renderSvgWithRowAnchors({
      format: 'vector',
      artifactContent: result.result,
      rowNumbers,
    })
    : {
      svg: await renderer.renderSvg({ format: 'vector', artifactContent: result.result }),
      rowAnchors: [],
    };
  if (!rendered.svg) throw new Error('Typst renderer produced no SVG');
  return {
    svg: annotateSemantics(rendered.svg, fragmentLinksOnly),
    rowAnchors: rowNumbers.length
      ? measureSvgRowAnchors(rendered.svg, rendered.rowAnchors)
      : [],
  };
}

function annotateTableStructure(container: HTMLElement, nodes: Map<string, SVGElement>): void {
  const cellsByTable = new Map<string, Map<string, {
    label: string;
    row: number;
    column: number;
    colspan: number;
    rowspan: number;
    role: string;
  }>>();
  for (const group of container.querySelectorAll('[data-typst-label^="typst.ts:table-cell:"]')) {
    const label = group.getAttribute('data-typst-label')!;
    const cell = /^typst\.ts:table-cell:\d+:(\d+):(\d+):(\d+):(\d+):(cell|columnheader|rowheader):([01])$/
      .exec(label);
    if (!cell || cell[6] === '1') continue;
    const tableGroup = group.parentElement?.closest('[data-typst-label^="typst.ts:table:"]');
    const tableLabel = tableGroup?.getAttribute('data-typst-label');
    if (!tableLabel) continue;

    const cells = cellsByTable.get(tableLabel) ?? new Map();
    const row = Number(cell[1]);
    const column = Number(cell[2]);
    const key = `${row}:${column}`;
    if (!cells.has(key)) {
      cells.set(key, {
        label,
        row,
        column,
        colspan: Number(cell[3]),
        rowspan: Number(cell[4]),
        role: cell[5],
      });
    }
    cellsByTable.set(tableLabel, cells);
  }

  for (const group of container.querySelectorAll('[data-typst-label^="typst.ts:table:"]')) {
    const label = group.getAttribute('data-typst-label')!;
    const table = /^typst\.ts:table:\d+:(\d+):(\d+):([\d,]*)$/.exec(label);
    if (!table || nodes.has(label)) continue;

    const rowCount = Number(table[1]);
    const columnCount = Number(table[2]);
    if (!Number.isSafeInteger(rowCount) || !Number.isSafeInteger(columnCount)) {
      throw new Error('Invalid Typst table dimensions');
    }
    const headerRows = new Set(table[3].split(',').filter(Boolean).map(Number));
    const cells = cellsByTable.get(label) ?? new Map();
    const tableNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tableNode.setAttribute('role', 'table');
    group.before(tableNode);
    nodes.set(label, tableNode);

    const occupied = new Set<string>();
    for (let row = 0; row < rowCount; row++) {
      const rowLabel = `${label}:row:${row}`;
      const rowNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      rowNode.setAttribute('role', 'row');
      insertOrdered(tableNode, rowNode, row);
      nodes.set(rowLabel, rowNode);

      for (let column = 0; column < columnCount; column++) {
        const key = `${row}:${column}`;
        if (occupied.has(key)) continue;
        const cell = cells.get(key);
        const cellNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        cellNode.setAttribute('role', cell?.role ?? (headerRows.has(row) ? 'columnheader' : 'cell'));
        if (cell?.colspan && cell.colspan > 1) {
          cellNode.setAttribute('aria-colspan', String(cell.colspan));
        }
        if (cell?.rowspan && cell.rowspan > 1) {
          cellNode.setAttribute('aria-rowspan', String(cell.rowspan));
        }
        insertOrdered(rowNode, cellNode, column);
        if (cell) nodes.set(cell.label, cellNode);

        for (let coveredRow = row; coveredRow < Math.min(rowCount, row + (cell?.rowspan ?? 1)); coveredRow++) {
          for (
            let coveredColumn = column;
            coveredColumn < Math.min(columnCount, column + (cell?.colspan ?? 1));
            coveredColumn++
          ) {
            if (coveredRow !== row || coveredColumn !== column) {
              occupied.add(`${coveredRow}:${coveredColumn}`);
            }
          }
        }
      }
    }
  }
}

function annotateSemantics(svgSource: string, fragmentLinksOnly: boolean): string {
  const container = document.createElement('div');
  container.innerHTML = svgSource;
  if (fragmentLinksOnly) {
    for (const anchor of container.querySelectorAll('svg a')) {
      anchor.removeAttribute('onclick');
      const href = anchor.getAttribute('href') ??
        anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (!href?.startsWith('#')) {
        anchor.removeAttribute('href');
        anchor.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
      }
      anchor.removeAttribute('target');
    }
  }
  const nodes = new Map<string, SVGElement>();
  const linkGroups = new Map<string, SVGAElement[]>();
  for (const group of container.querySelectorAll('[data-typst-label^="typst.ts:link:"]')) {
    const label = group.getAttribute('data-typst-label')!;
    const anchors = linkGroups.get(label) ?? [];
    anchors.push(...group.querySelectorAll<SVGAElement>('a'));
    linkGroups.set(label, anchors);
  }
  annotateTableStructure(container, nodes);
  for (const text of container.querySelectorAll('.tsel, [data-typst-label^="typst.ts:image:"]')) {
    const label = text.getAttribute('data-typst-label');
    const image = label?.startsWith('typst.ts:image:') ?? false;
    const ancestors: {
      group: Element;
      label: string;
      role: string;
      level?: string;
      row?: number;
      column?: number;
      colspan?: number;
      rowspan?: number;
      description?: string;
    }[] = [];
    let marker = false;
    for (let parent = image ? text : text.parentElement; parent && parent !== container; parent = parent.parentElement) {
      const label = parent.getAttribute('data-typst-label');
      if (!label) continue;
      if (/^typst\.ts:list-marker:\d+$/.test(label)) {
        marker = true;
      } else {
        const imageLabel = /^typst\.ts:image:\d+:((?:[0-9a-f]{2})*)$/.exec(label);
        if (imageLabel) {
          const bytes = Uint8Array.from(imageLabel[1].match(/../g) ?? [], byte => parseInt(byte, 16));
          ancestors.unshift({
            group: parent,
            label,
            role: 'img',
            description: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
          });
          continue;
        }
        const cell = /^typst\.ts:table-cell:\d+:(\d+):(\d+):(\d+):(\d+):(cell|columnheader|rowheader):([01])$/.exec(label);
        if (cell) {
          if (cell[6] === '1') marker = true;
          ancestors.unshift({
            group: parent,
            label,
            role: cell[5],
            row: Number(cell[1]),
            column: Number(cell[2]),
            colspan: Number(cell[3]),
            rowspan: Number(cell[4]),
          });
          continue;
        }
        const table = /^typst\.ts:table:\d+:\d+:\d+:[\d,]*$/.test(label);
        const match = /^typst\.ts:(heading|list|list-item|link):\d+(?::(\d+))?$/.exec(label);
        if (match?.[1] === 'link' && fragmentLinksOnly) {
          const anchors = linkGroups.get(label) ?? [];
          if (anchors.length && anchors.every(anchor =>
            !anchor.hasAttribute('href') &&
            !anchor.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')
          )) continue;
        }
        if (table) ancestors.unshift({ group: parent, label, role: 'table' });
        else if (match) ancestors.unshift({
          group: parent,
          label,
          role: match[1] === 'list-item' ? 'listitem' : match[1],
          level: match[2],
        });
      }
    }
    if (marker) {
      text.setAttribute('aria-hidden', 'true');
      continue;
    }
    let owner: SVGElement | undefined;
    let tableLabel: string | undefined;
    for (const { group, label, role, level, row, column, colspan, rowspan, description } of ancestors) {
      if (role === 'table') tableLabel = label;
      if (row !== undefined) {
        if (!owner || !tableLabel) throw new Error('Typst table cell has no table');
        const rowLabel = `${tableLabel}:row:${row}`;
        let rowNode = nodes.get(rowLabel);
        if (!rowNode) {
          rowNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          rowNode.setAttribute('role', 'row');
          insertOrdered(owner, rowNode, row);
          nodes.set(rowLabel, rowNode);
        }
        owner = rowNode;
      }
      let node = nodes.get(label);
      if (node && role === 'table' && owner) owner.append(node);
      if (!node) {
        if (role === 'link') {
          const anchors = linkGroups.get(label) ?? [];
          const anchor = anchors[0];
          if (!anchor) throw new Error('Typst link has no destination');
          const id = `typst-semantic-${nextSemanticId++}`;
          anchor.id = id;
          anchor.setAttribute('role', 'link');
          anchor.setAttribute('tabindex', '0');
          for (const duplicate of anchors.slice(1)) {
            duplicate.setAttribute('aria-hidden', 'true');
            duplicate.setAttribute('tabindex', '-1');
          }
          const reference = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          reference.setAttribute('aria-owns', id);
          if (owner) owner.append(reference);
          else group.before(reference);
          node = anchor;
          nodes.set(label, node);
          owner = node;
          continue;
        }
        node = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        node.setAttribute('role', role);
        if (description !== undefined) node.setAttribute('aria-label', description);
        if (level) node.setAttribute('aria-level', level);
        if (colspan && colspan > 1) node.setAttribute('aria-colspan', String(colspan));
        if (rowspan && rowspan > 1) node.setAttribute('aria-rowspan', String(rowspan));
        if (owner && column !== undefined) insertOrdered(owner, node, column);
        else if (owner) owner.append(node);
        else group.before(node);
        nodes.set(label, node);
      }
      owner = node;
    }
    if (image) {
      text.setAttribute('aria-hidden', 'true');
      continue;
    }
    if (owner) {
      const id = `typst-semantic-${nextSemanticId++}`;
      text.id = id;
      const reference = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      reference.setAttribute('aria-owns', id);
      owner.append(reference);
    }
  }
  return nodes.size || fragmentLinksOnly ? container.innerHTML : svgSource;
}

function insertOrdered(parent: SVGElement, node: SVGElement, order: number): void {
  node.setAttribute('data-typst-order', String(order));
  const next = [...parent.children].find(child =>
    Number(child.getAttribute('data-typst-order')) > order
  );
  parent.insertBefore(node, next ?? null);
}

function measureSvgRowAnchors(
  svgSource: string,
  rowAnchors: TypstSvgRowAnchor[],
): TypstRowAnchorBounds[] {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  container.innerHTML = svgSource;
  document.body.append(container);

  try {
    const svg = container.querySelector('svg');
    if (!svg) throw new Error('Typst renderer produced no SVG root');
    const rootMatrix = svg.getScreenCTM();
    if (!rootMatrix) throw new Error('Typst SVG root has no screen transform');
    const toSvg = rootMatrix.inverse();
    const groups = [...svg.querySelectorAll<SVGGraphicsElement>('[data-typst-label]')];

    return rowAnchors.map(anchor => {
      const matchingGroups = groups.filter(group =>
        group.getAttribute('data-typst-label') === anchor.label
      );
      if (!matchingGroups.length) {
        throw new Error(`Typst SVG has no geometry for row ${anchor.row}`);
      }

      const bounds = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
      };
      for (const group of matchingGroups) {
        const box = group.getBBox();
        const matrix = group.getScreenCTM();
        if (!matrix) throw new Error(`Typst SVG row ${anchor.row} has no screen transform`);
        const toRoot = toSvg.multiply(matrix);
        for (const [x, y] of [
          [box.x, box.y],
          [box.x + box.width, box.y],
          [box.x, box.y + box.height],
          [box.x + box.width, box.y + box.height],
        ]) {
          const point = new DOMPoint(x, y).matrixTransform(toRoot);
          bounds.minX = Math.min(bounds.minX, point.x);
          bounds.minY = Math.min(bounds.minY, point.y);
          bounds.maxX = Math.max(bounds.maxX, point.x);
          bounds.maxY = Math.max(bounds.maxY, point.y);
        }
      }

      return {
        ...anchor,
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
      };
    });
  } finally {
    container.remove();
  }
}
