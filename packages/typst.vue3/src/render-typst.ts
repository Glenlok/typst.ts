import { $typst } from '@myriaddreamin/typst.ts';
import type { DiagnosticsData } from '@myriaddreamin/typst.ts/compiler';

export type TypstDiagnostic = DiagnosticsData['full'];

let nextSourceId = 0;
let queue: Promise<void> = Promise.resolve();

export function renderTypst(
  content: string,
  isCurrent: () => boolean,
  onDiagnostics: (diagnostics: TypstDiagnostic[]) => void,
): Promise<string | undefined> {
  const task = queue.then(() =>
    isCurrent() ? compileTypst(content, isCurrent, onDiagnostics) : undefined,
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
  isCurrent: () => boolean,
  onDiagnostics: (diagnostics: TypstDiagnostic[]) => void,
): Promise<string | undefined> {
  const compiler = await $typst.getCompiler();
  await compiler.reset();
  const path = `/tmp/typst-vue-${nextSourceId++}.typ`;
  compiler.addSource(path, content);
  let result;
  try {
    result = await compiler.compile({ mainFilePath: path, diagnostics: 'full' });
  } finally {
    compiler.unmapShadow(path);
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
  const svg = await renderer.renderSvg({ format: 'vector', artifactContent: result.result });
  if (!svg) throw new Error('Typst renderer produced no SVG');
  return svg;
}
