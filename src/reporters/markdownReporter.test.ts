import { MarkdownReporter } from './markdownReporter.js';
import type { ProjectScores, ValidationResults } from '../types.js';

describe('MarkdownReporter', () => {
  const reporter = new MarkdownReporter();

  const cleanResults: ValidationResults = {
    documents: [],
    summary: { total: 2, valid: 2, errors: 0, warnings: 0, skipped: 0 },
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
    summary: { total: 2, valid: 0, errors: 1, warnings: 1, skipped: 0 },
  };

  it('generates markdown with summary table', () => {
    const md = reporter.generate(cleanResults);
    expect(md).toContain('# Documentation Freshness Report');
    expect(md).toContain('Total Checked | 2');
    expect(md).toContain('up to date');
  });

  it('generates issues table with error and warning severities', () => {
    const md = reporter.generate(resultsWithIssues);
    expect(md).toContain('## Issues');
    expect(md).toContain('docs/api.md');
    expect(md).toContain('❌ Error');
    expect(md).toContain('⚠️ Warning');
    expect(md).toContain('File not found');
    expect(md).toContain('missing.tsx');
    expect(md).toContain('URL returned 404');
  });

  it('escapes pipe characters in messages', () => {
    const results: ValidationResults = {
      documents: [{
        path: 'doc.md',
        issues: [{
          reference: { type: 'file-path', value: 'x', lineNumber: 1, raw: 'x', sourceFile: 'doc.md' },
          valid: false, severity: 'error',
          message: 'Path with | pipe',
        }],
      }],
      summary: { total: 1, valid: 0, errors: 1, warnings: 0, skipped: 0 },
    };
    expect(reporter.generate(results)).toContain('Path with \\| pipe');
  });

  it('uses "-" for missing suggestions', () => {
    const results: ValidationResults = {
      documents: [{
        path: 'doc.md',
        issues: [{
          reference: { type: 'file-path', value: 'x', lineNumber: 1, raw: 'x', sourceFile: 'doc.md' },
          valid: false, severity: 'error',
          message: 'Not found',
        }],
      }],
      summary: { total: 1, valid: 0, errors: 1, warnings: 0, skipped: 0 },
    };
    const md = reporter.generate(results);
    expect(md).toMatch(/Not found \| -/);
  });

  it('generateWithScores includes freshness section', () => {
    const scores: ProjectScores = {
      projectScore: 92, projectGrade: 'A',
      documents: [{ document: 'docs/api.md', totalScore: 92, factors: { referenceValidity: 100, gitTimeDelta: 90, codeChangeFrequency: 80, symbolCoverage: 90 }, grade: 'A' }],
      summary: { total: 1, gradeA: 1, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const md = reporter.generateWithScores(cleanResults, scores);
    expect(md).toContain('## Freshness Scores');
    expect(md).toContain('92/100');
    expect(md).toContain('Grade: A');
  });

  it('generateWithScores with null scores omits section', () => {
    const md = reporter.generateWithScores(cleanResults, null);
    expect(md).not.toContain('Freshness Scores');
  });

  it('generates per-document score table', () => {
    const scores: ProjectScores = {
      projectScore: 85, projectGrade: 'B',
      documents: [
        { document: 'a.md', totalScore: 90, factors: { referenceValidity: 100, gitTimeDelta: 80, codeChangeFrequency: 80, symbolCoverage: 90 }, grade: 'A' },
        { document: 'b.md', totalScore: 70, factors: { referenceValidity: 70, gitTimeDelta: 70, codeChangeFrequency: 70, symbolCoverage: 70 }, grade: 'C' },
      ],
      summary: { total: 2, gradeA: 1, gradeB: 0, gradeC: 1, gradeD: 0, gradeF: 0 },
    };
    const md = reporter.generateWithScores(cleanResults, scores);
    expect(md).toContain('a.md');
    expect(md).toContain('90/100');
    expect(md).toContain('b.md');
    expect(md).toContain('70/100');
  });
});
