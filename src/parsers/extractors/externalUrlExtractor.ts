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
    const pattern = /https?:\/\/[^\s>\]"']+/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document.content)) !== null) {
      let url = match[0];
      url = this.cleanTrailingPunctuation(url);

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

  /**
   * Strip trailing punctuation while preserving balanced parentheses
   * (handles Wikipedia-style URLs like .../Example_(disambiguation))
   */
  private cleanTrailingPunctuation(url: string): string {
    while (url.length > 0) {
      const last = url[url.length - 1];

      if (last === ')') {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes > opens) {
          url = url.slice(0, -1);
          continue;
        }
        break;
      }

      if (/[.,;:!?>}\]'"]+$/.test(last)) {
        url = url.slice(0, -1);
        continue;
      }

      break;
    }
    return url;
  }
}
