import { BaseExtractor } from './baseExtractor.js';
import { isIllustrativeSymbol } from '../../utils/illustrativePatterns.js';
import type { Document, DocFreshnessConfig, LanguagePattern, Reference } from '../../types.js';

/**
 * Extracts code pattern references
 * Configurable for any programming language
 */
export class CodePatternExtractor extends BaseExtractor {
  private languageAliases: Record<string, string[]>;
  private languagePatterns: Record<string, LanguagePattern[]>;

  constructor(config: Partial<DocFreshnessConfig> = {}) {
    super('code-pattern');

    // Language-specific code block identifiers
    this.languageAliases = config.languageAliases || {
      javascript: ['javascript', 'js'],
      typescript: ['typescript', 'ts'],
      python: ['python', 'py'],
      go: ['go', 'golang'],
      rust: ['rust', 'rs'],
      java: ['java'],
      csharp: ['csharp', 'cs', 'c#'],
      ruby: ['ruby', 'rb'],
      php: ['php'],
    };

    // Language-specific patterns for extracting code symbols
    this.languagePatterns = config.languagePatterns || {
      javascript: [
        { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
        { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
        { regex: /\bconst\s+([A-Z][a-zA-Z0-9]+)\s*=/g, kind: 'const' },
        {
          regex: /\bexport\s+(?:default\s+)?(?:class|function|const)\s+([a-zA-Z][a-zA-Z0-9]+)/g,
          kind: 'export',
        },
      ],
      typescript: [
        { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
        { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
        { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'type' },
        { regex: /\bfunction\s+([a-zA-Z][a-zA-Z0-9]+)/g, kind: 'function' },
        { regex: /\bexport\s+\{\s*([A-Z][a-zA-Z0-9]+)/g, kind: 'export' },
      ],
      python: [
        { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
        { regex: /\bdef\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
      ],
      go: [
        { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+struct/g, kind: 'struct' },
        { regex: /\btype\s+([A-Z][a-zA-Z0-9]+)\s+interface/g, kind: 'interface' },
        { regex: /\bfunc\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'function' },
      ],
      rust: [
        { regex: /\bstruct\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'struct' },
        { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
        { regex: /\btrait\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'trait' },
        { regex: /\bfn\s+([a-z_][a-zA-Z0-9_]*)/g, kind: 'function' },
      ],
      java: [
        { regex: /\bclass\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'class' },
        { regex: /\binterface\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'interface' },
        { regex: /\benum\s+([A-Z][a-zA-Z0-9]+)/g, kind: 'enum' },
      ],
    };
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];

    // Build pattern to match code blocks for all configured languages
    const allAliases = Object.values(this.languageAliases).flat();
    const langPattern = allAliases.join('|');
    const codeBlockPattern = new RegExp(`\`\`\`(?:${langPattern})\\n([\\s\\S]*?)\`\`\``, 'gi');

    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = codeBlockPattern.exec(document.content)) !== null) {
      const blockContent = blockMatch[1];
      const blockLine = this.findLineNumber(document.content, blockMatch.index);
      const detectedLang = this.detectLanguage(blockMatch[0]);

      const patterns = this.languagePatterns[detectedLang] || this.languagePatterns.javascript;

      for (const { regex, kind } of patterns) {
        let match: RegExpExecArray | null;
        // Clone regex to avoid state issues
        const re = new RegExp(regex.source, regex.flags);
        while ((match = re.exec(blockContent)) !== null) {
          const symbolName = match[1];
          const illustrative = isIllustrativeSymbol(symbolName);

          references.push({
            type: this.type,
            kind,
            language: detectedLang,
            value: symbolName,
            lineNumber: blockLine,
            raw: match[0],
            sourceFile: document.path,
            ...(illustrative && { isIllustrative: true }),
          });
        }
      }
    }

    return references;
  }

  private detectLanguage(codeBlockStart: string): string {
    const lower = codeBlockStart.toLowerCase();
    for (const [lang, aliases] of Object.entries(this.languageAliases)) {
      if (aliases.some((alias) => lower.includes(alias))) {
        return lang;
      }
    }
    return 'javascript'; // default
  }
}
