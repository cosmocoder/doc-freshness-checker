import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { DocFreshnessConfig, Document, DocumentFormat } from '../types.js';
import type { BaseExtractor } from './extractors/baseExtractor.js';

/**
 * Parses documentation files and extracts references for validation
 */
export class DocumentParser {
  private config: DocFreshnessConfig;
  private extractors: BaseExtractor[];

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.extractors = [];
  }

  /**
   * Register reference extractors
   */
  registerExtractor(extractor: BaseExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Scan all documentation files matching the configured patterns
   */
  async scanDocuments(): Promise<Document[]> {
    const files = await glob(this.config.include || [], {
      ignore: this.config.exclude,
      cwd: this.config.rootDir,
      absolute: true,
    });

    const documents: Document[] = [];

    for (const filePath of files) {
      try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const relativePath = path.relative(this.config.rootDir || process.cwd(), filePath);
        const format = this.detectFormat(filePath);

        const doc: Document = {
          path: relativePath,
          absolutePath: filePath,
          content,
          format,
          lines: content.split('\n'),
          references: [],
        };

        // Extract all reference types
        for (const extractor of this.extractors) {
          if (extractor.supportsFormat(format)) {
            const refs = extractor.extract(doc);
            doc.references.push(...refs);
          }
        }

        documents.push(doc);
      } catch (error) {
        if (this.config.verbose) {
          console.warn(`Warning: Could not read ${filePath}: ${(error as Error).message}`);
        }
      }
    }

    return documents;
  }

  /**
   * Detect documentation format from file extension
   */
  detectFormat(filePath: string): DocumentFormat {
    const ext = path.extname(filePath).toLowerCase();
    const formatMap: Record<string, DocumentFormat> = {
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.rst': 'restructuredtext',
      '.adoc': 'asciidoc',
      '.asciidoc': 'asciidoc',
      '.txt': 'plaintext',
    };
    return formatMap[ext] || 'plaintext';
  }
}
