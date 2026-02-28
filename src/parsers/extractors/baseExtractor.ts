import type { Document, DocumentFormat, Reference } from '../../types.js';

/**
 * Base class for reference extractors
 */
export class BaseExtractor {
  type: string;
  supportedFormats: DocumentFormat[];

  constructor(type: string) {
    this.type = type;
    this.supportedFormats = ['markdown', 'restructuredtext', 'asciidoc', 'plaintext'];
  }

  supportsFormat(format: DocumentFormat): boolean {
    return this.supportedFormats.includes(format);
  }

  extract(_document: Document): Reference[] {
    throw new Error('extract() must be implemented');
  }

  /**
   * Helper to find line number for a match
   */
  findLineNumber(content: string, matchIndex: number): number {
    const upToMatch = content.substring(0, matchIndex);
    return upToMatch.split('\n').length;
  }

  /**
   * Helper to get the context around a match
   */
  getContext(lines: string[], lineNumber: number, contextLines: number = 2): string {
    const start = Math.max(0, lineNumber - contextLines - 1);
    const end = Math.min(lines.length, lineNumber + contextLines);
    return lines.slice(start, end).join('\n');
  }
}
