import { BaseExtractor } from './baseExtractor.js';
import type { Document, Reference } from '../../types.js';

const LANGUAGE_ALIASES: Record<string, string[]> = {
  javascript: ['javascript', 'js', 'jsx', 'mjs', 'cjs'],
  typescript: ['typescript', 'ts', 'tsx'],
  python: ['python', 'py'],
  go: ['go', 'golang'],
};

/**
 * Identifiers to skip when extracting function calls.
 * Includes language keywords, common built-ins, and test framework globals.
 */
const SKIP_IDENTIFIERS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'new',
  'typeof',
  'instanceof',
  'throw',
  'delete',
  'void',
  'yield',
  'await',
  'async',
  'import',
  'export',
  'from',
  'class',
  'const',
  'let',
  'var',
  'function',
  'else',
  'try',
  'finally',
  'do',
  'in',
  'of',
  'with',
  'break',
  'continue',
  'case',
  'default',
  'super',
  'this',
  'console',
  'require',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'Promise',
  'Array',
  'Object',
  'String',
  'Number',
  'Boolean',
  'Math',
  'JSON',
  'Date',
  'RegExp',
  'Error',
  'Map',
  'Set',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURI',
  'decodeURI',
  'fetch',
  'Response',
  'Request',
  'URL',
  'URLSearchParams',
  'Buffer',
  'print',
  'range',
  'len',
  'str',
  'int',
  'float',
  'list',
  'dict',
  'set',
  'tuple',
  'bool',
  'type',
  'map',
  'filter',
  'zip',
  'enumerate',
  'sorted',
  'reversed',
  'any',
  'all',
  'min',
  'max',
  'sum',
  'abs',
  'isinstance',
  'issubclass',
  'hasattr',
  'getattr',
  'setattr',
  'delattr',
  'open',
  'input',
  'round',
  'format',
  'repr',
  'hash',
  'id',
  'dir',
  'property',
  'staticmethod',
  'classmethod',
  'def',
  'lambda',
  'assert',
  'raise',
  'pass',
  'except',
  'elif',
  'not',
  'and',
  'or',
  'is',
  'None',
  'True',
  'False',
  'self',
  'cls',
  'describe',
  'it',
  'test',
  'expect',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'jest',
  'vi',
  'mock',
  'spy',
  'func',
  'make',
  'append',
  'copy',
  'close',
  'panic',
  'recover',
  'println',
  'Println',
  'Printf',
  'Sprintf',
  'Errorf',
]);

/**
 * Extracts code snippet references from fenced code blocks in documentation.
 *
 * Produces three kinds of references:
 * - 'import': import/require statements with relative module paths
 * - 'function-call': standalone function calls with arity
 * - 'config-keys': typed object literals with identifiable key sets
 *
 * Uses `linkText` to carry secondary data:
 *   import → comma-separated imported symbol names
 *   function-call → arity as a string
 *   config-keys → the type/interface name
 */
