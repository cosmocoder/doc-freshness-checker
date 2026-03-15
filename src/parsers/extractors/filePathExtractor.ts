import { BaseExtractor } from './baseExtractor.js';
import type { Document, Reference } from '../../types.js';

type PatternMap = Record<string, RegExp>;

/**
 * Line number suffix patterns that should be stripped from file paths
 * Supports: :N, :N-M, :N-, #LN, #LN-LM (GitHub-style)
 */
const LINE_NUMBER_PATTERNS = [
  /:[0-9]+(?:-[0-9]*)?$/, // :1, :26-38, :10-
  /#L[0-9]+(?:-L?[0-9]+)?$/, // #L123, #L123-L456, #L123-456
];

/**
 * Extracts file/path references from documentation links
 * Supports: Markdown, RST, AsciiDoc link formats
 */
export class FilePathExtractor extends BaseExtractor {
  constructor() {
    super('file-path');
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];

    // Format-specific patterns
    const patterns: PatternMap = {
      markdown: /\[([^\][]*)\]\(([^()\s[\]]+)\)/g,
      restructuredtext: /`([^`]+)[ \t]+<([^<>]+)>`_/g,
      asciidoc: /link:([^[\s]+)\[([^\][]*)\]/g,
    };

    const pattern = patterns[document.format] || patterns.markdown;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document.content)) !== null) {
      const refPath = document.format === 'asciidoc' ? match[1] : match[2];

      // Skip URLs
      if (refPath.startsWith('http://') || refPath.startsWith('https://')) {
        continue;
      }

      // Skip anchors
      if (refPath.startsWith('#')) {
        continue;
      }

      // For markdown, only accept relative paths or paths with file extensions
      if (document.format !== 'asciidoc' && document.format !== 'restructuredtext') {
        const isRelative = refPath.startsWith('../') || refPath.startsWith('.\\') || refPath.startsWith('./');
        const hasExtension = /^[a-zA-Z0-9_\-/\\]+\.[a-zA-Z]{1,10}$/.test(refPath);
        if (!isRelative && !hasExtension) {
          continue;
        }
      }

      // Extract and strip line number suffixes
      const { path: cleanPath, lineRef } = this.extractLineReference(refPath);

      references.push({
        type: this.type,
        value: cleanPath,
        linkText: document.format === 'asciidoc' ? match[2] : match[1],
        lineNumber: this.findLineNumber(document.content, match.index),
        raw: match[0],
        sourceFile: document.path,
        // Store the line reference metadata if present
        ...(lineRef && { lineRef }),
      });
    }

    return references;
  }

  /**
   * Extract line number reference from a file path and return the clean path
   * Examples:
   *   "../src/file.ts:1" -> { path: "../src/file.ts", lineRef: "1" }
   *   "../src/file.ts:26-38" -> { path: "../src/file.ts", lineRef: "26-38" }
   *   "../src/file.ts#L123" -> { path: "../src/file.ts", lineRef: "L123" }
   */
  private extractLineReference(refPath: string): { path: string; lineRef?: string } {
    for (const pattern of LINE_NUMBER_PATTERNS) {
      const match = refPath.match(pattern);
      if (match) {
        const lineRef = match[0].replace(/^[:#]L?/, ''); // Remove leading :, #, or #L
        const cleanPath = refPath.replace(pattern, '');
        return { path: cleanPath, lineRef };
      }
    }
    return { path: refPath };
  }
}
