import { CodeDocGraph } from './codeDocGraph.js';
import type { Reference, SerializedGraph } from '../types.js';

function makeRef(type: string, value: string): Reference {
  return { type, value, lineNumber: 1, raw: value, sourceFile: 'doc.md' };
}

describe('CodeDocGraph', () => {
  let graph: CodeDocGraph;

  beforeEach(() => {
    graph = new CodeDocGraph();
  });

  describe('addReference', () => {
    it('creates doc-to-code and code-to-doc edges', () => {
      graph.addReference('docs/api.md', 'src/server.ts', makeRef('file-path', 'src/server.ts'));

      expect(graph.getCodeReferencedByDoc('docs/api.md').has('src/server.ts')).toBe(true);
      expect(graph.getDocsReferencingCode('src/server.ts').has('docs/api.md')).toBe(true);
    });

    it('stores reference metadata', () => {
      const ref = makeRef('code-pattern', 'MyClass');
      graph.addReference('docs/api.md', 'src/myClass.ts', ref);

      const docRefs = graph.docReferences.get('docs/api.md');
      expect(docRefs).toHaveLength(1);
      expect(docRefs![0].resolvedCodeFile).toBe('src/myClass.ts');
    });

    it('handles multiple references from same doc', () => {
      graph.addReference('docs/api.md', 'src/a.ts', makeRef('file-path', 'a.ts'));
      graph.addReference('docs/api.md', 'src/b.ts', makeRef('file-path', 'b.ts'));

      expect(graph.getCodeReferencedByDoc('docs/api.md').size).toBe(2);
    });
  });

  describe('query methods', () => {
    beforeEach(() => {
      graph.addReference('docs/a.md', 'src/x.ts', makeRef('file-path', 'x.ts'));
      graph.addReference('docs/b.md', 'src/x.ts', makeRef('file-path', 'x.ts'));
      graph.addReference('docs/a.md', 'src/y.ts', makeRef('file-path', 'y.ts'));
    });

    it('getDocsReferencingCode returns all docs referencing a code file', () => {
      expect(graph.getDocsReferencingCode('src/x.ts').size).toBe(2);
    });

    it('returns empty set for unknown paths', () => {
      expect(graph.getDocsReferencingCode('unknown').size).toBe(0);
      expect(graph.getCodeReferencedByDoc('unknown').size).toBe(0);
    });

    it('getAllDocs returns all document paths', () => {
      expect(graph.getAllDocs().sort()).toEqual(['docs/a.md', 'docs/b.md']);
    });

    it('getAllCodeFiles returns all code file paths', () => {
      expect(graph.getAllCodeFiles().sort()).toEqual(['src/x.ts', 'src/y.ts']);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips correctly', () => {
      graph.addReference('docs/a.md', 'src/x.ts', makeRef('file-path', 'x.ts'));
      graph.codeSymbols.set('src/x.ts', new Set(['MyClass', 'myFunc']));
      graph.buildTimestamp = 12345;
      graph.gitCommit = 'abc';
      graph.configHash = 'def';

      const serialized = graph.serialize();
      const restored = CodeDocGraph.deserialize(serialized);

      expect(restored.getCodeReferencedByDoc('docs/a.md').has('src/x.ts')).toBe(true);
      expect(restored.codeSymbols.get('src/x.ts')!.has('MyClass')).toBe(true);
      expect(restored.buildTimestamp).toBe(12345);
      expect(restored.gitCommit).toBe('abc');
      expect(restored.configHash).toBe('def');
    });

    it('handles empty graph', () => {
      const serialized = graph.serialize();
      const restored = CodeDocGraph.deserialize(serialized);
      expect(restored.getAllDocs()).toEqual([]);
    });

    it('handles missing fields in serialized data gracefully', () => {
      const partial = { buildTimestamp: null, gitCommit: null, configHash: null } as unknown as SerializedGraph;
      const restored = CodeDocGraph.deserialize(partial);
      expect(restored.getAllDocs()).toEqual([]);
      expect(restored.getAllCodeFiles()).toEqual([]);
      expect(restored.codeSymbols.size).toBe(0);
    });
  });
});
