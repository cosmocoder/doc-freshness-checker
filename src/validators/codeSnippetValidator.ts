import fs from 'fs';
import path from 'path';
import { SourceIndex } from '../source/sourceIndex.js';
import type { SourceIndexSnapshot } from '../source/sourceIndex.js';
import { isIllustrativePath, isIllustrativeSymbol, compilePatterns } from '../utils/illustrativePatterns.js';
import { findSimilar } from '../utils/similarity.js';
import { createIllustrativeSkippedResult, getRuleSeverity, severityForIllustrative } from '../utils/validation.js';
import type {
  CodeSnippetRuleConfig,
  DocFreshnessConfig,
  Document,
  FunctionSignature,
  Reference,
  SourceFileData,
  ValidationResult,
} from '../types.js';

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
  private exportsByFile: Map<string, Set<string>> | null = null;
  private customPatterns: RegExp[] = [];

  constructor();
  constructor(private readonly index = new SourceIndex()) {}

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
    if (this.sourceFiles) {
      return;
    }
    try {
      this.useSnapshot(await this.index.load(config, 'snippet'));
    }
    catch (error) {
      this.useSnapshot(await this.index.load(config, 'snippet'));
      throw error;
    }
  }

  private useSnapshot(snapshot: SourceIndexSnapshot): void {
    this.sourceFiles = snapshot.snippetFiles;
    this.functionSignatures = snapshot.functionSignatures;
    this.interfaceKeys = snapshot.interfaceKeys;
    this.exportsByFile = snapshot.exportsByFile;
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
      }
      catch {
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
      }
      catch {
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
    return this.exportsByFile?.get(filePath) || new Set();
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
      if (!specifier.startsWith(prefix)) {
        return [];
      }

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

  // Exposed for testing / integration
  getFunctionSignatures(): Map<string, FunctionSignature[]> | null {
    return this.functionSignatures;
  }

  getInterfaceKeys(): Map<string, Set<string>> | null {
    return this.interfaceKeys;
  }
}
