import { BaseExtractor } from './baseExtractor.js';
import type { Document, Reference } from '../../types.js';

/**
 * Extracts external URL references
 */
export class ExternalUrlExtractor extends BaseExtractor {
  constructor() {
    super('external-url');
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];
    const pattern = /https?:\/\/[^\s\)>\]"']+/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document.content)) !== null) {
      // Clean up trailing punctuation
      let url = match[0];
      while (url.length > 0 && /[.,;:!?)>}\]'"]+$/.test(url)) {
        url = url.slice(0, -1);
      }

      if (url.length > 0) {
        references.push({
          type: this.type,
          value: url,
          lineNumber: this.findLineNumber(document.content, match.index),
          raw: match[0],
          sourceFile: document.path,
        });
      }
    }

    return references;
  }
}
