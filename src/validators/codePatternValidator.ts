import { findSimilar } from '../utils/similarity.js';
import { SourceIndex, languageConfigs as sourceLanguageConfigs } from '../source/sourceIndex.js';
import type { SourceIndexSnapshot } from '../source/sourceIndex.js';
import type { IncrementalInput } from './incrementalInputs.js';
import type { DocFreshnessConfig, Document, Reference, SourceFileData, SymbolLocation, ValidationResult } from '../types.js';

import { isIllustrativeSymbol } from '../utils/illustrativePatterns.js';
import { createIllustrativeSkippedResult, getRuleSeverity, severityForIllustrative } from '../utils/validation.js';

const languageConfigs = sourceLanguageConfigs;

/**
 * Validates code patterns exist in source files
 */
export class CodePatternValidator {
  /** @internal */
  readonly incrementalCaptureScope = 'project';
  /** @internal */
  readonly incrementalInputsRequiredForGraph = true;
  private sourceIndex: Map<string, SymbolLocation[]> | null;
  private sourceFiles: Map<string, SourceFileData> | null; // Stores file content for vector search
  private incrementalInputs: IncrementalInput[] | null;

  constructor();
  constructor(private readonly index = new SourceIndex()) {
    this.sourceIndex = null;
    this.sourceFiles = null;
    this.incrementalInputs = null;
  }

  async buildSourceIndex(config: DocFreshnessConfig): Promise<void> {
    if (this.sourceIndex) {
      return;
    }

    try {
      this.useSnapshot(await this.index.load(config, 'pattern'));
    }
    catch (error) {
      this.useSnapshot(await this.index.load(config, 'pattern'));
      throw error;
    }
  }

  private useSnapshot(snapshot: SourceIndexSnapshot): void {
    this.sourceIndex = snapshot.symbols;
    this.sourceFiles = snapshot.patternFiles;
    this.incrementalInputs = snapshot.patternInputs;
  }

  /** @internal */
  async getIncrementalInputs(
    _references: Reference[],
    _document: Document,
    config: DocFreshnessConfig
  ): Promise<IncrementalInput[] | null> {
    await this.buildSourceIndex(config);
    return this.incrementalInputs;
  }

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    await this.buildSourceIndex(config);

    const results: ValidationResult[] = [];
    // For code-pattern, we skip illustrative symbols by default
    const skipIllustrative = true;

    for (const ref of references) {
      const name = ref.value;

      // Check if this is an illustrative symbol (marked by extractor or detected here)
      const illustrative = ref.isIllustrative || isIllustrativeSymbol(name);

      if (illustrative && skipIllustrative) {
        results.push(createIllustrativeSkippedResult(ref, 'Skipped: illustrative/example code pattern'));
        continue;
      }

      const found = this.sourceIndex!.get(name);

      if (found && found.length > 0) {
        results.push({
          reference: ref,
          valid: true,
          foundIn: found.map((f) => f.filePath),
        });
      }
      else {
        const similar = this.findSimilarSymbol(name);

        // Reduce severity for illustrative patterns that weren't skipped
        const baseSeverity = getRuleSeverity(config, 'code-pattern', 'warning');
        results.push({
          reference: ref,
          valid: false,
          severity: severityForIllustrative(illustrative, baseSeverity),
          message: illustrative
            ? `Code pattern not found (illustrative): ${ref.kind} ${name}`
            : `Code pattern not found: ${ref.kind} ${name}`,
          suggestion: similar ? `Did you mean: ${similar}?` : null,
        });
      }
    }

    return results;
  }

  private findSimilarSymbol(name: string): string | null {
    const symbols = Array.from(this.sourceIndex!.keys());
    return findSimilar(name, symbols);
  }

  /**
   * Get the source index for graph building
   */
  getSourceIndex(): Map<string, SymbolLocation[]> | null {
    return this.sourceIndex;
  }

  /**
   * Get source files with content for vector search
   */
  getSourceFiles(): Map<string, SourceFileData> | null {
    return this.sourceFiles;
  }
}

export { languageConfigs };
