import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { isIllustrativePath, isIllustrativeSymbol, compilePatterns } from '../utils/illustrativePatterns.js';
import { findSimilar } from '../utils/similarity.js';
import { createIllustrativeSkippedResult, getRuleSeverity, severityForIllustrative } from '../utils/validation.js';
import type { CodeSnippetRuleConfig, DocFreshnessConfig, Document, Reference, SourceFileData, ValidationResult } from '../types.js';

interface FunctionSignature {
  params: string[];
  requiredParams: number;
  filePath: string;
}

const LANG_EXTENSIONS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
};

/**
 * Validates code-snippet references extracted from documentation code blocks.
 *
 * Checks three categories:
 *  1. Imports — module path resolves and imported symbols are exported
 *  2. Function calls — arity matches source definition (accounting for optionals)
 *  3. Config keys — keys exist in the referenced type/interface
 */
export class CodeSnippetValidator {
  private sourceFiles: Map<string, SourceFileData> | null = null;
  private functionSignatures: Map<string, FunctionSignature[]> | null = null;
  private interfaceKeys: Map<string, Set<string>> | null = null;
  private customPatterns: RegExp[] = [];
  private indexBuilt = false;

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    await this.buildIndex(config);

    const ruleConfig = config.rules?.['code-snippet'] as CodeSnippetRuleConfig | undefined;
    this.initCustomPatterns(ruleConfig);
    return Promise.all(
      references.map(async (ref) => {
        switch (ref.kind) {
          case 'import':
            return ruleConfig?.validateImports === false
              ? { reference: ref, valid: true, skipped: true, message: 'Import validation disabled' }
              : this.validateImport(ref, config);

          case 'function-call':
            return ruleConfig?.validateFunctionCalls === false
              ? { reference: ref, valid: true, skipped: true, message: 'Function call validation disabled' }
              : this.validateFunctionCall(ref, config);

          case 'config-keys':
            return ruleConfig?.validateConfigKeys === false
              ? { reference: ref, valid: true, skipped: true, message: 'Config key validation disabled' }
              : this.validateConfigKeys(ref, config);

          default:
            return { reference: ref, valid: true, skipped: true, message: 'Unknown snippet kind' };
        }
      })
    );
  }

  private initCustomPatterns(ruleConfig?: CodeSnippetRuleConfig): void {
    const configPatterns = ruleConfig?.illustrativePatterns;
    this.customPatterns = configPatterns && configPatterns.length > 0 ? compilePatterns(configPatterns) : [];
  }

  // ---------------------------------------------------------------------------
  // Index building
  // ---------------------------------------------------------------------------

  private async buildIndex(config: DocFreshnessConfig): Promise<void> {
    if (this.indexBuilt) return;
    this.indexBuilt = true;

    this.sourceFiles = new Map();
    this.functionSignatures = new Map();
    this.interfaceKeys = new Map();

    const rootDir = config.rootDir || process.cwd();
    const sourcePatterns = config.sourcePatterns || ['**/*.{ts,tsx,js,jsx,py,go}'];

    for (const pattern of sourcePatterns) {
      try {
        const files = await glob(pattern, {
          cwd: rootDir,
          absolute: true,
          ignore: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', '**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**'],
        });

        for (const file of files) {
          try {
            const content = await fs.promises.readFile(file, 'utf-8');
            const relativePath = path.relative(rootDir, file);
            const lang = this.detectLanguage(file);

            this.sourceFiles.set(relativePath, { content, language: lang });
            this.indexFunctionSignatures(content, relativePath, lang);
            this.indexInterfaceDefinitions(content, relativePath, lang);
          } catch {
            /* skip unreadable files */
          }
        }
      } catch {
        /* skip invalid patterns */
      }
    }
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    return LANG_EXTENSIONS[ext] || 'javascript';
  }

  // ---------------------------------------------------------------------------
  // Import validation
  // ---------------------------------------------------------------------------

  private async validateImport(ref: Reference, config: DocFreshnessConfig): Promise<ValidationResult> {
    const modulePath = ref.value;
    const ruleConfig = config.rules?.['code-snippet'] as CodeSnippetRuleConfig | undefined;
    const skipIllustrative = ruleConfig?.skipIllustrative !== false;
    const illustrative = isIllustrativePath(modulePath, this.customPatterns);

    if (illustrative && skipIllustrative) {
      return createIllustrativeSkippedResult(ref, 'Skipped: illustrative/example snippet import path');
    }

    const importSpecifiers =
      ref.importSpecifiers && ref.importSpecifiers.length > 0 ? ref.importSpecifiers : this.legacyImportSpecifiers(ref.linkText);

    const resolvedPath = await this.resolveImportPath(modulePath, ref.language, config);

    if (!resolvedPath) {
      if ((ref.language === 'python' || ref.language === 'go') && !modulePath.startsWith('.')) {
        return {
          reference: ref,
          valid: true,
          skipped: true,
          message: `${ref.language} import could not be resolved locally (may be stdlib or external)`,
        };
      }

      return {
        reference: ref,
        valid: false,
        severity: severityForIllustrative(illustrative, getRuleSeverity(config, 'code-snippet', 'warning')),
        message: illustrative ? `Import path not found (illustrative): ${modulePath}` : `Import path not found: ${modulePath}`,
        suggestion: this.suggestImportPath(modulePath),
      };
    }

    const namedSymbols = this.extractSpecifiersByPrefix(importSpecifiers, 'named:');
    const defaultSymbols = this.extractSpecifiersByPrefix(importSpecifiers, 'default:');

    if (namedSymbols.length > 0 || defaultSymbols.length > 0) {
      const exports = this.getExportedSymbols(resolvedPath);
      const hasDefaultExport = exports.has('default');
      const missingNamed = namedSymbols.filter((s) => !exports.has(s));
      const missingDefault = defaultSymbols.length > 0 && !hasDefaultExport ? defaultSymbols : [];
      const missing = [...missingNamed, ...missingDefault];

      if (missing.length > 0) {
        const exportNames = Array.from(exports);
        const suggestions = [
          ...missingNamed.map((symbol) => {
            const similar = findSimilar(symbol, exportNames);
            return similar ? `${symbol} → ${similar}` : symbol;
          }),
          ...missingDefault.flatMap((symbol) => (hasDefaultExport ? [`${symbol} → default export`] : [])),
        ];

        return {
          reference: ref,
          valid: false,
          severity: severityForIllustrative(illustrative, getRuleSeverity(config, 'code-snippet', 'warning')),
          message: illustrative
            ? `Symbol(s) not exported from ${resolvedPath} (illustrative): ${missing.join(', ')}`
            : `Symbol(s) not exported from ${resolvedPath}: ${missing.join(', ')}`,
          suggestion: suggestions.some((s) => s.includes('→')) ? `Did you mean: ${suggestions.join(', ')}?` : null,
          resolvedPath,
        };
      }
    }

    return { reference: ref, valid: true, resolvedPath };
  }

  private async resolveImportPath(modulePath: string, language: string | undefined, config: DocFreshnessConfig): Promise<string | null> {
    if (language === 'python') {
      return this.resolvePythonImportPath(modulePath, config);
    }

    const cleanPath = modulePath.replace(/^(?:\.\/|(?:\.\.\/)+)/, '');
    const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
    const baseDirs = ['', 'src/', 'lib/', 'app/'];
    const candidates = baseDirs.flatMap((base) => {
      const basePath = base + cleanPath;
      return [basePath, ...extensions.flatMap((ext) => [basePath + ext, `${basePath}/index${ext}`])];
    });

    // Check indexed source files first (fast)
    for (const candidate of candidates) {
      if (this.sourceFiles?.has(candidate)) {
        return candidate;
      }
    }

    // Filesystem fallback
    const rootDir = config.rootDir || process.cwd();
    for (const candidate of candidates) {
      try {
        await fs.promises.access(path.join(rootDir, candidate));
        return candidate;
      } catch {
        /* continue */
      }
    }

    return null;
  }

  private async resolvePythonImportPath(modulePath: string, config: DocFreshnessConfig): Promise<string | null> {
    const cleanPath = modulePath.replace(/^\.+/, '').replace(/\./g, '/');
    const candidates = [cleanPath + '.py', cleanPath + '/__init__.py'];
    const rootDir = config.rootDir || process.cwd();

    for (const candidate of candidates) {
      if (this.sourceFiles?.has(candidate)) {
        return candidate;
      }
    }

    for (const candidate of candidates) {
      try {
        await fs.promises.access(path.join(rootDir, candidate));
        return candidate;
      } catch {
        /* continue */
      }
    }

    return null;
  }

  private suggestImportPath(modulePath: string): string | null {
    const cleanPath = modulePath.replace(/^(?:\.\/|(?:\.\.\/)+)/, '');
    const searchBase = path.basename(cleanPath).toLowerCase();
    const similar: string[] = [];

    for (const filePath of this.sourceFiles?.keys() || []) {
      const fileBase = path.basename(filePath, path.extname(filePath)).toLowerCase();
      if (fileBase.includes(searchBase) || searchBase.includes(fileBase)) {
        similar.push(filePath);
      }

      if (similar.length > 5) {
        return null;
      }
    }

    if (similar.length > 0) {
      return `Did you mean: ${similar.slice(0, 3).join(', ')}?`;
    }
    return null;
  }

  private getExportedSymbols(filePath: string): Set<string> {
    const fileData = this.sourceFiles?.get(filePath);
    if (!fileData) return new Set();

    const exports = new Set<string>();
    const content = fileData.content;

    if (fileData.language === 'python') {
      const defPattern = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm;
      let pythonMatch: RegExpExecArray | null;
      while ((pythonMatch = defPattern.exec(content)) !== null) {
        if (!pythonMatch[1].startsWith('_')) {
          exports.add(pythonMatch[1]);
        }
      }

      const classPattern = /^class\s+([A-Za-z_]\w*)\b/gm;
      while ((pythonMatch = classPattern.exec(content)) !== null) {
        if (!pythonMatch[1].startsWith('_')) {
          exports.add(pythonMatch[1]);
        }
      }

      const assignmentPattern = /^([A-Za-z_]\w*)\s*=/gm;
      while ((pythonMatch = assignmentPattern.exec(content)) !== null) {
        if (!pythonMatch[1].startsWith('_')) {
          exports.add(pythonMatch[1]);
        }
      }

      return exports;
    }

    // export [async] function|class|const|let|var|interface|type|enum Name
    const directPattern = /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = directPattern.exec(content)) !== null) {
      exports.add(match[1]);
    }

    // export { Name1, Name2 as Alias }
    const namedPattern = /export\s*\{([^}]+)\}/g;
    while ((match = namedPattern.exec(content)) !== null) {
      for (const item of match[1].split(',')) {
        const original = item
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (original) exports.add(original);
      }
    }

    // export default identifier;
    const defaultPattern = /export\s+default\s+(\w+)\s*[;\n]/g;
    while ((match = defaultPattern.exec(content)) !== null) {
      exports.add(match[1]);
      exports.add('default');
    }

    const defaultDeclarationPattern = /export\s+default\s+(?:async\s+)?(?:function|class)\b(?:\s+(\w+))?/g;
    while ((match = defaultDeclarationPattern.exec(content)) !== null) {
      if (match[1]) exports.add(match[1]);
      exports.add('default');
    }

    // module.exports = { name1, name2: value }
    const cjsPattern = /module\.exports\s*=\s*\{([^}]+)\}/g;
    while ((match = cjsPattern.exec(content)) !== null) {
      for (const item of match[1].split(',')) {
        const name = item.trim().split(/\s*:/)[0].trim();
        if (name) exports.add(name);
      }
    }

    return exports;
  }

  // ---------------------------------------------------------------------------
  // Function call validation
  // ---------------------------------------------------------------------------

  private validateFunctionCall(ref: Reference, config: DocFreshnessConfig): ValidationResult {
    const funcName = ref.value;
    const snippetArity = parseInt(ref.linkText || '0', 10);

    if (isIllustrativeSymbol(funcName)) {
      return {
        reference: ref,
        valid: true,
        skipped: true,
        message: `Function ${funcName} looks illustrative/generic (may be external or contextual)`,
      };
    }

    const signatures = this.functionSignatures?.get(funcName);

    if (!signatures || signatures.length === 0) {
      return {
        reference: ref,
        valid: true,
        skipped: true,
        message: `Function ${funcName} not found in project source (may be external)`,
      };
    }

    // A call is valid if any signature can accept this many arguments
    const compatible = signatures.find((sig) => snippetArity >= sig.requiredParams && snippetArity <= sig.params.length);

    if (compatible) {
      const parameterNamesResult = this.validateFunctionParameterNames(ref, compatible, signatures, config);
      if (parameterNamesResult) {
        return parameterNamesResult;
      }

      return {
        reference: ref,
        valid: true,
        foundIn: [compatible.filePath],
      };
    }

    const closest = signatures.reduce((prev, curr) => {
      const prevMid = (prev.requiredParams + prev.params.length) / 2;
      const currMid = (curr.requiredParams + curr.params.length) / 2;
      return Math.abs(snippetArity - currMid) < Math.abs(snippetArity - prevMid) ? curr : prev;
    });

    const arityDesc =
      closest.requiredParams === closest.params.length
        ? String(closest.params.length)
        : `${closest.requiredParams}–${closest.params.length}`;

    return {
      reference: ref,
      valid: false,
      severity: getRuleSeverity(config, 'code-snippet', 'warning'),
      message: `Function ${funcName} called with ${snippetArity} arg(s) but expects ${arityDesc}`,
      suggestion: `Current signature: ${funcName}(${closest.params.join(', ')})`,
      foundIn: signatures.map((s) => s.filePath),
    };
  }

  // ---------------------------------------------------------------------------
  // Config key validation
  // ---------------------------------------------------------------------------

  private validateConfigKeys(ref: Reference, config: DocFreshnessConfig): ValidationResult {
    const snippetKeys = ref.value.split(',').filter(Boolean);
    const typeName = ref.linkText;

    if (!typeName) {
      return {
        reference: ref,
        valid: true,
        skipped: true,
        message: 'No type name associated with config keys',
      };
    }

    const knownKeys = this.interfaceKeys?.get(typeName);

    if (!knownKeys) {
      return {
        reference: ref,
        valid: true,
        skipped: true,
        message: `Type ${typeName} not found in project source`,
      };
    }

    const invalid = snippetKeys.filter((key) => !knownKeys.has(key));

    if (invalid.length === 0) {
      return { reference: ref, valid: true };
    }

    const knownKeyNames = Array.from(knownKeys);
    const suggestions = invalid.map((key) => {
      const similar = findSimilar(key, knownKeyNames);
      return similar ? `${key} → ${similar}` : key;
    });

    return {
      reference: ref,
      valid: false,
      severity: getRuleSeverity(config, 'code-snippet', 'warning'),
      message: `Config key(s) not found in ${typeName}: ${invalid.join(', ')}`,
      suggestion: suggestions.some((s) => s.includes('→')) ? `Did you mean: ${suggestions.join(', ')}?` : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Signature & interface indexing
  // ---------------------------------------------------------------------------

  private indexFunctionSignatures(content: string, filePath: string, lang: string): void {
    if (lang === 'javascript' || lang === 'typescript') {
      const funcPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = funcPattern.exec(content)) !== null) {
        this.addSignature(match[1], match[2], filePath, lang);
      }

      // Arrow / const functions
      const arrowPattern = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)[^{;]*=>/g;
      while ((match = arrowPattern.exec(content)) !== null) {
        this.addSignature(match[1], match[2], filePath, lang);
      }
    }

    if (lang === 'python') {
      const defPattern = /def\s+(\w+)\s*\(([^)]*)\)/g;
      let match: RegExpExecArray | null;
      while ((match = defPattern.exec(content)) !== null) {
        this.addSignature(match[1], match[2], filePath, lang);
      }
    }
  }

  private addSignature(name: string, paramsStr: string, filePath: string, lang: string): void {
    const { names, requiredCount } = this.parseParameters(paramsStr, lang);

    let params = names;
    let required = requiredCount;

    // Strip Python self/cls
    if (lang === 'python' && params.length > 0 && (params[0] === 'self' || params[0] === 'cls')) {
      params = params.slice(1);
      required = Math.max(0, required - 1);
    }

    const signatures = this.functionSignatures!.get(name) || [];
    if (signatures.length === 0) {
      this.functionSignatures!.set(name, signatures);
    }
    signatures.push({ params, requiredParams: required, filePath });
  }

  private parseParameters(paramsStr: string, lang: string): { names: string[]; requiredCount: number } {
    if (!paramsStr.trim()) return { names: [], requiredCount: 0 };

    const rawParams: string[] = [];
    let depth = 0;
    let current = '';

    for (const ch of paramsStr) {
      if ('(<[{'.includes(ch)) depth++;
      else if (')>]}'.includes(ch)) depth--;

      if (ch === ',' && depth === 0) {
        rawParams.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) rawParams.push(current.trim());

    const names: string[] = [];
    let requiredCount = 0;
    let seenOptional = false;

    for (const raw of rawParams) {
      const name = this.extractParamName(raw, lang);
      if (!name) continue;
      names.push(name);

      const isOptional = this.isOptionalParam(raw, lang);
      const isRest = raw.trim().startsWith('...') || raw.trim().startsWith('*');

      if (!isOptional && !isRest && !seenOptional) {
        requiredCount++;
      } else {
        seenOptional = true;
      }
    }

    return { names, requiredCount };
  }

  private extractParamName(raw: string, lang: string): string | null {
    if (!raw) return null;

    if (lang === 'typescript' || lang === 'javascript') {
      const match = raw.match(/^(?:\.\.\.)?(\w+)/);
      return match ? match[1] : null;
    }

    if (lang === 'python') {
      const match = raw.match(/^\*{0,2}(\w+)/);
      return match ? match[1] : null;
    }

    return null;
  }

  private isOptionalParam(raw: string, lang: string): boolean {
    if (raw.trim().startsWith('...') || raw.trim().startsWith('*')) return true;

    if (lang === 'typescript' || lang === 'javascript') {
      // name? (TS optional marker right after identifier)
      if (/^\w+\s*\?/.test(raw.trim())) return true;
    }

    // Default value at top level (= but not =>)
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      if ('({[<'.includes(raw[i])) depth++;
      else if (')}]>'.includes(raw[i])) depth--;

      if (depth === 0 && raw[i] === '=' && raw[i + 1] !== '>') return true;
    }

    return false;
  }

  private legacyImportSpecifiers(linkText?: string): string[] {
    return linkText
      ? linkText
          .split(',')
          .map((symbol) => symbol.trim())
          .filter(Boolean)
          .map((symbol) => `named:${symbol}`)
      : [];
  }

  private extractSpecifiersByPrefix(importSpecifiers: string[], prefix: string): string[] {
    return importSpecifiers.flatMap((specifier) => {
      if (!specifier.startsWith(prefix)) return [];

      const value = specifier.slice(prefix.length);
      return value ? [value] : [];
    });
  }

  private validateFunctionParameterNames(
    ref: Reference,
    compatible: FunctionSignature,
    signatures: FunctionSignature[],
    config: DocFreshnessConfig
  ): ValidationResult | null {
    const argumentNames = ref.argumentNames;
    if (!argumentNames || argumentNames.length === 0) {
      return null;
    }

    const compatibleByNames = signatures.find(
      (signature) =>
        argumentNames.length >= signature.requiredParams &&
        argumentNames.length <= signature.params.length &&
        this.parameterNamesMatch(argumentNames, signature.params)
    );

    if (compatibleByNames) {
      return null;
    }

    return {
      reference: ref,
      valid: false,
      severity: getRuleSeverity(config, 'code-snippet', 'warning'),
      message: `Function ${ref.value} example uses outdated parameter name(s): ${argumentNames.join(', ')}`,
      suggestion: `Current signature: ${ref.value}(${compatible.params.join(', ')})`,
      foundIn: signatures.map((signature) => signature.filePath),
    };
  }

  private parameterNamesMatch(argumentNames: string[], parameterNames: string[]): boolean {
    if (argumentNames.length > parameterNames.length) {
      return false;
    }

    return argumentNames.every((name, index) => name === parameterNames[index]);
  }

  private indexInterfaceDefinitions(content: string, _filePath: string, lang: string): void {
    if (lang !== 'typescript') return;

    // interface Name { ... }
    const ifacePattern = /(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+[\w,\s<>]+)?\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = ifacePattern.exec(content)) !== null) {
      this.addInterfaceKeys(match[1], content, match.index + match[0].length - 1);
    }

    // type Name = { ... }
    const typeObjPattern = /(?:export\s+)?type\s+(\w+)\s*=\s*\{/g;
    while ((match = typeObjPattern.exec(content)) !== null) {
      this.addInterfaceKeys(match[1], content, match.index + match[0].length - 1);
    }
  }

  private addInterfaceKeys(name: string, content: string, braceStart: number): void {
    const body = this.extractBraceContent(content, braceStart);
    if (!body) return;

    const keys = this.extractPropertyKeys(body);
    if (keys.size === 0) return;

    if (!this.interfaceKeys!.has(name)) {
      this.interfaceKeys!.set(name, new Set());
    }
    for (const key of keys) {
      this.interfaceKeys!.get(name)!.add(key);
    }
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

  private extractPropertyKeys(body: string): Set<string> {
    const keys = new Set<string>();
    let depth = 0;

    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (depth === 0) {
        const keyMatch = trimmed.match(/^(?:readonly\s+)?(\w+)\??\s*:/);
        if (keyMatch) {
          keys.add(keyMatch[1]);
        }
      }

      for (const ch of trimmed) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
    }

    return keys;
  }

  // Exposed for testing / integration
  getFunctionSignatures(): Map<string, FunctionSignature[]> | null {
    return this.functionSignatures;
  }

  getInterfaceKeys(): Map<string, Set<string>> | null {
    return this.interfaceKeys;
  }
}
