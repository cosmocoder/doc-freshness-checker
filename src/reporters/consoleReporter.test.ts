import { ConsoleReporter } from './consoleReporter.js';
import type { ProjectScores, ValidationResults, VectorMismatch } from '../types.js';
import { captureConsoleLog } from '../test-utils/console.js';

describe('ConsoleReporter', () => {
  const reporter = new ConsoleReporter();

  const cleanResults: ValidationResults = {
    documents: [],
    summary: { total: 5, valid: 5, errors: 0, warnings: 0, skipped: 0 },
  };

  const resultsWithIssues: ValidationResults = {
    documents: [{
      path: 'docs/api.md',
      issues: [
        {
          reference: { type: 'file-path', value: 'missing.ts', lineNumber: 10, raw: 'missing.ts', sourceFile: 'api.md' },
          valid: false, severity: 'error',
          message: 'File not found: missing.ts',
          suggestion: 'Did you mean: missing.tsx?',
        },
        {
          reference: { type: 'external-url', value: 'https://old.com', lineNumber: 20, raw: 'https://old.com', sourceFile: 'api.md' },
          valid: false, severity: 'warning',
          message: 'URL returned 404',
        },
      ],
    }],
    summary: { total: 5, valid: 3, errors: 1, warnings: 1, skipped: 0 },
  };

  it('generate() logs summary and "up to date" for clean results', () => {
    const spy = captureConsoleLog();
    reporter.generate(cleanResults);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('Valid: 5');
    expect(output).toContain('up to date');
  });

  it('generate() logs issues with error and warning icons', () => {
    const spy = captureConsoleLog();
    reporter.generate(resultsWithIssues);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('File not found');
    expect(output).toContain('missing.tsx');
    expect(output).toContain('URL returned 404');
    expect(output).toContain('Line 10');
    expect(output).toContain('Line 20');
  });

  it('generateWithScores() includes freshness scores', () => {
    const spy = captureConsoleLog();
    const scores: ProjectScores = {
      projectScore: 85, projectGrade: 'B',
      documents: [
        { document: 'docs/api.md', totalScore: 85, factors: { referenceValidity: 100, gitTimeDelta: 75, codeChangeFrequency: 75, symbolCoverage: 80 }, grade: 'B' },
      ],
      summary: { total: 1, gradeA: 0, gradeB: 1, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    reporter.generateWithScores(cleanResults, scores);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('85/100');
    expect(output).toContain('Grade: B');
  });

  it('generateWithScores() with null scores skips scores section', () => {
    const spy = captureConsoleLog();
    reporter.generateWithScores(cleanResults, null);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).not.toContain('Freshness Scores');
  });

  it('generateWithScores() shows all grade icons', () => {
    const spy = captureConsoleLog();
    const scores: ProjectScores = {
      projectScore: 70, projectGrade: 'C',
      documents: [
        { document: 'a.md', totalScore: 95, factors: { referenceValidity: 100, gitTimeDelta: 90, codeChangeFrequency: 90, symbolCoverage: 90 }, grade: 'A' },
        { document: 'b.md', totalScore: 85, factors: { referenceValidity: 90, gitTimeDelta: 80, codeChangeFrequency: 80, symbolCoverage: 80 }, grade: 'B' },
        { document: 'c.md', totalScore: 75, factors: { referenceValidity: 80, gitTimeDelta: 70, codeChangeFrequency: 70, symbolCoverage: 70 }, grade: 'C' },
        { document: 'd.md', totalScore: 50, factors: { referenceValidity: 50, gitTimeDelta: 50, codeChangeFrequency: 50, symbolCoverage: 50 }, grade: 'F' },
      ],
      summary: { total: 4, gradeA: 1, gradeB: 1, gradeC: 1, gradeD: 0, gradeF: 1 },
    };
    reporter.generateWithScores(cleanResults, scores);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('🟢');
    expect(output).toContain('🟡');
    expect(output).toContain('🟠');
    expect(output).toContain('🔴');
  });

  it('generateWithScores() shows vector mismatches when present', () => {
    const spy = captureConsoleLog();
    const mismatches: VectorMismatch[] = [{
      docPath: 'docs/api.md', docSection: 'Auth API', docText: 'This function handles auth',
      bestMatchScore: 0.2,
      bestMatch: { type: 'code', path: 'src/db.ts', symbol: 'dbConnect', text: 'DB connect' },
      suggestion: 'Documentation may describe functionality not found in code',
    }];
    const results: ValidationResults = { ...cleanResults, vectorMismatches: mismatches };
    reporter.generateWithScores(results, null);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('Semantic Analysis');
    expect(output).toContain('docs/api.md');
    expect(output).toContain('Auth API');
    expect(output).toContain('src/db.ts');
    expect(output).toContain('20.0%');
  });

  it('generateVectorMismatches handles mismatches without bestMatch', () => {
    const spy = captureConsoleLog();
    const mismatches: VectorMismatch[] = [{
      docPath: 'docs/guide.md', docSection: 'Setup', docText: 'Setup instructions',
      bestMatchScore: 0, bestMatch: null,
      suggestion: 'No matching code found',
    }];
    const results: ValidationResults = { ...cleanResults, vectorMismatches: mismatches };
    reporter.generateWithScores(results, null);
    const output = spy.mock.calls.flat().join('\n');
    expect(output).toContain('docs/guide.md');
    expect(output).not.toContain('Best match:');
  });
});
