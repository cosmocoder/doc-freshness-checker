import fs from 'fs';
import path from 'path';
import { findSimilar } from '../utils/similarity.js';
import { isIllustrativePath, compilePatterns } from '../utils/illustrativePatterns.js';
import { isWithinRoot, resolveDocumentDir, resolveProjectRoot } from '../utils/pathSecurity.js';
import {
  createIllustrativeSkippedResult,
  getRuleSeverity,
  severityForIllustrative,
} from '../utils/validation.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

/**
 * Validates that file path references exist
 */
export class FileValidator {
  private directoryCache: Map<string, string[]>;
  private customPatterns: RegExp[];

  constructor() {
    this.directoryCache = new Map();
    this.customPatterns = [];
  }

  /**
   * Initialize custom illustrative patterns from config
   */
  private initCustomPatterns(config: DocFreshnessConfig): void {
    const configPatterns = config.rules?.['file-path']?.illustrativePatterns;
    if (configPatterns && configPatterns.length > 0) {
      this.customPatterns = compilePatterns(configPatterns);
    }
  }

  async validateBatch(
    references: Reference[],
    document: Document,
    config: DocFreshnessConfig
  ): Promise<ValidationResult[]> {
    this.initCustomPatterns(config);
    const results: ValidationResult[] = [];
    const rootDir = resolveProjectRoot(config.rootDir);
    const docDir = resolveDocumentDir(rootDir, document.path);
    const skipIllustrative = config.rules?.['file-path']?.skipIllustrative !== false;

    for (const ref of references) {
      // Check if this is an illustrative path
      const illustrative = ref.isIllustrative || isIllustrativePath(ref.value, this.customPatterns);

      if (illustrative && skipIllustrative) {
        results.push(createIllustrativeSkippedResult(ref, 'Skipped: illustrative/example path'));
        continue;
      }

      const result = await this.validateReference(ref, docDir, rootDir, config, illustrative);
      results.push(result);
    }

    return results;
  }

  private async validateReference(
    ref: Reference,
    docDir: string,
    rootDir: string,
    config: DocFreshnessConfig,
    isIllustrative: boolean = false
  ): Promise<ValidationResult> {
    // Handle both relative and absolute paths
    let resolvedPath: string;
    if (path.isAbsolute(ref.value)) {
      resolvedPath = path.resolve(ref.value);
    } else {
      resolvedPath = path.resolve(docDir, ref.value);
    }

    // Normalize path
    resolvedPath = path.normalize(resolvedPath);
    const baseSeverity = getRuleSeverity(config, 'file-path', 'error');

    // Prevent probing files outside the configured project root
    if (!isWithinRoot(resolvedPath, rootDir)) {
      return {
        reference: ref,
        valid: false,
        severity: severityForIllustrative(isIllustrative, baseSeverity),
        message: isIllustrative
          ? `Path escapes project root (illustrative): ${ref.value}`
          : `Path escapes project root: ${ref.value}`,
        suggestion: null,
        resolvedPath,
      };
    }

    try {
      await fs.promises.access(resolvedPath);
      return {
        reference: ref,
        valid: true,
        resolvedPath,
      };
    } catch {
      // File doesn't exist - try to find similar files
      const suggestion = await this.findSuggestion(ref.value, docDir, rootDir);

      // Reduce severity for illustrative paths that weren't skipped
      return {
        reference: ref,
        valid: false,
        severity: severityForIllustrative(isIllustrative, baseSeverity),
        message: isIllustrative
          ? `File not found (illustrative): ${ref.value}`
          : `File not found: ${ref.value}`,
        suggestion: suggestion ? `Did you mean: ${suggestion}?` : null,
        resolvedPath,
      };
    }
  }

  private async findSuggestion(
    refPath: string,
    docDir: string,
    rootDir: string
  ): Promise<string | null> {
    const dir = path.dirname(path.resolve(docDir, refPath));
    const fileName = path.basename(refPath);

    if (!isWithinRoot(dir, rootDir)) {
      return null;
    }

    // Check if directory exists
    try {
      await fs.promises.access(dir);
    } catch {
      return null;
    }

    // Get cached directory listing or create new one
    if (!this.directoryCache.has(dir)) {
      try {
        const files = await fs.promises.readdir(dir);
        this.directoryCache.set(dir, files);
      } catch {
        return null;
      }
    }

    const files = this.directoryCache.get(dir)!;
    return findSimilar(fileName, files);
  }
}
