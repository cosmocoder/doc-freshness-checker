import fs from 'fs';
import os from 'os';
import path from 'path';
import { CodePatternValidator } from './codePatternValidator.js';
import type { DocFreshnessConfig, Document, Reference } from '../types.js';

function makeRef(value: string, overrides: Partial<Reference> = {}): Reference {
  return {
    type: 'code-pattern',
    value,
    lineNumber: 1,
    raw: value,
    sourceFile: 'doc.md',
    kind: 'class',
    language: 'typescript',
    ...overrides,
  };
}

const doc: Document = { path: 'doc.md', absolutePath: '/project/doc.md', content: '', format: 'markdown', lines: [], references: [] };

describe('CodePatternValidator', () => {
  const config: DocFreshnessConfig = {
    rootDir: process.cwd(),
    sourcePatterns: ['src/**/*.ts'],
    rules: { 'code-pattern': { enabled: true, severity: 'warning' } },
  };

  it('finds symbols that exist in source code', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch([makeRef('CodePatternValidator')], doc, config);
    expect(results[0].valid).toBe(true);
    expect(results[0].foundIn).toBeDefined();
  });

  it('reports missing symbols with suggestions', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch([makeRef('CodePatternValidato')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].suggestion).toContain('CodePatternValidator');
  });

  it('skips illustrative symbols', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch([makeRef('YourComponent'), makeRef('FooBar')], doc, config);
    expect(results.every((r) => r.skipped)).toBe(true);
  });

  it('skips pre-marked illustrative references', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch([makeRef('SomeRealName', { isIllustrative: true })], doc, config);
    expect(results[0].skipped).toBe(true);
  });

  it('exposes source index and source files after building', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex(config);
    expect(validator.getSourceIndex()).toBeInstanceOf(Map);
    expect(validator.getSourceFiles()).toBeInstanceOf(Map);
    expect(await validator.getIncrementalInputs([], doc, config)).toBeInstanceOf(Array);
    expect(validator.getSourceIndex()!.size).toBeGreaterThan(0);
  });

  it('owns source glob expansion and exposes matched absolute paths with content', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'code-pattern-source-'));
    try {
      const sourceDir = path.join(rootDir, '.git');
      const sourcePath = path.join(sourceDir, 'source.ts');
      await fs.promises.mkdir(sourceDir);
      await fs.promises.writeFile(sourcePath, 'export const SourceSymbol = true;');
      const validator = new CodePatternValidator();
      const sourceConfig = { rootDir, sourcePatterns: ['.g{it,noop}/**/*.ts'] };

      const captured = await validator.getIncrementalInputs([], doc, sourceConfig);
      expect(captured).toEqual([{ path: sourcePath, content: 'export const SourceSymbol = true;' }]);
      expect(await validator.getIncrementalInputs([], doc, sourceConfig)).toBe(captured);
    }
    finally {
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('marks source inputs unavailable when source discovery fails', async () => {
    const validator = new CodePatternValidator();
    const invalidConfig = { rootDir: process.cwd(), sourcePatterns: [null as unknown as string] };

    expect(await validator.getIncrementalInputs([], doc, invalidConfig)).toBeNull();
  });

  it('marks source inputs unavailable when a matched source file is unreadable', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'code-pattern-unreadable-'));
    const sourceDir = path.join(rootDir, 'src');
    const sourcePath = path.join(sourceDir, 'source.ts');
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(sourcePath, 'export const SourceSymbol = true;');
    const readFile = fs.promises.readFile.bind(fs.promises);
    const readSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation((file, ...args) => {
      if (file === sourcePath) {
        return Promise.reject(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
      }
      return readFile(file, ...args);
    });
    try {
      const validator = new CodePatternValidator();

      await expect(validator.getIncrementalInputs([], doc, { rootDir, sourcePatterns: ['src/**/*.ts'] })).resolves.toBeNull();
    }
    finally {
      readSpy.mockRestore();
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('captures only files for broad source globs', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'code-pattern-broad-'));
    try {
      const sourceDir = path.join(rootDir, 'src', 'nested');
      const sourcePath = path.join(sourceDir, 'source.ts');
      await fs.promises.mkdir(sourceDir, { recursive: true });
      await fs.promises.writeFile(sourcePath, 'export const SourceSymbol = true;');
      const validator = new CodePatternValidator();

      expect(await validator.getIncrementalInputs([], doc, { rootDir, sourcePatterns: ['src/**'] })).toEqual([
        { path: sourcePath, content: 'export const SourceSymbol = true;' },
      ]);
    }
    finally {
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('returns immediately when source index is already built', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex(config);
    const indexBefore = validator.getSourceIndex();
    await validator.buildSourceIndex(config);
    expect(validator.getSourceIndex()).toBe(indexBefore);
  });

  it('defaults to javascript when language is unknown', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex({
      rootDir: process.cwd(),
      sourcePatterns: ['src/**/*.ts'],
    });
    expect(validator.getSourceIndex()).toBeInstanceOf(Map);
  });

  it('reports not-found symbol without suggestion when no similar exists', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch([makeRef('ZzzVeryUniqueName12345')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].suggestion).toBeNull();
    expect(results[0].message).toContain('Code pattern not found');
  });

  it('handles source patterns that match no files', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex({
      rootDir: process.cwd(),
      sourcePatterns: ['nonexistent-dir/**/*.zzz'],
    });
    expect(validator.getSourceIndex()!.size).toBe(0);
  });

  it('auto-detects source patterns when none configured', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex({ rootDir: process.cwd() });
    expect(validator.getSourceIndex()).toBeInstanceOf(Map);
  });
});
