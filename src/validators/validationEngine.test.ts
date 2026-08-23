import { ValidationEngine } from './validationEngine.js';
import type { IncrementalInput, IncrementalInputProvider } from './incrementalInputs.js';
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
  readonly incrementalCaptureScope?: 'document' | 'project';
  private results: ValidationResult[];
  private incrementalInputs: IncrementalInput[] | null;
  constructor(
    results: ValidationResult[],
    incrementalInputs: IncrementalInput[] | null = null,
    incrementalCaptureScope?: 'document' | 'project'
  ) {
    this.results = results;
    this.incrementalInputs = incrementalInputs;
    this.incrementalCaptureScope = incrementalCaptureScope;
  }
  async getIncrementalInputs(): Promise<IncrementalInput[] | null> {
    return this.incrementalInputs;
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
    engine.registerValidator('file-path', new StubValidator([{ reference: ref, valid: true }]));

    const results = await engine.validate([makeDoc([ref])]);
    expect(results.summary.total).toBe(1);
    expect(results.summary.valid).toBe(1);
    expect(engine.hadInvalidResults()).toBe(false);
  });

  it('counts valid, error, warning, info, and skipped results independently', async () => {
    const engine = new ValidationEngine(config);
    const refs = [
      makeRef('file-path', 'a.ts'),
      makeRef('file-path', 'b.ts'),
      makeRef('file-path', 'c.ts'),
      makeRef('file-path', 'd.ts'),
      makeRef('file-path', 'e.ts'),
    ];

    engine.registerValidator(
      'file-path',
      new StubValidator([
        { reference: refs[0], valid: true, severity: 'info' },
        { reference: refs[1], valid: false, severity: 'error', message: 'not found' },
        { reference: refs[2], valid: false, severity: 'warning', message: 'stale' },
        { reference: refs[3], valid: false, severity: 'info', message: 'not installed' },
        { reference: refs[4], valid: true, skipped: true },
      ])
    );

    const results = await engine.validate([makeDoc(refs)]);
    expect(results.summary).toEqual({ total: 5, valid: 1, errors: 1, warnings: 1, info: 1, skipped: 1 });
    expect(results.documents).toHaveLength(1);
    expect(results.documents[0].issues).toHaveLength(3);
    expect(engine.hadIncompleteValidation()).toBe(false);
  });

  it('skips disabled rules', async () => {
    const cfg: DocFreshnessConfig = { rules: { 'file-path': { enabled: false } } };
    const engine = new ValidationEngine(cfg);
    engine.registerValidator('file-path', new StubValidator([]));

    const results = await engine.validate([makeDoc([makeRef('file-path', 'a.ts')])]);
    expect(results.summary.skipped).toBe(1);
    expect(results.summary.total).toBe(1);
    expect(engine.hadIncompleteValidation()).toBe(false);
  });

  it('skips references with no registered validator', async () => {
    const engine = new ValidationEngine(config);
    const results = await engine.validate([makeDoc([makeRef('unknown-type', 'val')])]);
    expect(results.summary.skipped).toBe(1);
    expect(engine.hadIncompleteValidation()).toBe(true);

    const ref = makeRef('unknown-type', 'val');
    engine.registerValidator('unknown-type', new StubValidator([{ reference: ref, valid: true }]));
    await engine.validate([makeDoc([ref])]);
    expect(engine.hadIncompleteValidation()).toBe(false);
  });

  it('aggregates captured validator inputs and fails closed without capture support', async () => {
    const engine = new ValidationEngine(config);
    engine.registerValidator('file-path', new StubValidator([], [{ path: '/project/a.ts' }]));
    engine.registerValidator('external-url', new StubValidator([]));

    await expect(engine.captureIncrementalInputs([makeDoc([makeRef('file-path', 'a.ts')])])).resolves.toEqual([{ path: '/project/a.ts' }]);
    await expect(engine.captureIncrementalInputs([makeDoc([makeRef('external-url', 'https://example.com')])])).resolves.toBeNull();
    await expect(engine.captureIncrementalInputs([makeDoc([makeRef('unknown-type', 'value')])])).resolves.toBeNull();
  });

  it('ignores explicitly disabled groups when capturing inputs', async () => {
    const engine = new ValidationEngine({ rules: { 'external-url': { enabled: false } } });
    engine.registerValidator('external-url', new StubValidator([]));

    await expect(engine.captureIncrementalInputs([makeDoc([makeRef('external-url', 'https://example.com')])])).resolves.toEqual([]);
  });

  it('captures project-scoped inputs once and deduplicates them across many documents', async () => {
    let captureCalls = 0;
    const engine = new ValidationEngine({});
    const validator: IncrementalInputProvider = {
      incrementalCaptureScope: 'project',
      async getIncrementalInputs() {
        captureCalls++;
        return [{ path: '/project/source.ts', content: 'source' }];
      },
      async validateBatch() {
        return [];
      },
    };
    engine.registerValidator('code-pattern', validator);
    const documents = Array.from({ length: 20 }, () => makeDoc([makeRef('code-pattern', 'SourceSymbol')]));

    await expect(engine.captureIncrementalInputs(documents)).resolves.toEqual([{ path: '/project/source.ts', content: 'source' }]);
    expect(captureCalls).toBe(1);
  });

  it('captures graph-required project inputs only when graph work is relevant', async () => {
    let captureCalls = 0;
    const validator: IncrementalInputProvider = {
      incrementalCaptureScope: 'project',
      incrementalInputsRequiredForGraph: true,
      async getIncrementalInputs() {
        captureCalls++;
        return [{ path: '/project/source.ts', content: 'source' }];
      },
      async validateBatch() {
        return [];
      },
    };
    const graphEngine = new ValidationEngine({ graph: { enabled: true } });
    graphEngine.registerValidator('code-pattern', validator);
    await expect(graphEngine.captureIncrementalInputs([makeDoc([])])).resolves.toEqual([{ path: '/project/source.ts', content: 'source' }]);
    expect(captureCalls).toBe(1);

    const noGraphEngine = new ValidationEngine({ graph: { enabled: false } });
    noGraphEngine.registerValidator('code-pattern', validator);
    await expect(noGraphEngine.captureIncrementalInputs([makeDoc([])])).resolves.toEqual([]);
    await expect(graphEngine.captureIncrementalInputs([])).resolves.toEqual([]);
    expect(captureCalls).toBe(1);
  });

  it('fails closed on unsupported references before graph-required project capture', async () => {
    let captureCalls = 0;
    const engine = new ValidationEngine({ graph: { enabled: true } });
    const validator: IncrementalInputProvider = {
      incrementalCaptureScope: 'project',
      incrementalInputsRequiredForGraph: true,
      async getIncrementalInputs() {
        captureCalls++;
        return [];
      },
      async validateBatch() {
        return [];
      },
    };
    engine.registerValidator('code-pattern', validator);

    await expect(engine.captureIncrementalInputs([makeDoc([makeRef('unknown-type', 'value')])])).resolves.toBeNull();
    expect(captureCalls).toBe(0);
  });

  it('propagates validator execution failures', async () => {
    const engine = new ValidationEngine({ ...config, verbose: false });
    const failValidator: BaseValidator = {
      async validateBatch() {
        throw new Error('validator crashed');
      },
    };
    engine.registerValidator('file-path', failValidator);

    await expect(engine.validate([makeDoc([makeRef('file-path', 'a.ts')])])).rejects.toThrow('validator crashed');
  });

  it('preserves invalid info-level findings', async () => {
    const engine = new ValidationEngine(config);
    const ref = makeRef('file-path', 'a.ts');
    engine.registerValidator('file-path', new StubValidator([{ reference: ref, valid: false, severity: 'info', message: 'info only' }]));

    const results = await engine.validate([makeDoc([ref])]);
    expect(results.summary.valid).toBe(0);
    expect(results.summary.info).toBe(1);
    expect(results.summary.errors).toBe(0);
    expect(results.documents[0].issues[0].message).toBe('info only');
    expect(engine.hadInvalidResults()).toBe(true);

    engine.registerValidator('file-path', new StubValidator([{ reference: ref, valid: true }]));
    await engine.validate([makeDoc([ref])]);
    expect(engine.hadInvalidResults()).toBe(false);
  });

  it('reports invalid results without a severity as warnings', async () => {
    const engine = new ValidationEngine(config);
    const ref = makeRef('file-path', 'a.ts');
    engine.registerValidator('file-path', new StubValidator([{ reference: ref, valid: false, message: 'invalid result' }]));

    const results = await engine.validate([makeDoc([ref])]);
    expect(results.summary).toMatchObject({ valid: 0, warnings: 1 });
    expect(results.documents[0].issues[0].message).toBe('invalid result');
  });
});
