import { BaseExtractor } from './baseExtractor.js';
import type { Document, DocFreshnessConfig, Reference } from '../../types.js';

interface PatternConfig {
  regex: RegExp;
  ecosystem: string;
}

/**
 * Extracts dependency references
 * Supports multiple package ecosystems
 */
export class DependencyExtractor extends BaseExtractor {
  private ecosystems: string[];

  constructor(config: Partial<DocFreshnessConfig> = {}) {
    super('dependency');
    this.ecosystems = config.ecosystems || ['npm', 'pypi', 'crates', 'go'];
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];

    const patterns: PatternConfig[] = [
      // npm scoped packages: @scope/package-name
      { regex: /`(@[a-z0-9\-]+\/[a-z0-9\-]+)`/g, ecosystem: 'npm' },
      // npm regular packages in backticks
      { regex: /`([a-z][a-z0-9\-]{2,})`/g, ecosystem: 'npm' },
      // Go packages
      { regex: /`(github\.com\/[a-zA-Z0-9\-_]+\/[a-zA-Z0-9\-_]+)`/g, ecosystem: 'go' },
    ];

    for (const { regex, ecosystem } of patterns) {
      if (!this.ecosystems.includes(ecosystem)) continue;

      let match: RegExpExecArray | null;
      const re = new RegExp(regex.source, regex.flags);
      while ((match = re.exec(document.content)) !== null) {
        const pkg = match[1];

        // Filter out common false positives
        if (this.isFalsePositive(pkg)) continue;

        references.push({
          type: this.type,
          value: pkg,
          ecosystem,
          lineNumber: this.findLineNumber(document.content, match.index),
          raw: match[0],
          sourceFile: document.path,
        });
      }
    }

    return references;
  }

  private isFalsePositive(pkg: string): boolean {
    // Skip very short names
    if (pkg.length < 3) return true;

    // Skip common words that appear in backticks
    const commonWords = [
      'true',
      'false',
      'null',
      'undefined',
      'string',
      'number',
      'boolean',
      'object',
      'array',
      'function',
      'class',
      'const',
      'let',
      'var',
      'return',
      'import',
      'export',
      'default',
      'async',
      'await',
      'error',
      'warning',
      'info',
      'debug',
      'console',
      'config',
      'options',
      'data',
      'value',
      'name',
      'type',
      'path',
      'file',
    ];

    if (commonWords.includes(pkg.toLowerCase())) return true;

    // Skip file extensions
    if (/\.[a-z]{2,4}$/.test(pkg)) return true;

    return false;
  }
}
