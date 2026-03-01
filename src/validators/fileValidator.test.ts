import { FileValidator } from './fileValidator.js';
import type { DocFreshnessConfig, Reference } from '../types.js';
import { makeDoc as makeBaseDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';

function makeRef(value: string, overrides: Partial<Reference> = {}): Reference {
  return makeBaseRef('file-path', value, overrides);
}

function makeDoc(docPath: string = 'docs/README.md') {
  return makeBaseDoc({ path: docPath, absolutePath: `/project/${docPath}` });
}

describe('FileValidator', () => {
  const validator = new FileValidator();
  const config: DocFreshnessConfig = {
    rootDir: process.cwd(),
    rules: { 'file-path': { enabled: true, severity: 'error', skipIllustrative: true } },
  };

  it('validates existing files as valid', async () => {
    const results = await validator.validateBatch([makeRef('../package.json')], makeDoc(), { ...config, rootDir: process.cwd() });
    expect(results[0].valid).toBe(true);
  });

  it('marks missing files as invalid', async () => {
    const results = await validator.validateBatch([makeRef('../nonexistent-xyz.json')], makeDoc(), { ...config, rootDir: process.cwd() });
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('File not found');
  });

  it('skips illustrative paths when configured', async () => {
    const results = await validator.validateBatch([makeRef('YourProject/file.ts')], makeDoc(), config);
    expect(results[0].valid).toBe(true);
    expect(results[0].skipped).toBe(true);
  });

  it('flags illustrative paths when skipIllustrative is false', async () => {
    const noSkipConfig: DocFreshnessConfig = {
      ...config,
      rules: { 'file-path': { enabled: true, severity: 'error', skipIllustrative: false } },
    };
    const results = await validator.validateBatch([makeRef('ExampleFile.ts')], makeDoc(), noSkipConfig);
    expect(results[0].severity).toBe('info');
  });

  it('rejects paths that escape project root', async () => {
    const results = await validator.validateBatch([makeRef('/etc/passwd')], makeDoc(), config);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('escapes project root');
  });

  it('handles pre-marked illustrative references', async () => {
    const results = await validator.validateBatch([makeRef('real-looking-path.ts', { isIllustrative: true })], makeDoc(), config);
    expect(results[0].skipped).toBe(true);
  });

  it('suggests similar files for typos', async () => {
    const results = await validator.validateBatch([makeRef('../package.jso')], makeDoc(), { ...config, rootDir: process.cwd() });
    expect(results[0].valid).toBe(false);
    if (results[0].suggestion) {
      expect(results[0].suggestion).toContain('package.json');
    }
  });

  it('returns null suggestion when file directory does not exist', async () => {
    const results = await validator.validateBatch([makeRef('zzz-nonexistent-dir/some-file.ts')], makeDoc(), {
      ...config,
      rootDir: process.cwd(),
    });
    expect(results[0].valid).toBe(false);
  });

  it('reports illustrative path escaping project root', async () => {
    const noSkipConfig: DocFreshnessConfig = {
      ...config,
      rules: { 'file-path': { enabled: true, severity: 'error', skipIllustrative: false } },
    };
    const results = await validator.validateBatch([makeRef('/etc/YourProject/file.ts')], makeDoc(), noSkipConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('illustrative');
    expect(results[0].message).toContain('escapes project root');
  });

  it('uses custom illustrative patterns from config', async () => {
    const customConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'file-path': { enabled: true, skipIllustrative: true, illustrativePatterns: ['^custom-prefix'] } },
    };
    const validator2 = new FileValidator();
    const results = await validator2.validateBatch([makeRef('custom-prefix-file.ts')], makeDoc(), customConfig);
    expect(results[0].skipped).toBe(true);
  });

  it('caches directory listings for repeated lookups', async () => {
    const validator2 = new FileValidator();
    await validator2.validateBatch([makeRef('../package-typo.json')], makeDoc(), { ...config, rootDir: process.cwd() });
    const results = await validator2.validateBatch([makeRef('../another-typo.json')], makeDoc(), { ...config, rootDir: process.cwd() });
    expect(results[0].valid).toBe(false);
  });

  it('handles absolute paths within project root', async () => {
    const absPath = `${process.cwd()}/package.json`;
    const results = await validator.validateBatch([makeRef(absPath)], makeDoc(), { ...config, rootDir: process.cwd() });
    expect(results[0].valid).toBe(true);
  });

  it('does not leak custom illustrative patterns across validations', async () => {
    const validator2 = new FileValidator();
    const firstConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'file-path': { enabled: true, skipIllustrative: true, illustrativePatterns: ['^custom-leak-test'] } },
    };
    const secondConfig: DocFreshnessConfig = {
      rootDir: process.cwd(),
      rules: { 'file-path': { enabled: true, severity: 'error', skipIllustrative: false } },
    };

    const first = await validator2.validateBatch([makeRef('custom-leak-test-file.ts')], makeDoc(), firstConfig);
    expect(first[0].skipped).toBe(true);

    const second = await validator2.validateBatch([makeRef('custom-leak-test-file.ts')], makeDoc(), secondConfig);
    expect(second[0].valid).toBe(false);
    expect(second[0].message).toContain('File not found:');
  });
});
