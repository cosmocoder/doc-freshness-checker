import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import type { IncrementalInput } from '../validators/incrementalInputs.js';
import type {
  DocFreshnessConfig,
  FunctionSignature,
  LanguageConfig,
  SourceFileData,
  SupportedLanguage,
  SupportedSnippetLanguage,
  SymbolLocation,
} from '../types.js';

export interface SourceIndexSnapshot {
  patternFiles: Map<string, SourceFileData>;
  snippetFiles: Map<string, SourceFileData>;
  symbols: Map<string, SymbolLocation[]>;
  functionSignatures: Map<string, FunctionSignature[]>;
  interfaceKeys: Map<string, Set<string>>;
  exportsByFile: Map<string, Set<string>>;
  patternInputs: IncrementalInput[] | null;
}

export type SourceIndexView = 'pattern' | 'snippet';

export const languageConfigs: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\bexport\s+(?:async\s+)?function\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
      { regex: /\bexport\s+const\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'const' },
      { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  typescript: {
    extensions: ['ts', 'tsx'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s*=/g, kind: 'type' },
      { regex: /\bexport\s+(?:async\s+)?function\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
      { regex: /\bexport\s+const\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'const' },
      { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  python: {
    extensions: ['py'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\bdef\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
    ],
  },
  go: {
    extensions: ['go'],
    patterns: [
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+struct/g, kind: 'struct' },
      { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+interface/g, kind: 'interface' },
      { regex: /\bfunc\s+(?:\([^)]+\)\s+)?([A-Z][a-zA-Z0-9]+)/g, kind: 'function' },
    ],
  },
  rust: {
    extensions: ['rs'],
    patterns: [
      { regex: /\bstruct\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'struct' },
      { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
      { regex: /\btrait\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'trait' },
      { regex: /\bpub\s+fn\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
      { regex: /\bfn\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
    ],
  },
  java: {
    extensions: ['java'],
    patterns: [
      { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
      { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
      { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
    ],
  },
};

const SNIPPET_LANG_EXTENSIONS: Record<string, SupportedSnippetLanguage> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
};

interface SnippetLanguageBehavior {
  signaturePatterns: RegExp[];
  parameterNamePattern?: RegExp;
  optionalMarker?: RegExp;
  strippedReceivers?: string[];
  indexInterfaces?: boolean;
  exportStyle: 'javascript' | 'python';
}

const JAVASCRIPT_BEHAVIOR = {
  signaturePatterns: [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)[^{;]*=>/g,
  ],
  parameterNamePattern: /^(?:\.\.\.)?(\w+)/,
  optionalMarker: /^\w+\s*\?/,
  exportStyle: 'javascript' as const,
};
const SNIPPET_LANGUAGE_BEHAVIORS: Record<SupportedSnippetLanguage, SnippetLanguageBehavior> = {
  javascript: JAVASCRIPT_BEHAVIOR,
  typescript: { ...JAVASCRIPT_BEHAVIOR, indexInterfaces: true },
  python: {
    signaturePatterns: [/def\s+(\w+)\s*\(([^)]*)\)/g],
    parameterNamePattern: /^\*{0,2}(\w+)/,
    strippedReceivers: ['self', 'cls'],
    exportStyle: 'python',
  },
  go: { signaturePatterns: [], exportStyle: 'javascript' },
};

const PATTERN_IGNORES = ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/node_modules/**', '**/vendor/**'];
const SNIPPET_IGNORES = [...PATTERN_IGNORES, '**/dist/**', '**/build/**'];
const SNIPPET_FALLBACK = ['**/*.{ts,tsx,js,jsx,py,go}'];

export class SourceIndex {
  private readonly snapshot: SourceIndexSnapshot = {
    patternFiles: new Map(),
    snippetFiles: new Map(),
    symbols: new Map(),
    functionSignatures: new Map(),
    interfaceKeys: new Map(),
    exportsByFile: new Map(),
    patternInputs: null,
  };
  private readonly reads = new Map<string, Promise<string>>();
  private readonly loads: Partial<Record<SourceIndexView, Promise<SourceIndexSnapshot>>> = {};
  private readonly finished = new Set<SourceIndexView>();
  private config: DocFreshnessConfig | undefined;

  load(config: DocFreshnessConfig, view: SourceIndexView): Promise<SourceIndexSnapshot> {
    const sourceConfig = (this.config ??= config);
    if (this.finished.has(view)) {
      return Promise.resolve(this.snapshot);
    }
    this.loads[view] ??= (view === 'pattern' ? this.buildPattern(sourceConfig) : this.buildSnippet(sourceConfig)).then(
      () => {
        this.finished.add(view);
        return this.snapshot;
      },
      (error: unknown) => {
        this.finished.add(view);
        throw error;
      }
    );
    return this.loads[view];
  }

  private async buildPattern(config: DocFreshnessConfig): Promise<void> {
    const rootDir = config.rootDir || process.cwd();
    const patterns = config.sourcePatterns || this.patternFallback();
    const { files, complete } = await this.findFiles(patterns, rootDir, PATTERN_IGNORES);
    const inputs = new Map<string, string>();
    let inputsComplete = complete;
    for (const file of files) {
      try {
        const content = await this.read(file);
        inputs.set(path.resolve(file), content);
        const relativePath = path.relative(rootDir, file);
        const language = this.patternLanguage(file);
        this.indexSymbols(this.snapshot.symbols, content, relativePath, language);
        this.snapshot.patternFiles.set(relativePath, { content, language });
      }
      catch {
        inputsComplete = false;
      }
    }
    this.snapshot.patternInputs = inputsComplete ? [...inputs].map(([inputPath, content]) => ({ path: inputPath, content })) : null;
  }

  private async buildSnippet(config: DocFreshnessConfig): Promise<void> {
    const rootDir = config.rootDir || process.cwd();
    const patterns = config.sourcePatterns || SNIPPET_FALLBACK;
    const { files } = await this.findFiles(patterns, rootDir, SNIPPET_IGNORES);
    for (const file of files) {
      try {
        const content = await this.read(file);
        const relativePath = path.relative(rootDir, file);
        const language = this.snippetLanguage(file);
        this.snapshot.snippetFiles.set(relativePath, { content, language });
        this.indexFunctionSignatures(this.snapshot.functionSignatures, content, relativePath, language);
        this.indexInterfaceDefinitions(this.snapshot.interfaceKeys, content, language);
        this.snapshot.exportsByFile.set(relativePath, this.extractExports(content, language));
      }
      catch {
        /* skip unreadable files */
      }
    }
  }

  private patternFallback(): string[] {
    return Object.values(languageConfigs).flatMap((config) => config.extensions.map((extension) => `**/*.${extension}`));
  }

  private async findFiles(patterns: string[], rootDir: string, ignore: string[]): Promise<{ files: string[]; complete: boolean }> {
    const files: string[] = [];
    let complete = true;
    for (const pattern of patterns) {
      try {
        for (const file of await glob(pattern, { cwd: rootDir, absolute: true, nodir: true, ignore })) {
          files.push(file);
        }
      }
      catch {
        complete = false;
      }
    }
    return { files, complete };
  }

  private read(file: string): Promise<string> {
    let pending = this.reads.get(file);
    if (!pending) {
      pending = fs.promises.readFile(file, 'utf-8');
      this.reads.set(file, pending);
    }
    return pending;
  }

  private patternLanguage(filePath: string): SupportedLanguage {
    const extension = path.extname(filePath).slice(1).toLowerCase();
    for (const [language, config] of Object.entries(languageConfigs)) {
      if (config.extensions.includes(extension)) {
        return language as SupportedLanguage;
      }
    }
    return 'javascript';
  }

  private snippetLanguage(filePath: string): SupportedSnippetLanguage {
    return SNIPPET_LANG_EXTENSIONS[path.extname(filePath).slice(1).toLowerCase()] || 'javascript';
  }

  private indexSymbols(symbols: Map<string, SymbolLocation[]>, content: string, filePath: string, language: SupportedLanguage): void {
    const config = languageConfigs[language];
    for (const { regex, kind } of config.patterns) {
      const pattern = new RegExp(regex.source, regex.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const locations = symbols.get(match[1]) || [];
        if (locations.length === 0) {
          symbols.set(match[1], locations);
        }
        locations.push({ filePath, kind, language });
      }
    }
  }

  private indexFunctionSignatures(
    signatures: Map<string, FunctionSignature[]>,
    content: string,
    filePath: string,
    language: SupportedSnippetLanguage
  ): void {
    const behavior = SNIPPET_LANGUAGE_BEHAVIORS[language];
    for (const sourcePattern of behavior.signaturePatterns) {
      const pattern = new RegExp(sourcePattern.source, sourcePattern.flags);
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        this.addSignature(signatures, match[1], match[2], filePath, behavior);
      }
    }
  }

  private addSignature(
    signatures: Map<string, FunctionSignature[]>,
    name: string,
    parameters: string,
    filePath: string,
    behavior: SnippetLanguageBehavior
  ): void {
    const parsed = this.parseParameters(parameters, behavior);
    let names = parsed.names;
    let required = parsed.requiredCount;
    if (names.length > 0 && behavior.strippedReceivers?.includes(names[0])) {
      names = names.slice(1);
      required = Math.max(0, required - 1);
    }
    const entries = signatures.get(name) || [];
    if (entries.length === 0) {
      signatures.set(name, entries);
    }
    entries.push({ params: names, requiredParams: required, filePath });
  }

  private parseParameters(parameters: string, behavior: SnippetLanguageBehavior): { names: string[]; requiredCount: number } {
    if (!parameters.trim()) {
      return { names: [], requiredCount: 0 };
    }
    const rawParameters: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of parameters) {
      if ('(<[{'.includes(character)) {
        depth++;
      }
      else if (')>]}'.includes(character)) {
        depth--;
      }
      if (character === ',' && depth === 0) {
        rawParameters.push(current.trim());
        current = '';
      }
      else {
        current += character;
      }
    }
    if (current.trim()) {
      rawParameters.push(current.trim());
    }

    const names: string[] = [];
    let requiredCount = 0;
    let seenOptional = false;
    for (const raw of rawParameters) {
      const name = this.extractParameterName(raw, behavior);
      if (!name) {
        continue;
      }
      names.push(name);
      const optional = this.isOptionalParameter(raw, behavior);
      const rest = raw.trim().startsWith('...') || raw.trim().startsWith('*');
      if (!optional && !rest && !seenOptional) {
        requiredCount++;
      }
      else {
        seenOptional = true;
      }
    }
    return { names, requiredCount };
  }

  private extractParameterName(raw: string, behavior: SnippetLanguageBehavior): string | null {
    if (!raw || !behavior.parameterNamePattern) {
      return null;
    }
    return raw.match(behavior.parameterNamePattern)?.[1] || null;
  }

  private isOptionalParameter(raw: string, behavior: SnippetLanguageBehavior): boolean {
    if (raw.trim().startsWith('...') || raw.trim().startsWith('*')) {
      return true;
    }
    if (behavior.optionalMarker?.test(raw.trim())) {
      return true;
    }
    let depth = 0;
    for (let index = 0; index < raw.length; index++) {
      if ('({[<'.includes(raw[index])) {
        depth++;
      }
      else if (')}]>'.includes(raw[index])) {
        depth--;
      }
      if (depth === 0 && raw[index] === '=' && raw[index + 1] !== '>') {
        return true;
      }
    }
    return false;
  }

  private indexInterfaceDefinitions(interfaceKeys: Map<string, Set<string>>, content: string, language: SupportedSnippetLanguage): void {
    if (!SNIPPET_LANGUAGE_BEHAVIORS[language].indexInterfaces) {
      return;
    }
    const interfacePattern = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s<>]+)?\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = interfacePattern.exec(content)) !== null) {
      this.addInterfaceKeys(interfaceKeys, match[1], content, match.index + match[0].length - 1);
    }
    const objectTypePattern = /(?:export\s+)?type\s+(\w+)\s*=\s*\{/g;
    while ((match = objectTypePattern.exec(content)) !== null) {
      this.addInterfaceKeys(interfaceKeys, match[1], content, match.index + match[0].length - 1);
    }
  }

  private addInterfaceKeys(keysByInterface: Map<string, Set<string>>, name: string, content: string, braceStart: number): void {
    const body = this.extractBraceContent(content, braceStart);
    if (!body) {
      return;
    }
    const keys = this.extractPropertyKeys(body);
    if (keys.size === 0) {
      return;
    }
    const existing = keysByInterface.get(name) || new Set<string>();
    if (existing.size === 0) {
      keysByInterface.set(name, existing);
    }
    for (const key of keys) {
      existing.add(key);
    }
  }

  private extractBraceContent(content: string, braceStart: number): string | null {
    let depth = 0;
    for (let index = braceStart; index < content.length; index++) {
      if (content[index] === '{') {
        depth++;
      }
      else if (content[index] === '}') {
        depth--;
        if (depth === 0) {
          return content.substring(braceStart + 1, index);
        }
      }
    }
    return null;
  }

  private extractPropertyKeys(body: string): Set<string> {
    const keys = new Set<string>();
    let depth = 0;
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      if (depth === 0) {
        const match = trimmed.match(/^(?:readonly\s+)?(\w+)\??\s*:/);
        if (match) {
          keys.add(match[1]);
        }
      }
      for (const character of trimmed) {
        if (character === '{') {
          depth++;
        }
        else if (character === '}') {
          depth--;
        }
      }
    }
    return keys;
  }

  private extractExports(content: string, language: SupportedSnippetLanguage): Set<string> {
    const exports = new Set<string>();
    if (SNIPPET_LANGUAGE_BEHAVIORS[language].exportStyle === 'python') {
      const definitionPattern = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
      let match: RegExpExecArray | null;
      while ((match = definitionPattern.exec(content)) !== null) {
        if (!match[1].startsWith('_')) {
          exports.add(match[1]);
        }
      }
      const classPattern = /^class\s+([A-Za-z_]\w*)\b/gm;
      while ((match = classPattern.exec(content)) !== null) {
        if (!match[1].startsWith('_')) {
          exports.add(match[1]);
        }
      }
      const assignmentPattern = /^([A-Za-z_]\w*)\s*=/gm;
      while ((match = assignmentPattern.exec(content)) !== null) {
        if (!match[1].startsWith('_')) {
          exports.add(match[1]);
        }
      }
      return exports;
    }

    const directPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = directPattern.exec(content)) !== null) {
      exports.add(match[1]);
    }
    const namedPattern = /export\s*\{([^}]+)\}/g;
    while ((match = namedPattern.exec(content)) !== null) {
      for (const item of match[1].split(',')) {
        const original = item
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (original) {
          exports.add(original);
        }
      }
    }
    const defaultPattern = /export\s+default\s+(\w+)\s*[;\n]/g;
    while ((match = defaultPattern.exec(content)) !== null) {
      exports.add(match[1]);
      exports.add('default');
    }
    const defaultDeclarationPattern = /export\s+default\s+(?:async\s+)?(?:function|class)\b(?:\s+(\w+))?/g;
    while ((match = defaultDeclarationPattern.exec(content)) !== null) {
      if (match[1]) {
        exports.add(match[1]);
      }
      exports.add('default');
    }
    const commonJsPattern = /module\.exports\s*=\s*\{([^}]+)\}/g;
    while ((match = commonJsPattern.exec(content)) !== null) {
      for (const item of match[1].split(',')) {
        const name = item.trim().split(/\s*:/)[0].trim();
        if (name) {
          exports.add(name);
        }
      }
    }
    return exports;
  }
}
