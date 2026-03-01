/**
 * Centralized patterns for detecting illustrative/placeholder content in documentation
 *
 * These patterns identify paths, filenames, and code symbols that are commonly used
 * as examples in tutorials and documentation but don't represent actual files/code.
 */

/**
 * Patterns for detecting illustrative file/directory paths
 * Used by: FilePathExtractor, DirectoryStructureExtractor, FileValidator, DirectoryValidator
 */
export const ILLUSTRATIVE_PATH_PATTERNS: RegExp[] = [
  // Generic placeholder prefixes (case-insensitive)
  /^(?:Your|My|Example|Sample|Demo|Test|Foo|Bar|Baz|Dummy|Mock|Fake|Stub)/i,
  // Common tutorial placeholders
  /^(?:first|second|third|another|some|new)\./i,
  // Very short generic names without extensions
  /^(?:foo|bar|baz|qux|quux)$/i,
  // Paths containing angle brackets or curly braces (template syntax)
  /<[^>]+>/,
  /\{[^}]+\}/,
  // Paths with obvious placeholder segments
  /\/(?:your|my|example|sample)-/i,
  /\/\[.*\]\//,
];

/**
 * Patterns for detecting illustrative code symbol names
 * Used by: CodePatternExtractor, CodePatternValidator
 */
export const ILLUSTRATIVE_SYMBOL_PATTERNS: RegExp[] = [
  // Generic placeholder prefixes followed by PascalCase
  /^(?:Your|My|Example|Sample|Demo|Test|Foo|Bar|Baz|Dummy|Mock|Fake|Stub)[A-Z]/i,
  // HTTP methods used as function names in REST tutorials
  /^(?:POST|GET|PUT|DELETE|PATCH)$/,
  // Very short names (1-2 chars) are likely false positives from word parsing
  /^[a-z]{1,2}$/,
  // Common tutorial component/function names
  /^(?:Chat|App|Button|Card|Modal|Form|Input|List|Item|Header|Footer|Sidebar|Nav|Menu|Page|Home|About|Contact|Login|Signup|Profile|Dashboard|Settings)$/,
];

/**
 * Check if a path looks like an illustrative/placeholder path
 */
export function isIllustrativePath(itemPath: string, customPatterns: RegExp[] = []): boolean {
  const patterns = [...ILLUSTRATIVE_PATH_PATTERNS, ...customPatterns];
  const segments = itemPath.split('/');
  const filename = segments[segments.length - 1];

  // Check filename against patterns
  for (const pattern of patterns) {
    if (pattern.test(filename)) {
      return true;
    }
  }

  // Check if any segment in the path looks illustrative
  for (const segment of segments.slice(0, -1)) {
    for (const pattern of patterns) {
      if (pattern.test(segment)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a code symbol name looks like an illustrative/placeholder name
 */
export function isIllustrativeSymbol(name: string, customPatterns: RegExp[] = []): boolean {
  const patterns = [...ILLUSTRATIVE_SYMBOL_PATTERNS, ...customPatterns];

  for (const pattern of patterns) {
    if (pattern.test(name)) {
      return true;
    }
  }

  return false;
}

/**
 * Convert string patterns from config to RegExp objects
 */
export function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((p) => new RegExp(p, 'i'));
}
