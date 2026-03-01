import { JsonReporter } from './jsonReporter.js';
import type { ValidationResults } from '../types.js';

describe('JsonReporter', () => {
  const reporter = new JsonReporter();
  const results: ValidationResults = {
    documents: [],
    summary: { total: 3, valid: 3, errors: 0, warnings: 0, skipped: 0 },
  };

  it('generate() returns valid JSON string', () => {
    const output = reporter.generate(results);
    const parsed = JSON.parse(output);
    expect(parsed.summary.total).toBe(3);
  });

  it('generateWithScores() includes scores and timestamp', () => {
    const output = reporter.generateWithScores(results, null);
    const parsed = JSON.parse(output);
    expect(parsed.freshnessScores).toBeNull();
    expect(parsed.generatedAt).toBeDefined();
  });

  it('generateWithScores() includes scores object when provided', () => {
    const scores = {
      projectScore: 90,
      projectGrade: 'A' as const,
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const output = reporter.generateWithScores(results, scores);
    const parsed = JSON.parse(output);
    expect(parsed.freshnessScores.projectScore).toBe(90);
  });
});