export class CodeSnippetExtractor extends BaseExtractor {
  constructor() {
    super('code-snippet');
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];
    const codeBlockPattern = /```(\w+)\n([\s\S]*?)```/g;

    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = codeBlockPattern.exec(document.content)) !== null) {
      const langTag = blockMatch[1].toLowerCase();
      const lang = this.normalizeLanguage(langTag);
      if (!lang) continue;

      const blockContent = blockMatch[2];
      const blockLine = this.findLineNumber(document.content, blockMatch.index);

      references.push(...this.extractImports(blockContent, lang, blockLine, document));
      references.push(...this.extractFunctionCalls(blockContent, lang, blockLine, document));
      references.push(...this.extractConfigKeys(blockContent, lang, blockLine, document));
    }

    return references;
  }

  private normalizeLanguage(tag: string): string | null {
    for (const [lang, aliases] of Object.entries(LANGUAGE_ALIASES)) {
      if (aliases.includes(tag)) return lang;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Import extraction
  // ---------------------------------------------------------------------------

  private extractImports(content: string, lang: string, blockLine: number, doc: Document): Reference[] {
    const refs: Reference[] = [];

    if (lang === 'javascript' || lang === 'typescript') {
      this.extractJsImports(content, lang, blockLine, doc, refs);
    } else if (lang === 'python') {
      this.extractPythonImports(content, lang, blockLine, doc, refs);
    } else if (lang === 'go') {
      this.extractGoImports(content, lang, blockLine, doc, refs);
    }

    return refs;
  }

  private extractJsImports(content: string, lang: string, blockLine: number, doc: Document, refs: Reference[]): void {
    // Handles default, named, namespace, and default+named imports.
    const importPattern = /^[ \t]*import[ \t]+(?:type[ \t]+)?((?:[^ \t'"\n]+[ \t]+)*[^ \t'"\n]+)[ \t]+from[ \t]+['"]([^'"]+)['"]/gm;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(content)) !== null) {
      const modulePath = match[2];
      if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) continue;

      const { importedSymbols, importSpecifiers } = this.parseJsImportSpecifiers(match[1]);

      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;

      refs.push({
        type: this.type,
        kind: 'import',
        value: modulePath,
        lineNumber: blockLine + lineInBlock,
        raw: match[0],
        sourceFile: doc.path,
        language: lang,
        linkText: importedSymbols.join(','),
        importSpecifiers,
      });
    }

    // require()
    const requirePattern = /(?:const|let|var)[ \t]+(?:\{([^{}]*)\}|(\w+))[ \t]*=[ \t]*require\([ \t]*['"]([^'"]+)['"][ \t]*\)/g;
    while ((match = requirePattern.exec(content)) !== null) {
      const modulePath = match[3];
      if (!modulePath.startsWith('.') && !modulePath.startsWith('/')) continue;

      const symbols = match[1]
        ? match[1]
            .split(',')
            .map((s) => s.trim().split(':')[0].trim())
            .filter(Boolean)
        : match[2]
          ? []
          : [];
      const importSpecifiers = match[1] ? symbols.map((symbol) => `named:${symbol}`) : ['module:*'];

      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;

      refs.push({
        type: this.type,
        kind: 'import',
        value: modulePath,
        lineNumber: blockLine + lineInBlock,
        raw: match[0],
        sourceFile: doc.path,
        language: lang,
        linkText: symbols.join(','),
        importSpecifiers,
      });
    }
  }

  private extractPythonImports(content: string, lang: string, blockLine: number, doc: Document, refs: Reference[]): void {
    const fromImportPattern = /from\s+([\w.]+)\s+import\s+(.+)/g;
    let match: RegExpExecArray | null;
    while ((match = fromImportPattern.exec(content)) !== null) {
      const modulePath = match[1];
      const symbols = match[2]
        .split(',')
        .map((s) => s.trim().split(' as ')[0].trim())
        .filter(Boolean);

      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;

      refs.push({
        type: this.type,
        kind: 'import',
        value: modulePath,
        lineNumber: blockLine + lineInBlock,
        raw: match[0],
        sourceFile: doc.path,
        language: lang,
        linkText: symbols.join(','),
        importSpecifiers: symbols.map((symbol) => `named:${symbol}`),
      });
    }
  }

  private extractGoImports(content: string, lang: string, blockLine: number, doc: Document, refs: Reference[]): void {
    // Single import
    const singlePattern = /import\s+"([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = singlePattern.exec(content)) !== null) {
      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;
      refs.push({
        type: this.type,
        kind: 'import',
        value: match[1],
        lineNumber: blockLine + lineInBlock,
        raw: match[0],
        sourceFile: doc.path,
        language: lang,
      });
    }

    // Grouped import block
    const groupPattern = /import[ \t]*\(([^()]*)\)/g;
    while ((match = groupPattern.exec(content)) !== null) {
      const body = match[1];
      const pathPattern = /"([^"]+)"/g;
      let pathMatch: RegExpExecArray | null;
      while ((pathMatch = pathPattern.exec(body)) !== null) {
        const lineInBlock = content.substring(0, match.index).split('\n').length - 1;
        refs.push({
          type: this.type,
          kind: 'import',
          value: pathMatch[1],
          lineNumber: blockLine + lineInBlock,
          raw: `import "${pathMatch[1]}"`,
          sourceFile: doc.path,
          language: lang,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Function call extraction
  // ---------------------------------------------------------------------------

  private extractFunctionCalls(content: string, lang: string, blockLine: number, doc: Document): Reference[] {
    const refs: Reference[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const callPattern = /\b([a-zA-Z_]\w*)\s*\(/g;
      let match: RegExpExecArray | null;

      while ((match = callPattern.exec(line)) !== null) {
        const funcName = match[1];
        if (SKIP_IDENTIFIERS.has(funcName)) continue;

        // Skip method calls (preceded by dot)
        if (match.index > 0 && line[match.index - 1] === '.') continue;

        // Skip definitions and constructors
        const before = line.substring(Math.max(0, match.index - 20), match.index);
        if (/\b(?:function|def|class|new|typeof|interface|type)\s*$/.test(before)) continue;

        const arity = this.countArguments(line, match.index + match[0].length - 1, lines, i);
        if (arity === null) continue;
        const argumentNames = this.extractArgumentNames(line, match.index + match[0].length - 1, lines, i);

        refs.push({
          type: this.type,
          kind: 'function-call',
          value: funcName,
          lineNumber: blockLine + i,
          raw: match[0].slice(0, -1), // function name without the paren
          sourceFile: doc.path,
          language: lang,
          linkText: String(arity),
          argumentNames,
        });
      }
    }

    return refs;
  }

  /**
   * Count arguments starting from the opening paren, handling nesting and
   * multi-line argument lists.
   */
  private countArguments(line: string, parenStart: number, lines: string[], lineIdx: number): number | null {
    let text = line.substring(parenStart);
    let lineOffset = 0;

    while (!this.hasClosingParen(text) && lineIdx + lineOffset + 1 < lines.length) {
      lineOffset++;
      text += '\n' + lines[lineIdx + lineOffset];
    }

    if (!this.hasClosingParen(text)) return null;

    const inner = this.extractParenContent(text);
    if (inner === null) return null;
    if (inner.trim() === '') return 0;

    return this.splitTopLevel(inner, ',').length;
  }

  private hasClosingParen(text: string): boolean {
    let depth = 0;
    for (const ch of text) {
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return true;
      }
    }
    return false;
  }

  private extractParenContent(text: string): string | null {
    if (text[0] !== '(') return null;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') {
        depth--;
        if (depth === 0) return text.substring(1, i);
      }
    }
    return null;
  }

  private splitTopLevel(content: string, delimiter: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of content) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;

      if (ch === delimiter && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) parts.push(trimmed);
        current = '';
      } else {
        current += ch;
      }
    }

    const trimmed = current.trim();
    if (trimmed) parts.push(trimmed);
    return parts;
  }

  private parseJsImportSpecifiers(specifierText: string): {
    importedSymbols: string[];
    importSpecifiers: string[];
  } {
    const trimmed = specifierText.trim();
    if (!trimmed) {
      return { importedSymbols: [], importSpecifiers: [] };
    }

    if (trimmed.startsWith('*')) {
      const namespaceMatch = trimmed.match(/^\*\s+as\s+(\w+)$/);
      const namespace = namespaceMatch?.[1];
      return {
        importedSymbols: [],
        importSpecifiers: namespace ? [`namespace:${namespace}`] : [],
      };
    }

    if (trimmed.startsWith('{')) {
      const named = this.parseNamedImportList(trimmed);
      return {
        importedSymbols: named,
        importSpecifiers: named.map((symbol) => `named:${symbol}`),
      };
    }

    const braceIdx = trimmed.indexOf('{');
    let defaultPart: string;
    let namedPart: string | undefined;
    if (braceIdx > 0) {
      // Split "defaultImport, { named }" into default and named parts
      defaultPart = trimmed.substring(0, braceIdx).trim().replace(/,$/, '').trim();
      namedPart = trimmed.substring(braceIdx);
    } else {
      defaultPart = trimmed;
    }
    const importedSymbols = defaultPart ? [defaultPart.trim()] : [];
    const importSpecifiers = defaultPart ? [`default:${defaultPart.trim()}`] : [];

    if (namedPart) {
      const named = this.parseNamedImportList(namedPart);
      importedSymbols.push(...named);
      importSpecifiers.push(...named.map((symbol) => `named:${symbol}`));
    }

    return { importedSymbols, importSpecifiers };
  }

  private parseNamedImportList(namedPart: string): string[] {
    const body = namedPart.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
    if (!body) return [];

    return body
      .split(',')
      .map((s) => s.trim().split(' as ')[0].trim())
      .filter(Boolean);
  }

  private extractArgumentNames(line: string, parenStart: number, lines: string[], lineIdx: number): string[] | undefined {
    let text = line.substring(parenStart);
    let lineOffset = 0;

    while (!this.hasClosingParen(text) && lineIdx + lineOffset + 1 < lines.length) {
      lineOffset++;
      text += '\n' + lines[lineIdx + lineOffset];
    }

    if (!this.hasClosingParen(text)) return undefined;

    const inner = this.extractParenContent(text);
    if (inner === null || inner.trim() === '') return [];

    const parts = this.splitTopLevel(inner, ',');
    const names = parts.map((part) => this.extractArgumentName(part));

    return names.every((name) => name !== null) ? (names as string[]) : undefined;
  }

  private extractArgumentName(argument: string): string | null {
    const trimmed = argument.trim();
    if (!trimmed) return null;

    const identifierMatch = trimmed.match(/^(?:\.\.\.)?([a-zA-Z_]\w*)$/);
    return identifierMatch ? identifierMatch[1] : null;
  }

  // ---------------------------------------------------------------------------
  // Config key extraction
  // ---------------------------------------------------------------------------

  private extractConfigKeys(content: string, lang: string, blockLine: number, doc: Document): Reference[] {
    if (lang !== 'javascript' && lang !== 'typescript') return [];

    const refs: Reference[] = [];

    // Typed variable assignment: const x: TypeName = { ... }
    const typedObjPattern = /(?:const|let|var)\s+\w+\s*:\s*([A-Z]\w+)\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = typedObjPattern.exec(content)) !== null) {
      const typeName = match[1];
      const braceStart = match.index + match[0].length - 1;
      const body = this.extractBraceContent(content, braceStart);
      if (!body) continue;

      const keys = this.extractObjectKeys(body);
      if (keys.length === 0) continue;

      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;

      refs.push({
        type: this.type,
        kind: 'config-keys',
        value: keys.join(','),
        lineNumber: blockLine + lineInBlock,
        raw: `${typeName} { ${keys.join(', ')} }`,
        sourceFile: doc.path,
        language: lang,
        linkText: typeName,
      });
    }

    // Generic function call: funcName<TypeName>({ ... })
    const funcConfigPattern = /\b([a-zA-Z_]\w*)<([A-Z]\w+)>[ \t]*\([ \t]*\{/g;
    while ((match = funcConfigPattern.exec(content)) !== null) {
      const typeName = match[2];
      const braceStart = match.index + match[0].length - 1;
      const body = this.extractBraceContent(content, braceStart);
      if (!body) continue;

      const keys = this.extractObjectKeys(body);
      if (keys.length === 0) continue;

      const lineInBlock = content.substring(0, match.index).split('\n').length - 1;

      refs.push({
        type: this.type,
        kind: 'config-keys',
        value: keys.join(','),
        lineNumber: blockLine + lineInBlock,
        raw: `${typeName} { ${keys.join(', ')} }`,
        sourceFile: doc.path,
        language: lang,
        linkText: typeName,
      });
    }

    return refs;
  }

  private extractBraceContent(content: string, braceStart: number): string | null {
    let depth = 0;
    for (let i = braceStart; i < content.length; i++) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) return content.substring(braceStart + 1, i);
      }
    }
    return null;
  }

  private extractObjectKeys(body: string): string[] {
    const keys: string[] = [];
    let depth = 0;

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Only extract keys at object-literal depth 0
      if (depth === 0) {
        const colonMatch = trimmed.match(/^(\w+)\s*\??:/);
        if (colonMatch) {
          keys.push(colonMatch[1]);
        } else {
          // Shorthand properties: key, or trailing key
          const shorthandMatch = trimmed.match(/^(\w+)\s*[,}]?\s*$/);
          if (shorthandMatch && !['true', 'false', 'null', 'undefined'].includes(shorthandMatch[1])) {
            keys.push(shorthandMatch[1]);
          }
        }
      }

      for (const ch of trimmed) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
    }

    return [...new Set(keys)];
  }
}
