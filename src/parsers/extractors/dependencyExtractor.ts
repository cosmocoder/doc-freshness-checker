import { BaseExtractor } from './baseExtractor.js';
import type { Document, DocFreshnessConfig, Reference } from '../../types.js';

interface PatternConfig {
  regex: RegExp;
  ecosystem: string;
  requiresPythonSeparator?: boolean;
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
    const plainPackageEcosystem = this.ecosystems.includes('npm') ? 'npm' : 'pypi';
    const pypiOnly = this.ecosystems.length === 1 && this.ecosystems[0] === 'pypi';

    const patterns: PatternConfig[] = [
      // npm scoped packages: @scope/package-name
      { regex: /`(@[a-z0-9-]+\/[a-z0-9-]+)`/g, ecosystem: 'npm' },
      // PyPI names distinguished by underscores or dots
      { regex: /`([a-z][a-z0-9._-]{2,})`/g, ecosystem: 'pypi', requiresPythonSeparator: true },
      // Plain/hyphen names are npm by default and PyPI when npm is disabled
      { regex: /`([a-z][a-z0-9-]{2,})`/g, ecosystem: plainPackageEcosystem },
      // Go packages
      { regex: /`(github\.com\/[a-zA-Z0-9\-_]+\/[a-zA-Z0-9\-_]+)`/g, ecosystem: 'go' },
    ];

    for (const { regex, ecosystem, requiresPythonSeparator } of patterns) {
      if (!this.ecosystems.includes(ecosystem)) {
        continue;
      }

      let match: RegExpExecArray | null;
      const re = new RegExp(regex.source, regex.flags);
      while ((match = re.exec(document.content)) !== null) {
        const pkg = match[1];

        if (requiresPythonSeparator && !/[._]/.test(pkg)) {
          continue;
        }

        // Filter out common false positives
        if (this.isFalsePositive(pkg, ecosystem === 'pypi' && pypiOnly)) {
          continue;
        }

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

  private isFalsePositive(pkg: string, allowDottedPyPI: boolean): boolean {
    // Skip very short names
    if (pkg.length < 3) {
      return true;
    }

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

    if (commonWords.includes(pkg.toLowerCase())) {
      return true;
    }

    // Dotted names are ambiguous with file names unless PyPI is the only enabled ecosystem.
    if (!allowDottedPyPI && /\.[a-z]{2,4}$/i.test(pkg)) {
      return true;
    }

    return false;
  }
}
