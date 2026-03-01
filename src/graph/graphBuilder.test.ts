import { GraphBuilder } from './graphBuilder.js';
import type { DocFreshnessConfig, Document, Reference, SymbolLocation } from '../types.js';

function makeDoc(docPath: string, refs: Reference[]): Document {
  return {
    path: docPath,
    absolutePath: `${process.cwd()}/${docPath}`,
    content: '',
    format: 'markdown',
    lines: [],
    references: refs,
  };
}

function makeRef(type: string, value: string): Reference {
  return { type, value, lineNumber: 1, raw: value, sourceFile: 'doc.md' };
}

describe('GraphBuilder', () => {
  const config: DocFreshnessConfig = { rootDir: process.cwd() };

  it('builds graph from code-pattern references', async () => {
    const codeIndex = new Map<string, SymbolLocation[]>([
      ['MyClass', [{ filePath: 'src/myClass.ts', kind: 'class', language: 'typescript' }]],
    ]);
    const docs = [makeDoc('docs/api.md', [makeRef('code-pattern', 'MyClass')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, codeIndex);
    expect(graph.getCodeReferencedByDoc('docs/api.md').has('src/myClass.ts')).toBe(true);
    expect(graph.codeSymbols.get('src/myClass.ts')?.has('MyClass')).toBe(true);
  });

  it('stores code symbols from the index', async () => {
    const codeIndex = new Map<string, SymbolLocation[]>([
      ['FuncA', [{ filePath: 'src/a.ts', kind: 'function', language: 'typescript' }]],
      ['FuncB', [{ filePath: 'src/a.ts', kind: 'function', language: 'typescript' }]],
    ]);
    const graph = await new GraphBuilder(config).buildGraph([], codeIndex);
    expect(graph.codeSymbols.get('src/a.ts')?.size).toBe(2);
  });

  it('resolves file-path references when file is in code index', async () => {
    const codeIndex = new Map<string, SymbolLocation[]>([
      ['SomeFunc', [{ filePath: 'src/utils.ts', kind: 'function', language: 'typescript' }]],
    ]);
    const docs = [makeDoc('docs/guide.md', [makeRef('file-path', '../src/utils.ts')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, codeIndex);
    expect(graph.getCodeReferencedByDoc('docs/guide.md').has('src/utils.ts')).toBe(true);
  });

  it('does not resolve file-path when file is not in code index', async () => {
    const codeIndex = new Map<string, SymbolLocation[]>([
      ['Other', [{ filePath: 'src/other.ts', kind: 'function', language: 'typescript' }]],
    ]);
    const docs = [makeDoc('docs/guide.md', [makeRef('file-path', '../src/missing.ts')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, codeIndex);
    expect(graph.getCodeReferencedByDoc('docs/guide.md').size).toBe(0);
  });

  it('does not resolve file-path when codeIndex is null', async () => {
    const docs = [makeDoc('docs/guide.md', [makeRef('file-path', '../src/utils.ts')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, null);
    expect(graph.getCodeReferencedByDoc('docs/guide.md').size).toBe(0);
  });

  it('ignores dependency references (external packages)', async () => {
    const docs = [makeDoc('docs/api.md', [makeRef('dependency', 'express')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, new Map());
    expect(graph.getCodeReferencedByDoc('docs/api.md').size).toBe(0);
  });

  it('sets buildTimestamp on the graph', async () => {
    const before = Date.now();
    const graph = await new GraphBuilder(config).buildGraph([], null);
    expect(graph.buildTimestamp).toBeGreaterThanOrEqual(before);
  });

  it('handles null codeIndex for code-pattern refs', async () => {
    const docs = [makeDoc('docs/api.md', [makeRef('code-pattern', 'Missing')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, null);
    expect(graph.getCodeReferencedByDoc('docs/api.md').size).toBe(0);
  });

  it('resolves code-pattern to multiple files', async () => {
    const codeIndex = new Map<string, SymbolLocation[]>([
      [
        'SharedFunc',
        [
          { filePath: 'src/a.ts', kind: 'function', language: 'typescript' },
          { filePath: 'src/b.ts', kind: 'function', language: 'typescript' },
        ],
      ],
    ]);
    const docs = [makeDoc('docs/api.md', [makeRef('code-pattern', 'SharedFunc')])];
    const graph = await new GraphBuilder(config).buildGraph(docs, codeIndex);
    const refs = graph.getCodeReferencedByDoc('docs/api.md');
    expect(refs.has('src/a.ts')).toBe(true);
    expect(refs.has('src/b.ts')).toBe(true);
  });
});
