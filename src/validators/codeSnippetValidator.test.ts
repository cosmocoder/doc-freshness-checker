import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { CodeSnippetValidator } from './codeSnippetValidator.js';
import type { DocFreshnessConfig, Document, Reference } from '../types.js';

function makeRef(kind: string, value: string, overrides: Partial<Reference> = {}): Reference {
  return {
    type: 'code-snippet',
    value,
    lineNumber: 1,
    raw: value,
    sourceFile: 'doc.md',
    kind,
    language: 'typescript',
    ...overrides,
  };
}

const doc: Document = {
  path: 'doc.md',
  absolutePath: '/project/doc.md',
  content: '',
  format: 'markdown',
  lines: [],
  references: [],
};

const config: DocFreshnessConfig = {
  rootDir: process.cwd(),
  sourcePatterns: ['src/**/*.ts'],
  rules: { 'code-snippet': { enabled: true, severity: 'warning' } },
};

async function withTempSourceFiles(
  files: Record<string, string>,
  callback: (tempConfig: DocFreshnessConfig) => Promise<void>
): Promise<void> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-code-snippet-'));

  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(tempRoot, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
    }

    await callback({
      rootDir: tempRoot,
      sourcePatterns: ['src/**/*.{ts,py}'],
      rules: { 'code-snippet': { enabled: true, severity: 'warning' } },
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

describe('CodeSnippetValidator', () => {
  // -------------------------------------------------------------------------
  // Import validation
  // -------------------------------------------------------------------------
  describe('import validation', () => {
    it('validates import to an existing source file', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './src/types', {
        linkText: 'Reference',
        raw: "import { Reference } from './src/types'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
      expect(results[0].resolvedPath).toBeDefined();
    });

    it('reports unresolvable import path', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './nonexistent/module', {
        linkText: 'Foo',
        raw: "import { Foo } from './nonexistent/module'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('Import path not found');
    });

    it('detects missing exported symbols', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './src/types', {
        linkText: 'Reference,CompletelyFakeSymbol',
        raw: "import { Reference, CompletelyFakeSymbol } from './src/types'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('CompletelyFakeSymbol');
      expect(results[0].message).toContain('not exported');
    });

    it('resolves paths with implicit extension', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './utils/similarity', {
        linkText: 'findSimilar',
        raw: "import { findSimilar } from './utils/similarity'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
    });

    it('validates import with no symbols (path-only)', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './src/types', {
        linkText: '',
        raw: "import * as types from './src/types'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
    });

    it('accepts default imports from default exports', async () => {
      await withTempSourceFiles(
        {
          'src/router.ts': 'export default function createRouter() { return true; }\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('import', './router', {
            sourceFile: 'docs/example.md',
            linkText: 'Router',
            importSpecifiers: ['default:Router'],
            raw: "import Router from './router'",
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].valid).toBe(true);
        }
      );
    });

    it('accepts default require bindings as module objects', async () => {
      await withTempSourceFiles(
        {
          'src/config.ts': 'export const env = "test";\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('import', './config', {
            sourceFile: 'docs/example.md',
            linkText: '',
            importSpecifiers: ['module:*'],
            raw: "const config = require('./config')",
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].valid).toBe(true);
        }
      );
    });

    it('skips illustrative component import paths by default', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('import', './MyComponent.translations', {
        linkText: 'translations',
        raw: "import { translations } from './MyComponent.translations'",
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].skipped).toBe(true);
      expect(results[0].message).toContain('illustrative');
    });

    it('downgrades illustrative import paths when skipIllustrative is false', async () => {
      const validator = new CodeSnippetValidator();
      const customConfig: DocFreshnessConfig = {
        ...config,
        rules: { 'code-snippet': { enabled: true, severity: 'warning', skipIllustrative: false } },
      };
      const ref = makeRef('import', './MyComponent.translations', {
        linkText: 'translations',
        raw: "import { translations } from './MyComponent.translations'",
      });
      const results = await validator.validateBatch([ref], doc, customConfig);
      expect(results[0].valid).toBe(false);
      expect(results[0].severity).toBe('info');
      expect(results[0].message).toContain('illustrative');
    });
  });

  // -------------------------------------------------------------------------
  // Function call validation
  // -------------------------------------------------------------------------
  describe('function call validation', () => {
    it('skips functions not found in source (may be external)', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('function-call', 'totallyUnknownFunction', {
        linkText: '2',
        raw: 'totallyUnknownFunction',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].skipped).toBe(true);
    });

    it('validates matching arity for a known function', async () => {
      const validator = new CodeSnippetValidator();
      // findSimilar(target, candidates, maxDistance = 3) → 2 required, 3 total
      const ref = makeRef('function-call', 'findSimilar', {
        linkText: '2',
        raw: 'findSimilar',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
      expect(results[0].foundIn).toBeDefined();
    });

    it('accepts call with all params (including optionals)', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('function-call', 'findSimilar', {
        linkText: '3',
        raw: 'findSimilar',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
    });

    it('reports arity mismatch', async () => {
      const validator = new CodeSnippetValidator();
      // levenshteinDistance(a, b) → exactly 2 required
      const ref = makeRef('function-call', 'levenshteinDistance', {
        linkText: '5',
        raw: 'levenshteinDistance',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('levenshteinDistance');
      expect(results[0].suggestion).toBeDefined();
    });

    it('reports outdated parameter names when snippet placeholders drift', async () => {
      await withTempSourceFiles(
        {
          'src/api.ts': 'export function createUser(name: string, email: string, role?: string) { return { name, email, role }; }\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('function-call', 'createUser', {
            argumentNames: ['username', 'email'],
            linkText: '2',
            raw: 'createUser(username, email)',
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].valid).toBe(false);
          expect(results[0].message).toContain('outdated parameter name');
          expect(results[0].suggestion).toContain('createUser(name, email, role)');
        }
      );
    });

    it('skips parameter-name comparison when arguments are expressions', async () => {
      await withTempSourceFiles(
        {
          'src/api.ts': 'export function createUser(name: string, email: string) { return { name, email }; }\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('function-call', 'createUser', {
            linkText: '2',
            raw: 'createUser(getName(), email.trim())',
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].valid).toBe(true);
        }
      );
    });

    it('skips generic short helper names like t to avoid false-positive binding', async () => {
      await withTempSourceFiles(
        {
          'src/i18n.ts': 'export function t(key: string) { return key; }\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('function-call', 't', {
            linkText: '2',
            raw: "t('hello', { name })",
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].skipped).toBe(true);
          expect(results[0].message).toContain('generic');
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Config key validation
  // -------------------------------------------------------------------------
  describe('config key validation', () => {
    it('skips when type is not found in source', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('config-keys', 'a,b', {
        linkText: 'TotallyFakeType',
        raw: 'TotallyFakeType { a, b }',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].skipped).toBe(true);
    });

    it('validates keys against a known interface', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('config-keys', 'rootDir,include,exclude', {
        linkText: 'DocFreshnessConfig',
        raw: 'DocFreshnessConfig { rootDir, include, exclude }',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(true);
    });

    it('reports invalid config keys with suggestions', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('config-keys', 'rootDir,rootDr', {
        linkText: 'DocFreshnessConfig',
        raw: 'DocFreshnessConfig { rootDir, rootDr }',
      });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('rootDr');
      expect(results[0].suggestion).toContain('rootDir');
    });

    it('skips when no type name is provided', async () => {
      const validator = new CodeSnippetValidator();
      const ref = makeRef('config-keys', 'a,b', { linkText: '' });
      const results = await validator.validateBatch([ref], doc, config);
      expect(results[0].skipped).toBe(true);
    });
  });

  describe('python import validation', () => {
    it('resolves project-local python modules', async () => {
      await withTempSourceFiles(
        {
          'src/myapp/services.py': 'def create_user(name):\n    return name\n',
        },
        async (tempConfig) => {
          const validator = new CodeSnippetValidator();
          const ref = makeRef('import', 'src.myapp.services', {
            language: 'python',
            linkText: 'create_user',
            importSpecifiers: ['named:create_user'],
            raw: 'from src.myapp.services import create_user',
          });
          const results = await validator.validateBatch([ref], doc, tempConfig);
          expect(results[0].valid).toBe(true);
          expect(results[0].resolvedPath).toBe('src/myapp/services.py');
        }
      );
    });
  });

  // -------------------------------------------------------------------------
  // Rule configuration
  // -------------------------------------------------------------------------
  describe('rule configuration', () => {
    it('skips imports when validateImports is false', async () => {
      const validator = new CodeSnippetValidator();
      const customConfig: DocFreshnessConfig = {
        ...config,
        rules: { 'code-snippet': { enabled: true, validateImports: false } },
      };
      const ref = makeRef('import', './bad/path', { linkText: 'Foo' });
      const results = await validator.validateBatch([ref], doc, customConfig);
      expect(results[0].skipped).toBe(true);
    });

    it('skips function calls when validateFunctionCalls is false', async () => {
      const validator = new CodeSnippetValidator();
      const customConfig: DocFreshnessConfig = {
        ...config,
        rules: { 'code-snippet': { enabled: true, validateFunctionCalls: false } },
      };
      const ref = makeRef('function-call', 'findSimilar', { linkText: '99' });
      const results = await validator.validateBatch([ref], doc, customConfig);
      expect(results[0].skipped).toBe(true);
    });

    it('skips config keys when validateConfigKeys is false', async () => {
      const validator = new CodeSnippetValidator();
      const customConfig: DocFreshnessConfig = {
        ...config,
        rules: { 'code-snippet': { enabled: true, validateConfigKeys: false } },
      };
      const ref = makeRef('config-keys', 'badKey', { linkText: 'DocFreshnessConfig' });
      const results = await validator.validateBatch([ref], doc, customConfig);
      expect(results[0].skipped).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Index caching
  // -------------------------------------------------------------------------
  it('builds index only once across multiple calls', async () => {
    const validator = new CodeSnippetValidator();
    await validator.validateBatch([makeRef('function-call', 'foo', { linkText: '0' })], doc, config);
    const sigs1 = validator.getFunctionSignatures();
    await validator.validateBatch([makeRef('function-call', 'bar', { linkText: '0' })], doc, config);
    expect(validator.getFunctionSignatures()).toBe(sigs1);
  });

  it('indexes interface keys from source', async () => {
    const validator = new CodeSnippetValidator();
    await validator.validateBatch([makeRef('config-keys', 'rootDir', { linkText: 'DocFreshnessConfig' })], doc, config);
    const keys = validator.getInterfaceKeys();
    expect(keys).toBeInstanceOf(Map);
    expect(keys!.has('DocFreshnessConfig')).toBe(true);
    expect(keys!.get('DocFreshnessConfig')!.has('rootDir')).toBe(true);
  });
});
