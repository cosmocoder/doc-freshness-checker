import { CodePatternValidator } from './codePatternValidator.js';
import type { DocFreshnessConfig, Document, Reference } from '../types.js';

function makeRef(value: string, overrides: Partial<Reference> = {}): Reference {
  return { type: 'code-pattern', value, lineNumber: 1, raw: value, sourceFile: 'doc.md', kind: 'class', language: 'typescript', ...overrides };
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
    const results = await validator.validateBatch(
      [makeRef('CodePatternValidator')],
      doc,
      config
    );
    expect(results[0].valid).toBe(true);
    expect(results[0].foundIn).toBeDefined();
  });

  it('reports missing symbols with suggestions', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch(
      [makeRef('CodePatternValidato')],
      doc,
      config
    );
    expect(results[0].valid).toBe(false);
    expect(results[0].suggestion).toContain('CodePatternValidator');
  });

  it('skips illustrative symbols', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch(
      [makeRef('YourComponent'), makeRef('FooBar')],
      doc,
      config
    );
    expect(results.every((r) => r.skipped)).toBe(true);
  });

  it('skips pre-marked illustrative references', async () => {
    const validator = new CodePatternValidator();
    const results = await validator.validateBatch(
      [makeRef('SomeRealName', { isIllustrative: true })],
      doc,
      config
    );
    expect(results[0].skipped).toBe(true);
  });

  it('exposes source index and source files after building', async () => {
    const validator = new CodePatternValidator();
    await validator.buildSourceIndex(config);
    expect(validator.getSourceIndex()).toBeInstanceOf(Map);
    expect(validator.getSourceFiles()).toBeInstanceOf(Map);
    expect(validator.getSourceIndex()!.size).toBeGreaterThan(0);
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
    const results = await validator.validateBatch(
      [makeRef('ZzzVeryUniqueName12345')],
      doc, config,
    );
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
