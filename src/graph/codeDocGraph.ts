import type { GraphReference, Reference, SerializedGraph } from '../types.js';

/**
 * Represents the relationship graph between docs and code
 * Uses adjacency list representation for efficient traversal
 */
export class CodeDocGraph {
  // Map: doc path -> Set of code file paths it references
  docToCode: Map<string, Set<string>>;

  // Map: code file path -> Set of doc paths that reference it
  codeToDoc: Map<string, Set<string>>;

  // Map: code file path -> Set of symbols defined in it
  codeSymbols: Map<string, Set<string>>;

  // Map: doc path -> references with metadata
  docReferences: Map<string, GraphReference[]>;

  // Metadata
  buildTimestamp: number | null;
  gitCommit: string | null;
  configHash: string | null;

  constructor() {
    this.docToCode = new Map();
    this.codeToDoc = new Map();
    this.codeSymbols = new Map();
    this.docReferences = new Map();
    this.buildTimestamp = null;
    this.gitCommit = null;
    this.configHash = null;
  }

  /**
   * Add a reference from a doc to a code file
   */
  addReference(docPath: string, codeFilePath: string, reference: Reference): void {
    // Doc -> Code edge
    if (!this.docToCode.has(docPath)) {
      this.docToCode.set(docPath, new Set());
    }
    this.docToCode.get(docPath)!.add(codeFilePath);

    // Code -> Doc edge (reverse index)
    if (!this.codeToDoc.has(codeFilePath)) {
      this.codeToDoc.set(codeFilePath, new Set());
    }
    this.codeToDoc.get(codeFilePath)!.add(docPath);

    // Store reference metadata
    if (!this.docReferences.has(docPath)) {
      this.docReferences.set(docPath, []);
    }
    this.docReferences.get(docPath)!.push({
      ...reference,
      resolvedCodeFile: codeFilePath,
    });
  }

  /**
   * Get all docs that reference a specific code file
   */
  getDocsReferencingCode(codeFilePath: string): Set<string> {
    return this.codeToDoc.get(codeFilePath) || new Set();
  }

  /**
   * Get all code files referenced by a doc
   */
  getCodeReferencedByDoc(docPath: string): Set<string> {
    return this.docToCode.get(docPath) || new Set();
  }

  /**
   * Get all document paths in the graph
   */
  getAllDocs(): string[] {
    return Array.from(this.docToCode.keys());
  }

  /**
   * Get all code file paths in the graph
   */
  getAllCodeFiles(): string[] {
    return Array.from(this.codeToDoc.keys());
  }

  /**
   * Serialize graph for caching
   */
  serialize(): SerializedGraph {
    return {
      docToCode: Object.fromEntries([...this.docToCode].map(([k, v]) => [k, [...v]])),
      codeToDoc: Object.fromEntries([...this.codeToDoc].map(([k, v]) => [k, [...v]])),
      codeSymbols: Object.fromEntries([...this.codeSymbols].map(([k, v]) => [k, [...v]])),
      docReferences: Object.fromEntries(this.docReferences),
      buildTimestamp: this.buildTimestamp,
      gitCommit: this.gitCommit,
      configHash: this.configHash,
    };
  }

  /**
   * Deserialize from cache
   */
  static deserialize(data: SerializedGraph): CodeDocGraph {
    const graph = new CodeDocGraph();
    graph.docToCode = new Map(Object.entries(data.docToCode || {}).map(([k, v]) => [k, new Set(v)]));
    graph.codeToDoc = new Map(Object.entries(data.codeToDoc || {}).map(([k, v]) => [k, new Set(v)]));
    graph.codeSymbols = new Map(
      Object.entries(data.codeSymbols || {}).map(([k, v]) => [k, new Set(v)])
    );
    graph.docReferences = new Map(Object.entries(data.docReferences || {}));
    graph.buildTimestamp = data.buildTimestamp;
    graph.gitCommit = data.gitCommit;
    graph.configHash = data.configHash;
    return graph;
  }
}
