import type { GraphReference, Reference } from '../types.js';

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

  constructor() {
    this.docToCode = new Map();
    this.codeToDoc = new Map();
    this.codeSymbols = new Map();
    this.docReferences = new Map();
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
}
