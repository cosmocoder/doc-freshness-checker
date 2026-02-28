import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { findSimilar } from '../utils/similarity.js';
import type {
  DocFreshnessConfig,
  Document,
  LanguageConfig,
  Reference,
  SourceFileData,
  SymbolLocation,
  ValidationResult,
} from '../types.js';

/**
 * Language-specific source file patterns and code symbol extractors
 */
const languageConfigs: Record<string, LanguageConfig> = {
  javascript: {
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\bexport\s+(?:async\s+)?function\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
      { regex: /\bexport\s+const\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'const' },
      { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  typescript: {
    extensions: ['ts', 'tsx'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s*=/g, kind: 'type' },
      { regex: /\bexport\s+(?:async\s+)?function\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
      { regex: /\bexport\s+const\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'const' },
      { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  python: {
    extensions: ['py'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\bdef\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
    ],
  },
  go: {
    extensions: ['go'],
    patterns: [
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+struct/g, kind: 'struct' },
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+interface/g, kind: 'interface' },
      { regex: /\bfunc\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  rust: {
    extensions: ['rs'],
    patterns: [
      { regex: /\bstruct\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'struct' },
      { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
      { regex: /\btrait\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'trait' },
      { regex: /\bpub\s+fn\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
      { regex: /\bfn\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
    ],
  },
  java: {
    extensions: ['java'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
      { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
    ],
  },
};

import { isIllustrativeSymbol } from '../utils/illustrativePatterns.js';

/**
 * Validates code patterns exist in source files
 */
export class CodePatternValidator {
  private sourceIndex: Map<string, SymbolLocation[]> | null;
  private sourceFiles: Map<string, SourceFileData> | null; // Stores file content for vector search

  constructor() {
    this.sourceIndex = null;
    this.sourceFiles = null;
  }

  async buildSourceIndex(config: DocFreshnessConfig): Promise<void> {
    if (this.sourceIndex) return;

    this.sourceIndex = new Map();
    this.sourceFiles = new Map();

    // Use configured source patterns or detect automatically
    const sourcePatterns = config.sourcePatterns || this.detectSourcePatterns();

    for (const pattern of sourcePatterns) {
      try {
        const files = await glob(pattern, {
          cwd: config.rootDir,
          absolute: true,
          ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/node_modules/**', '**/vendor/**'],
        });

        for (const file of files) {
          try {
            const content = await fs.promises.readFile(file, 'utf-8');
            const relativePath = path.relative(config.rootDir || process.cwd(), file);
            const lang = this.detectLanguage(file);

            this.indexContent(content, relativePath, lang);

            // Store file content for vector search
            this.sourceFiles.set(relativePath, { content, language: lang });
          } catch {
            // Skip unreadable files
          }
        }
      } catch {
        // Skip invalid patterns
      }
    }
  }

  private detectSourcePatterns(): string[] {
    // Auto-detect based on what files exist
    const patterns: string[] = [];

    for (const conf of Object.values(languageConfigs)) {
      for (const ext of conf.extensions) {
        patterns.push(`**/*.${ext}`);
      }
    }

    return patterns;
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).slice(1).toLowerCase();

    for (const [lang, conf] of Object.entries(languageConfigs)) {
      if (conf.extensions.includes(ext)) {
        return lang;
      }
    }

    return 'javascript';
  }

  private indexContent(content: string, filePath: string, language: string): void {
    const langConfig = languageConfigs[language];
    if (!langConfig) return;

    for (const { regex, kind } of langConfig.patterns) {
      let match: RegExpExecArray | null;
      // Clone regex to avoid state issues
      const re = new RegExp(regex.source, regex.flags);
      while ((match = re.exec(content)) !== null) {
        const name = match[1];
        if (!this.sourceIndex!.has(name)) {
          this.sourceIndex!.set(name, []);
        }
        this.sourceIndex!.get(name)!.push({ filePath, kind, language });
      }
    }
  }

  async validateBatch(
    references: Reference[],
    _document: Document,
    config: DocFreshnessConfig
  ): Promise<ValidationResult[]> {
    await this.buildSourceIndex(config);

    const results: ValidationResult[] = [];
    // For code-pattern, we skip illustrative symbols by default
    const skipIllustrative = true;

    for (const ref of references) {
      const name = ref.value;

      // Check if this is an illustrative symbol (marked by extractor or detected here)
      const illustrative = ref.isIllustrative || isIllustrativeSymbol(name);

      if (illustrative && skipIllustrative) {
        // Skip validation entirely for illustrative symbols
        results.push({
          reference: ref,
          valid: true,
          skipped: true,
          message: 'Skipped: illustrative/example code pattern',
        });
        continue;
      }

      const found = this.sourceIndex!.get(name);

      if (found && found.length > 0) {
        results.push({
          reference: ref,
          valid: true,
          foundIn: found.map((f) => f.filePath),
        });
      } else {
        const similar = this.findSimilarSymbol(name);

        // Reduce severity for illustrative patterns that weren't skipped
        const baseSeverity = config.rules?.['code-pattern']?.severity || 'warning';
        results.push({
          reference: ref,
          valid: false,
          severity: illustrative ? 'info' : baseSeverity,
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
