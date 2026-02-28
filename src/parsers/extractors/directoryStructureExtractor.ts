import { BaseExtractor } from './baseExtractor.js';
import { isIllustrativePath, compilePatterns } from '../../utils/illustrativePatterns.js';
import type { DocFreshnessConfig, Document, Reference } from '../../types.js';

type PatternMap = Record<string, RegExp>;

/**
 * Extracts directory structure references from code blocks
 * Pattern: ASCII tree structures in fenced code blocks
 *
 * This extractor understands tree hierarchy and builds full paths
 * from the tree structure.
 */
export class DirectoryStructureExtractor extends BaseExtractor {
  private customPatterns: RegExp[];

  constructor(config: Partial<DocFreshnessConfig> = {}) {
    super('directory-structure');

    // Build custom illustrative patterns from config
    const configPatterns = config.rules?.['directory-structure']?.illustrativePatterns;
    this.customPatterns = configPatterns ? compilePatterns(configPatterns) : [];
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];

    // Match fenced code blocks that look like directory trees
    const codeBlockPatterns: PatternMap = {
      markdown: /```(?:\w*)\n([\s\S]*?)```/g,
      restructuredtext: /\.\.\s+code-block::\s*\n\n((?:[ ]{3,}[^\n]*\n?)+)/g,
      asciidoc: /----\n([\s\S]*?)----/g,
    };

    const codeBlockPattern = codeBlockPatterns[document.format] || codeBlockPatterns.markdown;

    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = codeBlockPattern.exec(document.content)) !== null) {
      const blockContent = blockMatch[1];

      // Check if this looks like a directory tree
      const hasTreeChars =
        blockContent.includes('├') ||
        blockContent.includes('│') ||
        blockContent.includes('└') ||
        blockContent.includes('|--') ||
        blockContent.includes('`--');

      if (hasTreeChars) {
        const blockLine = this.findLineNumber(document.content, blockMatch.index);
        const paths = this.parseTreeStructure(blockContent);

        for (const fullPath of paths) {
          const illustrative = isIllustrativePath(fullPath, this.customPatterns);
          references.push({
            type: this.type,
            value: fullPath,
            lineNumber: blockLine,
            raw: fullPath,
            sourceFile: document.path,
            ...(illustrative && { isIllustrative: true }),
          });
        }
      }
    }

    return references;
  }

  /**
   * Parse a directory tree and reconstruct full paths
   */
  private parseTreeStructure(blockContent: string): string[] {
    const paths: string[] = [];
    const lines = blockContent.split('\n');

    // Stack to track current path at each depth level
    // Each entry: { depth: number, name: string }
    const pathStack: Array<{ depth: number; name: string }> = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      // Calculate depth based on leading characters
      const depth = this.calculateDepth(line);

      // Extract the file/folder name
      const name = this.extractName(line);

      if (!name) continue;

      // Skip common non-path entries
      if (this.shouldSkipEntry(name)) continue;

      // Pop stack entries that are at same or deeper level
      while (pathStack.length > 0 && pathStack[pathStack.length - 1].depth >= depth) {
        pathStack.pop();
      }

      // Push current entry
      pathStack.push({ depth, name });

      // Build full path from stack
      const fullPath = pathStack.map((entry) => entry.name).join('/');

      // Only add paths that look like real files/directories
      if (this.isValidPath(fullPath)) {
        paths.push(fullPath);
      }
    }

    return paths;
  }

  /**
   * Calculate the depth level of a tree line based on indentation and tree characters
   */
  private calculateDepth(line: string): number {
    // Count leading whitespace and tree characters
    let depth = 0;
    let i = 0;

    while (i < line.length) {
      const char = line[i];

      if (char === ' ' || char === '\t') {
        depth += char === '\t' ? 4 : 1;
        i++;
      } else if (char === '│' || char === '|') {
        depth += 4;
        i++;
      } else if (char === '├' || char === '└' || char === '+' || char === '`') {
        depth += 4;
        // Skip the rest of the tree characters (─, --, etc.)
        i++;
        while (i < line.length && (line[i] === '─' || line[i] === '-' || line[i] === ' ')) {
          i++;
        }
        break;
      } else {
        break;
      }
    }

    return Math.floor(depth / 4);
  }

  /**
   * Extract the file/folder name from a tree line
   */
  private extractName(line: string): string | null {
    // Remove tree characters and extract the name
    // Handles: ├── name, │   ├── name, └── name, |-- name, `-- name
    const cleaned = line
      .replace(/^[\s│|]*[├└+`][\s─\-]*/g, '') // Tree prefixes
      .replace(/^[\s│|]+/g, '') // Just vertical bars and spaces
      .trim();

    // Extract just the name (handle trailing / for directories)
    const match = cleaned.match(/^([a-zA-Z0-9_\-\.@]+)\/?$/);

    return match ? match[1] : null;
  }

  /**
   * Check if an entry should be skipped
   */
  private shouldSkipEntry(name: string): boolean {
    // Skip comments, ellipsis, separators, etc.
    if (name.startsWith('#')) return true;
    if (name === '...') return true;
    if (name === '-') return true;
    if (name === '---') return true;
    if (/^-+$/.test(name)) return true; // Any number of dashes
    if (name.length === 0) return true;
    // Skip entries that look like markdown/asciidoc separators
    if (/^[=\-_~]+$/.test(name)) return true;

    return false;
  }

  /**
   * Check if a path looks valid (not just a single generic name)
   */
  private isValidPath(fullPath: string): boolean {
    // Skip very short single-segment paths that are too generic
    if (!fullPath.includes('/') && fullPath.length < 3) return false;

    return true;
  }
}
