import type { ProjectScores, ValidationResults } from '../types.js';
import { JsonReporter } from './jsonReporter.js';

describe('JsonReporter', () => {
  const reporter = new JsonReporter();
  const results: ValidationResults = {
    documents: [
      {
        path: 'README.md',
        issues: [
          {
            reference: { type: 'dependency', value: 'missing-pkg', lineNumber: 1, raw: 'missing-pkg', sourceFile: 'README.md' },
            valid: false,
            severity: 'info',
            message: 'Package not found',
          },
        ],
      },
    ],
    summary: { total: 3, valid: 2, errors: 0, warnings: 0, info: 1, skipped: 0 },
  };

  it('generate() returns valid JSON string', () => {
    const output = reporter.generate(results);
    const parsed = JSON.parse(output);
    expect(parsed.summary.total).toBe(3);
    expect(parsed.summary.info).toBe(1);
    expect(parsed.documents[0].issues[0].severity).toBe('info');
  });

  it('preserves scored result fields captured before reading the clock', () => {
    const extendedResults = { ...results, extra: 'before' };
    const scores: ProjectScores = {
      projectScore: 100,
      projectGrade: 'A',
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      extendedResults.extra = 'after';
      return '2025-01-02T03:04:05.678Z';
    });

    const output = JSON.parse(new JsonReporter().generateWithScores(extendedResults, scores));

    expect(output.extra).toBe('before');
    expect(output.freshnessScores).toEqual(scores);
    expect(output.generatedAt).toBe('2025-01-02T03:04:05.678Z');
    clock.mockRestore();
  });

  it('does not read the clock when scored result spreading fails', () => {
    const proxiedResults = new Proxy(results, {
      get(_target, property) {
        if (property === 'documents') {
          throw new Error('result getter failed');
        }
        return Reflect.get(results, property);
      },
    });
    const clock = vi.spyOn(Date.prototype, 'toISOString');

    expect(() => new JsonReporter().generateWithScores(proxiedResults, null)).toThrow('result getter failed');
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it.each([
    ['generate', (legacyResults: ValidationResults) => reporter.generate(legacyResults)],
    ['generateWithScores', (legacyResults: ValidationResults) => reporter.generateWithScores(legacyResults, null)],
  ])('%s normalizes legacy results without mutating them', (_name, generate) => {
    const legacyResults: ValidationResults = {
      ...results,
      summary: {
        total: results.summary.total,
        valid: results.summary.valid,
        errors: results.summary.errors,
        warnings: results.summary.warnings,
        skipped: results.summary.skipped,
      },
    };
    const output = generate(legacyResults);

    expect(JSON.parse(output).summary.info).toBe(0);
    expect(legacyResults.summary.info).toBeUndefined();
  });
});
