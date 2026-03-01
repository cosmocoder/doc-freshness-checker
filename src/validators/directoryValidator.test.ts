import fs from 'fs';
import path from 'path';
import { DirectoryValidator } from './directoryValidator.js';
import type { DocFreshnessConfig, Document, Reference } from '../types.js';
import { makeDoc as makeBaseDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';

function makeRef(value: string, overrides: Partial<Reference> = {}): Reference {
  return makeBaseRef('directory-structure', value, overrides);
}

const doc: Document = makeBaseDoc({
  path: 'docs/README.md',
  absolutePath: `${process.cwd()}/docs/README.md`,
});

describe('DirectoryValidator', () => {
  const config: DocFreshnessConfig = {
    rootDir: process.cwd(),
    rules: { 'directory-structure': { enabled: true, severity: 'warning', skipIllustrative: true } },
  };

  it('validates existing directories as valid (from project root)', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('src')], doc, config);
    expect(results[0].valid).toBe(true);
    expect(results[0].foundAt).toBe('src');
  });

  it('validates paths relative to document location', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('../src')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('marks missing paths as invalid', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('nonexistent-dir-xyz')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('not found');
  });

  it('skips illustrative paths when configured', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('YourProject')], doc, config);
    expect(results[0].skipped).toBe(true);
  });

  it('validates illustrative paths when skipIllustrative is false', async () => {
    const validator = new DirectoryValidator();
    const noSkipConfig: DocFreshnessConfig = {
      ...config,
      rules: { 'directory-structure': { enabled: true, severity: 'warning', skipIllustrative: false } },
    };
    const results = await validator.validateBatch([makeRef('YourProject')], doc, noSkipConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('illustrative');
  });

  it('handles extractor-marked illustrative paths', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('example-dir', { isIllustrative: true })], doc, config);
    expect(results[0].skipped).toBe(true);
  });

  it('caches results for repeated path lookups', async () => {
    const validator = new DirectoryValidator();
    await validator.validateBatch([makeRef('src')], doc, config);
    const results = await validator.validateBatch([makeRef('src')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('caches invalid results too', async () => {
    const validator = new DirectoryValidator();
    await validator.validateBatch([makeRef('xyz-missing')], doc, config);
    const results = await validator.validateBatch([makeRef('xyz-missing')], doc, config);
    expect(results[0].valid).toBe(false);
  });

  it('provides suggestions for similar paths (e.g., case mismatch)', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('SRC')], doc, config);
    if (!results[0].valid && results[0].suggestion) {
      expect(results[0].suggestion).toContain('src');
    }
  });

  it('provides suggestions for similar names (similarity ratio)', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('scr')], doc, config);
    if (results[0].suggestion) {
      expect(results[0].suggestion).toBeTruthy();
    }
  });

  it('rejects paths that escape project root', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('../../../../etc/passwd')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('escapes project root');
  });

  it('uses custom illustrative patterns from config', async () => {
    const validator = new DirectoryValidator();
    const customConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'directory-structure': { enabled: true, skipIllustrative: true, illustrativePatterns: ['^custom-example'] } },
    };
    const results = await validator.validateBatch([makeRef('custom-example-dir')], doc, customConfig);
    expect(results[0].skipped).toBe(true);
  });

  it('uses default severity when not configured', async () => {
    const validator = new DirectoryValidator();
    const minConfig: DocFreshnessConfig = { rootDir: process.cwd() };
    const results = await validator.validateBatch([makeRef('nonexistent-abc')], doc, minConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('warning');
  });

  it('returns cached invalid result with correct fields', async () => {
    const validator = new DirectoryValidator();
    await validator.validateBatch([makeRef('xyz-cached-miss')], doc, config);
    const results = await validator.validateBatch([makeRef('xyz-cached-miss')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('not found');
    expect(results[0].severity).toBe('warning');
  });

  it('suggests singular/plural matches', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('src/validator')], doc, config);
    if (!results[0].valid && results[0].suggestion) {
      expect(results[0].suggestion).toBeTruthy();
    }
  });

  it('returns null suggestion when parent dir does not exist', async () => {
    const validator = new DirectoryValidator();
    const results = await validator.validateBatch([makeRef('zzznope/xyzabc123/deep/child')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].suggestion).toBeNull();
  });

  it('reports illustrative not-found path with correct message when skipIllustrative is false', async () => {
    const validator = new DirectoryValidator();
    const noSkipConfig: DocFreshnessConfig = {
      ...config,
      rules: { 'directory-structure': { enabled: true, skipIllustrative: false } },
    };
    const results = await validator.validateBatch([makeRef('ExampleProject/nonexistent-file-zzz.ts')], doc, noSkipConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('illustrative');
  });

  it('handles illustrative path escaping project root', async () => {
    const validator = new DirectoryValidator();
    const noSkipConfig: DocFreshnessConfig = {
      ...config,
      rules: { 'directory-structure': { enabled: true, skipIllustrative: false } },
    };
    const results = await validator.validateBatch([makeRef('../../../../etc/YourProject')], doc, noSkipConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('escapes project root');
  });

  it('does not leak custom illustrative patterns across validations', async () => {
    const validator = new DirectoryValidator();
    const firstConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'directory-structure': { enabled: true, skipIllustrative: true, illustrativePatterns: ['^custom-leak-dir'] } },
    };
    const secondConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'directory-structure': { enabled: true, severity: 'warning', skipIllustrative: false } },
    };

    const first = await validator.validateBatch([makeRef('custom-leak-dir/path')], doc, firstConfig);
    expect(first[0].skipped).toBe(true);

    const second = await validator.validateBatch([makeRef('custom-leak-dir/path')], doc, secondConfig);
    expect(second[0].valid).toBe(false);
    expect(second[0].message).toContain('Directory/file not found:');
  });

  it('does not reuse cache across different document contexts', async () => {
    const validator = new DirectoryValidator();
    const root = path.join(process.cwd(), '.doc-freshness-cache', 'directory-context');
    const docsA = path.join(root, 'docs-a');
    const docsB = path.join(root, 'docs-b');
    await fs.promises.mkdir(docsA, { recursive: true });
    await fs.promises.mkdir(docsB, { recursive: true });
    await fs.promises.writeFile(path.join(docsA, 'target.txt'), 'exists in docs-a only');

    const firstDoc: Document = {
      ...doc,
      path: 'docs-a/readme.md',
      absolutePath: `${root}/docs-a/readme.md`,
    };
    const secondDoc: Document = {
      ...doc,
      path: 'docs-b/readme.md',
      absolutePath: `${root}/docs-b/readme.md`,
    };
    const contextConfig: DocFreshnessConfig = {
      ...config,
      rootDir: root,
    };

    try {
      const first = await validator.validateBatch([makeRef('./target.txt')], firstDoc, contextConfig);
      expect(first[0].valid).toBe(true);

      const second = await validator.validateBatch([makeRef('./target.txt')], secondDoc, contextConfig);
      expect(second[0].valid).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true }).catch(() => {});
    }
  });
});
