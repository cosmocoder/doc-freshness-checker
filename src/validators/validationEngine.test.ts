import { ValidationEngine } from './validationEngine.js';
import type { BaseValidator, DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

function makeDoc(refs: Reference[]): Document {
  return {
    path: 'docs/test.md',
    absolutePath: '/project/docs/test.md',
    content: '',
    format: 'markdown',
    lines: [],
    references: refs,
  };
}

function makeRef(type: string, value: string): Reference {
  return { type, value, lineNumber: 1, raw: value, sourceFile: 'test.md' };
}

class StubValidator implements BaseValidator {
  private results: ValidationResult[];
  constructor(results: ValidationResult[]) {
    this.results = results;
  }
  async validateBatch(): Promise<ValidationResult[]> {
    return this.results;
  }
}

describe('ValidationEngine', () => {
  const config: DocFreshnessConfig = { rules: { 'file-path': { enabled: true, severity: 'error' } } };

  it('validates references using registered validators', async () => {
    const engine = new ValidationEngine(config);
    const ref = makeRef('file-path', './file.ts');
    engine.registerValidator('file-path', new StubValidator([
      { reference: ref, valid: true },
    ]));

    const results = await engine.validate([makeDoc([ref])]);
    expect(results.summary.total).toBe(1);
    expect(results.summary.valid).toBe(1);
  });

  it('counts errors, warnings, and skipped correctly', async () => {
    const engine = new ValidationEngine(config);
    const refs = [
      makeRef('file-path', 'a.ts'),
      makeRef('file-path', 'b.ts'),
      makeRef('file-path', 'c.ts'),
      makeRef('file-path', 'd.ts'),
    ];

    engine.registerValidator('file-path', new StubValidator([
      { reference: refs[0], valid: true },
      { reference: refs[1], valid: false, severity: 'error', message: 'not found' },
      { reference: refs[2], valid: false, severity: 'warning', message: 'stale' },
      { reference: refs[3], valid: true, skipped: true },
    ]));

    const results = await engine.validate([makeDoc(refs)]);
    expect(results.summary).toMatchObject({ total: 4, valid: 1, errors: 1, warnings: 1, skipped: 1 });
    expect(results.documents).toHaveLength(1);
    expect(results.documents[0].issues).toHaveLength(2);
  });

  it('skips disabled rules', async () => {
    const cfg: DocFreshnessConfig = { rules: { 'file-path': { enabled: false } } };
    const engine = new ValidationEngine(cfg);
    engine.registerValidator('file-path', new StubValidator([]));

    const results = await engine.validate([makeDoc([makeRef('file-path', 'a.ts')])]);
    expect(results.summary.skipped).toBe(1);
    expect(results.summary.total).toBe(1);
  });

  it('skips references with no registered validator', async () => {
    const engine = new ValidationEngine(config);
    const results = await engine.validate([makeDoc([makeRef('unknown-type', 'val')])]);
    expect(results.summary.skipped).toBe(1);
  });

  it('handles validator errors gracefully', async () => {
    const engine = new ValidationEngine({ ...config, verbose: false });
    const failValidator: BaseValidator = {
      async validateBatch() { throw new Error('validator crashed'); },
    };
    engine.registerValidator('file-path', failValidator);

    const results = await engine.validate([makeDoc([makeRef('file-path', 'a.ts')])]);
    expect(results.summary.skipped).toBe(1);
  });

  it('treats info-level issues as valid', async () => {
    const engine = new ValidationEngine(config);
    const ref = makeRef('file-path', 'a.ts');
    engine.registerValidator('file-path', new StubValidator([
      { reference: ref, valid: false, severity: 'info', message: 'info only' },
    ]));

    const results = await engine.validate([makeDoc([ref])]);
    expect(results.summary.valid).toBe(1);
    expect(results.summary.errors).toBe(0);
    expect(results.documents).toHaveLength(0);
  });
});
