import fs from 'fs';
import path from 'path';
import { glob } from 'node:fs/promises';
import type { DocFreshnessConfig, Document, DocumentFormat, Extractor } from '../types.js';

/**
 * Parses documentation files and extracts references for validation
 */
export class DocumentParser {
  private config: DocFreshnessConfig;
  private extractors: Extractor[];

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.extractors = [];
  }

  /**
   * Register reference extractors
   */
  registerExtractor(extractor: Extractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Scan all documentation files matching the configured patterns
   */
  async scanDocuments(): Promise<Document[]> {
    const rootDir = this.config.rootDir || process.cwd();
    // @types/node 24 omits followSymlinks, so keep this object inferred until its declarations catch up.
    const globOptions = {
      exclude: this.config.exclude,
      followSymlinks: true,
      cwd: rootDir,
    };
    const files = glob(this.config.include || [], globOptions);

    const documents: Document[] = [];

    for await (const file of files) {
      const filePath = path.resolve(rootDir, file);
      let content: string;
      try {
        content = await fs.promises.readFile(filePath, 'utf-8');
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        try {
          await fs.promises.lstat(filePath);
        }
        catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
            continue;
          }
          throw error;
        }
        throw error;
      }
      const relativePath = path.relative(rootDir, filePath);
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
