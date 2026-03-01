import fs from 'fs';
import path from 'path';
import { isIllustrativePath, compilePatterns } from '../utils/illustrativePatterns.js';
import { similarityRatio } from '../utils/similarity.js';
import { isWithinRoot, resolveDocumentDir, resolveProjectRoot } from '../utils/pathSecurity.js';
import { createIllustrativeSkippedResult, getRuleSeverity, severityForIllustrative } from '../utils/validation.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

interface CacheEntry {
  found: boolean;
  foundAt?: string;
  suggestion?: string | null;
}

/**
 * Validates that directory structure references exist
 *
 * Simple approach: The extractor builds full paths from the tree structure,
 * so we just check if each path exists from the project root.
 */
export class DirectoryValidator {
  private pathCache: Map<string, CacheEntry>;
  private customPatterns: RegExp[];

  constructor() {
    this.pathCache = new Map();
    this.customPatterns = [];
  }

  /**
   * Initialize custom illustrative patterns from config
   */
  private initCustomPatterns(config: DocFreshnessConfig): void {
    const configPatterns = config.rules?.['directory-structure']?.illustrativePatterns;
    this.customPatterns = configPatterns && configPatterns.length > 0 ? compilePatterns(configPatterns) : [];
  }

  async validateBatch(references: Reference[], document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    this.initCustomPatterns(config);
    const results: ValidationResult[] = [];
    const skipIllustrative = config.rules?.['directory-structure']?.skipIllustrative !== false;

    for (const ref of references) {
      // Check if this is an illustrative path (marked by extractor or detected here)
      const illustrative = ref.isIllustrative || isIllustrativePath(ref.value, this.customPatterns);

      if (illustrative && skipIllustrative) {
        results.push(createIllustrativeSkippedResult(ref, 'Skipped: illustrative/example path'));
        continue;
      }

      const result = await this.validateReference(ref, document, config, illustrative);
      results.push(result);
    }

    return results;
  }

  private async validateReference(
    ref: Reference,
    document: Document,
    config: DocFreshnessConfig,
    isIllustrative: boolean = false
  ): Promise<ValidationResult> {
    const itemPath = ref.value;
    const rootDir = resolveProjectRoot(config.rootDir);
    const baseSeverity = getRuleSeverity(config, 'directory-structure', 'warning');

    const cacheKey = `${rootDir}::${document.path}::${itemPath}`;

    // Check cache first
    if (this.pathCache.has(cacheKey)) {
      const cached = this.pathCache.get(cacheKey)!;
      return {
        reference: ref,
        valid: cached.found,
        foundAt: cached.foundAt,
        severity: cached.found ? undefined : baseSeverity,
        message: cached.found ? undefined : `Directory/file not found: ${itemPath}`,
        suggestion: cached.suggestion,
      };
    }

    // Strategy 1: Check if the path exists from project root
    // This handles full paths like "frontend/src/apps/domains"
    const fullPath = path.resolve(rootDir, itemPath);
    if (isWithinRoot(fullPath, rootDir) && (await this.pathExists(fullPath))) {
      this.pathCache.set(cacheKey, { found: true, foundAt: itemPath });
      return {
        reference: ref,
        valid: true,
        foundAt: itemPath,
      };
    }

    // Strategy 2: The path might be relative to the document's location
    // e.g., a doc in "docs/" might reference "../src/..."
    const docDir = resolveDocumentDir(rootDir, document.path);
    const relativeToDoc = path.resolve(docDir, itemPath);
    if (isWithinRoot(relativeToDoc, rootDir) && (await this.pathExists(relativeToDoc))) {
      const foundAt = path.relative(rootDir, relativeToDoc);
      this.pathCache.set(cacheKey, { found: true, foundAt });
      return {
        reference: ref,
        valid: true,
        foundAt,
      };
    }

    // If both candidate paths resolve outside root, fail early with explicit message.
    if (!isWithinRoot(fullPath, rootDir) && !isWithinRoot(relativeToDoc, rootDir)) {
      return {
        reference: ref,
        valid: false,
        severity: severityForIllustrative(isIllustrative, baseSeverity),
        message: isIllustrative ? `Path escapes project root (illustrative): ${itemPath}` : `Path escapes project root: ${itemPath}`,
        suggestion: null,
      };
    }

    // Strategy 3: Try to find a similar path (for suggestions)
    const suggestion = await this.findSimilarPath(itemPath, config);

    // Not found - reduce severity for illustrative paths that weren't skipped
    this.pathCache.set(cacheKey, { found: false, suggestion });
    return {
      reference: ref,
      valid: false,
      severity: severityForIllustrative(isIllustrative, baseSeverity),
      message: isIllustrative ? `Directory/file not found (illustrative): ${itemPath}` : `Directory/file not found: ${itemPath}`,
      suggestion,
    };
  }

  private async pathExists(fullPath: string): Promise<boolean> {
    try {
      await fs.promises.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Try to find a similar path for suggestions
   * Handles common issues like singular/plural mismatches
   */
  private async findSimilarPath(itemPath: string, config: DocFreshnessConfig): Promise<string | null> {
    const rootDir = resolveProjectRoot(config.rootDir);
    const segments = itemPath.split('/');
    const lastSegment = segments[segments.length - 1];

    // Get the parent directory path
    const parentPath = segments.slice(0, -1).join('/');
    const parentFullPath = path.resolve(rootDir, parentPath);

    if (!isWithinRoot(parentFullPath, rootDir)) {
      return null;
    }

    // Check if parent exists
    if (!(await this.pathExists(parentFullPath))) {
      return null;
    }

    // List files in parent directory
    try {
      const entries = await fs.promises.readdir(parentFullPath);
      const lastLower = lastSegment.toLowerCase();

      let bestMatch: string | null = null;
      let bestScore = 0;

      for (const entry of entries) {
        const entryLower = entry.toLowerCase();

        // Exact case-insensitive match
        if (entryLower === lastLower && entry !== lastSegment) {
          return `${parentPath}/${entry}`;
        }

        // Calculate similarity score
        const score = this.calculateSimilarity(lastLower, entryLower);
        if (score > bestScore && score >= 0.7) {
          bestScore = score;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        return `${parentPath}/${bestMatch}`;
      }
    } catch {
      // Parent directory read failed
    }

    return null;
  }

  /**
   * Calculate similarity between two strings (0-1)
   * Uses a combination of techniques for better matching
   */
  private calculateSimilarity(a: string, b: string): number {
    const aBase = a.replace(/\.[^.]+$/, '');
    const bBase = b.replace(/\.[^.]+$/, '');

    if (aBase === bBase) return 1;

    // Check for singular/plural by removing common plural suffixes
    const aSingular = this.toSingular(aBase);
    const bSingular = this.toSingular(bBase);
    if (aSingular === bSingular) return 0.95;
    if (aSingular === bBase || aBase === bSingular) return 0.95;

    return similarityRatio(aBase, bBase);
  }

  private toSingular(word: string): string {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    }
    if (word.endsWith('es') && !word.endsWith('ses') && !word.endsWith('xes')) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }
}
