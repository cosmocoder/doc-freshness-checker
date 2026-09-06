import fs from 'fs';
import os from 'os';
import path from 'path';
import { SourceIndex } from './sourceIndex.js';
import { createSourceValidators } from './sourceValidators.js';
import type { DocFreshnessConfig } from '../types.js';
import type { SourceIndexSnapshot } from './sourceIndex.js';

async function withSources(files: Record<string, string>, run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-source-index-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const absolutePath = path.join(rootDir, relativePath);
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, content, 'utf-8');
    }
    await run(rootDir);
  }
  finally {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  }
}

async function loadBoth(index: SourceIndex, config: DocFreshnessConfig): Promise<SourceIndexSnapshot> {
  const [pattern, snippet] = await Promise.all([index.load(config, 'pattern'), index.load(config, 'snippet')]);
  expect(snippet).toBe(pattern);
  return pattern;
}

describe('SourceIndex', () => {
  it('preserves the distinct fallback languages used by pattern and snippet scans', async () => {
    await withSources(
      {
        'src/a.js': 'class JsClass {}',
        'src/a.jsx': 'class JsxClass {}',
        'src/a.mjs': 'class MjsClass {}',
        'src/a.cjs': 'class CjsClass {}',
        'src/a.ts': 'interface TsType {}',
        'src/a.tsx': 'interface TsxType {}',
        'src/a.py': 'class PythonClass:',
        'src/a.go': 'type GoType struct {}',
        'src/a.rs': 'struct RustType {}',
        'src/A.java': 'class JavaType {}',
      },
      async (rootDir) => {
        const snapshot = await loadBoth(new SourceIndex(), { rootDir });
        expect(Array.from(snapshot.patternFiles.values()).map((file) => file.language)).toEqual(
          expect.arrayContaining(['javascript', 'typescript', 'python', 'go', 'rust', 'java'])
        );
        expect(snapshot.patternFiles.size).toBe(10);
        expect(snapshot.snippetFiles.size).toBe(6);
        expect(snapshot.snippetFiles.has('src/a.mjs')).toBe(false);
        expect(snapshot.snippetFiles.has('src/a.rs')).toBe(false);
      }
    );
  });

  it('labels explicitly configured unknown files as javascript in both views', async () => {
    await withSources({ 'src/custom.weird': 'export function odd() {}' }, async (rootDir) => {
      const snapshot = await loadBoth(new SourceIndex(), { rootDir, sourcePatterns: ['**/*.weird'] });
      expect(snapshot.patternFiles.get('src/custom.weird')?.language).toBe('javascript');
      expect(snapshot.snippetFiles.get('src/custom.weird')?.language).toBe('javascript');
      expect(snapshot.symbols.get('odd')).toHaveLength(2);
      expect(snapshot.functionSignatures.get('odd')).toHaveLength(1);
    });
  });

  it("starts only the requested view and performs only that view's reads", async () => {
    await withSources({ 'src/api.ts': 'class TypeScript {}', 'src/api.rs': 'struct Rust {}' }, async (rootDir) => {
      const readFile = vi.spyOn(fs.promises, 'readFile');
      try {
        const pattern = await new SourceIndex().load({ rootDir }, 'pattern');
        expect(pattern.patternFiles.size).toBe(2);
        expect(pattern.snippetFiles.size).toBe(0);
        expect(readFile).toHaveBeenCalledTimes(2);

        readFile.mockClear();
        const snippet = await new SourceIndex().load({ rootDir }, 'snippet');
        expect(snippet.patternFiles.size).toBe(0);
        expect(snippet.snippetFiles.has('src/api.ts')).toBe(true);
        expect(snippet.snippetFiles.has('src/api.rs')).toBe(false);
        expect(readFile).toHaveBeenCalledTimes(1);
      }
      finally {
        readFile.mockRestore();
      }
    });
  });

  it('preserves view-specific ignores and does not consume general config excludes', async () => {
    await withSources(
      {
        'src/kept.ts': 'class Kept {}',
        'dist/generated.ts': 'class DistOnly {}',
        'build/generated.ts': 'class BuildOnly {}',
        'src/ignored-by-config.ts': 'class ConfigStillIncluded {}',
        'src/ignored.test.ts': 'class TestIgnored {}',
        'src/ignored.spec.ts': 'class SpecIgnored {}',
        'src/types.d.ts': 'class DeclarationIgnored {}',
        'node_modules/pkg/index.ts': 'class DependencyIgnored {}',
        'vendor/pkg.ts': 'class VendorIgnored {}',
      },
      async (rootDir) => {
        const fallback = await loadBoth(new SourceIndex(), { rootDir });
        expect(fallback.patternFiles.has('dist/generated.ts')).toBe(true);
        expect(fallback.patternFiles.has('build/generated.ts')).toBe(true);
        expect(fallback.snippetFiles.has('dist/generated.ts')).toBe(false);
        expect(fallback.snippetFiles.has('build/generated.ts')).toBe(false);

        const broad = await loadBoth(new SourceIndex(), {
          rootDir,
          sourcePatterns: ['**/*'],
          exclude: ['src/ignored-by-config.ts'],
          ignorePatterns: ['src/ignored-by-config.ts'],
        });
        expect(broad.patternFiles.has('src/ignored-by-config.ts')).toBe(true);
        expect(broad.snippetFiles.has('src/ignored-by-config.ts')).toBe(true);
        expect(broad.patternFiles.has('src/ignored.test.ts')).toBe(false);
        expect(broad.patternFiles.has('src/ignored.spec.ts')).toBe(false);
        expect(broad.patternFiles.has('src/types.d.ts')).toBe(false);
        expect(broad.patternFiles.has('node_modules/pkg/index.ts')).toBe(false);
        expect(broad.patternFiles.has('vendor/pkg.ts')).toBe(false);
      }
    );
  });

  it('swallows unreadable matches and invalid patterns without aborting later patterns', async () => {
    await withSources({ 'src/good.ts': 'class Good {}' }, async (rootDir) => {
      const snapshot = await loadBoth(new SourceIndex(), { rootDir, sourcePatterns: ['src', '[', 'src/*.ts'] });
      expect(snapshot.symbols.has('Good')).toBe(true);
      expect(snapshot.patternFiles.has('src')).toBe(false);
      expect(snapshot.snippetFiles.has('src')).toBe(false);
    });
  });

  it('indexes every configured occurrence in order but reads each absolute file once', async () => {
    await withSources(
      {
        'src/a.ts': 'export function Shared() {}',
        'src/b.ts': 'export function Shared() {}',
      },
      async (rootDir) => {
        const readFile = vi.spyOn(fs.promises, 'readFile');
        try {
          const snapshot = await loadBoth(new SourceIndex(), {
            rootDir,
            sourcePatterns: ['src/b.ts', 'src/a.ts', 'src/b.ts'],
          });
          expect(snapshot.symbols.get('Shared')?.map(({ filePath }) => filePath)).toEqual([
            'src/b.ts',
            'src/b.ts',
            'src/a.ts',
            'src/a.ts',
            'src/b.ts',
            'src/b.ts',
          ]);
          expect(snapshot.functionSignatures.get('Shared')?.map(({ filePath }) => filePath)).toEqual(['src/b.ts', 'src/a.ts', 'src/b.ts']);
          expect(readFile).toHaveBeenCalledTimes(2);
        }
        finally {
          readFile.mockRestore();
        }
      }
    );
  });

  it('preserves signature, key, and export extraction quirks', async () => {
    await withSources(
      {
        'src/api.ts': [
          'export function calculate(required: Map<string, number>, optional?: string, ...rest: unknown[]) {}',
          'export const arrow = (first: string, second = "x") => first;',
          'export interface Config {',
          '  readonly first?: string;',
          '  nested: {',
          '    ignored: string;',
          '  };',
          '}',
          'export type Config = { second: number };',
          'const Internal = 1;',
          'export { Internal as Public };',
          'export default function Named() {}',
          'module.exports = { common, alias: value };',
        ].join('\n'),
        'src/api.py': [
          'def method(self, required, optional=1, *args): pass',
          'def public_fn(): pass',
          'def _private(): pass',
          'Public = 1',
        ].join('\n'),
      },
      async (rootDir) => {
        const snapshot = await loadBoth(new SourceIndex(), { rootDir, sourcePatterns: ['src/*'] });
        expect(snapshot.symbols.get('calculate')).toHaveLength(2);
        expect(snapshot.functionSignatures.get('calculate')).toEqual([
          { params: ['required', 'optional', 'rest'], requiredParams: 1, filePath: 'src/api.ts' },
        ]);
        expect(snapshot.functionSignatures.get('arrow')).toEqual([
          { params: ['first', 'second'], requiredParams: 1, filePath: 'src/api.ts' },
        ]);
        expect(snapshot.functionSignatures.get('method')).toEqual([
          { params: ['required', 'optional', 'args'], requiredParams: 1, filePath: 'src/api.py' },
        ]);
        expect(snapshot.interfaceKeys.get('Config')).toEqual(new Set(['first', 'nested', 'second']));
        expect(snapshot.exportsByFile.get('src/api.ts')).toEqual(
          new Set(['calculate', 'arrow', 'Config', 'Named', 'Internal', 'default', 'common', 'alias'])
        );
        expect(snapshot.exportsByFile.get('src/api.ts')?.has('Public')).toBe(false);
        expect(snapshot.exportsByFile.get('src/api.py')).toEqual(new Set(['method', 'public_fn', 'Public']));
      }
    );
  });

  it('memoizes the in-flight load and lets the first config win', async () => {
    await withSources({ 'a.ts': 'class FirstRoot {}' }, async (firstRoot) => {
      await withSources({ 'b.ts': 'class SecondRoot {}' }, async (secondRoot) => {
        const index = new SourceIndex();
        const first = index.load({ rootDir: firstRoot, sourcePatterns: ['*.ts'] }, 'pattern');
        const second = index.load({ rootDir: secondRoot, sourcePatterns: ['*.ts'] }, 'pattern');
        expect(second).toBe(first);
        const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
        expect(secondSnapshot).toBe(firstSnapshot);
        expect(firstSnapshot.symbols.has('FirstRoot')).toBe(true);
        expect(firstSnapshot.symbols.has('SecondRoot')).toBe(false);
        const snippet = await index.load({ rootDir: secondRoot, sourcePatterns: ['*.ts'] }, 'snippet');
        expect(snippet.snippetFiles.has('a.ts')).toBe(true);
        expect(snippet.snippetFiles.has('b.ts')).toBe(false);
      });
    });
  });

  it('keeps successful empty loads sticky and recovers to empty maps after a rejected first load', async () => {
    await withSources({ 'a.ts': 'class Later {}' }, async (rootDir) => {
      const emptyIndex = new SourceIndex();
      const empty = await emptyIndex.load({ rootDir, sourcePatterns: [] }, 'pattern');
      expect(empty.symbols.size).toBe(0);
      expect(await emptyIndex.load({ rootDir, sourcePatterns: ['*.ts'] }, 'pattern')).toBe(empty);

      const rejectedIndex = new SourceIndex();
      const error = new Error('bad config');
      const badConfig = Object.defineProperty({ rootDir }, 'sourcePatterns', {
        get: () => {
          throw error;
        },
      }) as DocFreshnessConfig;
      const rejected = rejectedIndex.load(badConfig, 'pattern');
      const concurrent = rejectedIndex.load({ rootDir, sourcePatterns: ['*.ts'] }, 'pattern');
      expect(concurrent).toBe(rejected);
      await expect(Promise.all([rejected, concurrent])).rejects.toBe(error);
      const recovered = await rejectedIndex.load({ rootDir, sourcePatterns: ['*.ts'] }, 'pattern');
      expect(recovered.patternFiles.size).toBe(0);
      expect(recovered.symbols.size).toBe(0);
    });
  });

  it('leaves validator getters initialized after each view rejects once', async () => {
    await withSources({ 'src/api.ts': 'class Later {}' }, async (rootDir) => {
      const error = new Error('bad config');
      const badConfig = Object.defineProperty({ rootDir }, 'sourcePatterns', {
        get: () => {
          throw error;
        },
      }) as DocFreshnessConfig;
      const goodConfig = { rootDir, sourcePatterns: ['src/*.ts'] };
      const index = new SourceIndex();
      const { pattern, snippet } = createSourceValidators(index);

      await expect(pattern.buildSourceIndex(badConfig)).rejects.toBe(error);
      expect(pattern.getSourceIndex()).toEqual(new Map());
      expect(pattern.getSourceFiles()).toEqual(new Map());
      await expect(pattern.buildSourceIndex(goodConfig)).resolves.toBeUndefined();

      await expect(snippet.validateBatch([], {} as never, badConfig)).rejects.toBe(error);
      expect(snippet.getFunctionSignatures()).toEqual(new Map());
      expect(snippet.getInterfaceKeys()).toEqual(new Map());
      await expect(snippet.validateBatch([], {} as never, goodConfig)).resolves.toEqual([]);
    });
  });

  it('keeps validator state null until build and then shares stable snapshot maps', async () => {
    await withSources({ 'src/api.ts': 'export function real() {}\ninterface Config { key: string }' }, async (rootDir) => {
      const index = new SourceIndex();
      const { pattern, snippet } = createSourceValidators(index);
      expect(pattern.getSourceIndex()).toBeNull();
      expect(pattern.getSourceFiles()).toBeNull();
      expect(snippet.getFunctionSignatures()).toBeNull();
      expect(snippet.getInterfaceKeys()).toBeNull();

      const config = { rootDir, sourcePatterns: ['src/*.ts'] };
      await pattern.buildSourceIndex(config);
      await snippet.validateBatch([], {} as never, config);
      const snapshot = await index.load(config, 'pattern');
      expect(pattern.getSourceIndex()).toBe(snapshot.symbols);
      expect(pattern.getSourceFiles()).toBe(snapshot.patternFiles);
      expect(snippet.getFunctionSignatures()).toBe(snapshot.functionSignatures);
      expect(snippet.getInterfaceKeys()).toBe(snapshot.interfaceKeys);
    });
  });
});
