import { getRuleSeverity, severityForIllustrative, createIllustrativeSkippedResult } from './validation.js';
import type { DocFreshnessConfig, Reference } from '../types.js';

describe('getRuleSeverity', () => {
  it('returns configured severity when present', () => {
    const config: DocFreshnessConfig = { rules: { 'file-path': { severity: 'warning' } } };
    expect(getRuleSeverity(config, 'file-path', 'error')).toBe('warning');
  });

  it('returns fallback when rule is not configured', () => {
    expect(getRuleSeverity({}, 'file-path', 'error')).toBe('error');
    expect(getRuleSeverity({ rules: {} }, 'missing', 'info')).toBe('info');
  });
});

describe('severityForIllustrative', () => {
  it('downgrades to info for illustrative references', () => {
    expect(severityForIllustrative(true, 'error')).toBe('info');
  });

  it('keeps base severity for non-illustrative references', () => {
    expect(severityForIllustrative(false, 'error')).toBe('error');
    expect(severityForIllustrative(false, 'warning')).toBe('warning');
  });
});

describe('createIllustrativeSkippedResult', () => {
  it('creates a valid skipped result', () => {
    const ref: Reference = { type: 'file-path', value: 'foo.ts', lineNumber: 1, raw: 'foo.ts', sourceFile: 'doc.md' };
    const result = createIllustrativeSkippedResult(ref, 'Skipped');
    expect(result).toEqual({ reference: ref, valid: true, skipped: true, message: 'Skipped' });
  });
});
