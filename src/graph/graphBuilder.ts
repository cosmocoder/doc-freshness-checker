import path from 'path';
import { CodeDocGraph } from './codeDocGraph.js';
import type { DocFreshnessConfig, Document, Reference, SymbolLocation } from '../types.js';

/**
 * Builds the code-to-doc relationship graph
 */
export class GraphBuilder {
  private config: DocFreshnessConfig;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
  }

  /**
   * Build the complete code-to-doc graph
   */
  async buildGraph(documents: Document[], codeIndex: Map<string, SymbolLocation[]> | null): Promise<CodeDocGraph> {
    const graph = new CodeDocGraph();
    const indexedFilePaths = codeIndex
      ? new Set(
          Array.from(codeIndex.values())
            .flatMap((locations) => locations.map((loc) => loc.filePath))
        )
      : null;

    // Resolve references and build edges
    for (const doc of documents) {
      for (const ref of doc.references) {
        const resolvedFiles = this.resolveReference(ref, doc, codeIndex, indexedFilePaths);

        for (const codeFile of resolvedFiles) {
          graph.addReference(doc.path, codeFile, ref);
        }
      }
    }

    // Store code symbols for change detection
    if (codeIndex) {
      for (const [symbolName, locations] of codeIndex.entries()) {
        for (const location of locations) {
          if (!graph.codeSymbols.has(location.filePath)) {
            graph.codeSymbols.set(location.filePath, new Set());
          }
          graph.codeSymbols.get(location.filePath)!.add(symbolName);
        }
      }
    }

    graph.buildTimestamp = Date.now();

    return graph;
  }

  /**
   * Resolve a reference to actual code files
   */
  private resolveReference(
    ref: Reference,
    doc: Document,
    codeIndex: Map<string, SymbolLocation[]> | null,
    indexedFilePaths: Set<string> | null
  ): string[] {
    const resolvedFiles: string[] = [];

    switch (ref.type) {
      case 'file-path': {
        // Direct file reference
        const docDir = path.dirname(doc.absolutePath || doc.path);
        const resolvedPath = path.resolve(docDir, ref.value);
        const relativePath = path.relative(this.config.rootDir || process.cwd(), resolvedPath);

        if (indexedFilePaths?.has(relativePath)) {
          resolvedFiles.push(relativePath);
        }
        break;
      }

      case 'code-pattern': {
        // Symbol reference - find files containing this symbol
        if (codeIndex && codeIndex.has(ref.value)) {
          const locations = codeIndex.get(ref.value)!;
          for (const loc of locations) {
            resolvedFiles.push(loc.filePath);
          }
        }
        break;
      }

      case 'dependency':
        // Package reference - could map to local packages in monorepo
        // Skip for now - external packages
        break;
    }

    return resolvedFiles;
  }
}
