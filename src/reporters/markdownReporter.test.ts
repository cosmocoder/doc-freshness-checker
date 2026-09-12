import type { ProjectScores, ValidationResults } from '../types.js';
import { MarkdownReporter } from './markdownReporter.js';

describe('MarkdownReporter', () => {
  const reporter = new MarkdownReporter();
  const cleanResults: ValidationResults = {
    documents: [],
    summary: { total: 2, valid: 2, errors: 0, warnings: 0, skipped: 0 },
  };
  const resultsWithIssues: ValidationResults = {
    documents: [
      {
        path: 'docs/api.md',
        issues: [
          {
            reference: { type: 'file-path', value: 'missing.ts', lineNumber: 10, raw: 'missing.ts', sourceFile: 'api.md' },
            valid: false,
            severity: 'error',
            message: 'File not found: missing.ts',
            suggestion: 'Did you mean: missing.tsx?',
          },
          {
            reference: { type: 'external-url', value: 'https://old.com', lineNumber: 20, raw: 'https://old.com', sourceFile: 'api.md' },
            valid: false,
            severity: 'warning',
            message: 'URL returned 404',
          },
          {
            reference: { type: 'dependency', value: 'missing-pkg', lineNumber: 30, raw: 'missing-pkg', sourceFile: 'api.md' },
            valid: false,
            severity: 'info',
            message: 'Package not found',
          },
        ],
      },
    ],
    summary: { total: 3, valid: 0, errors: 1, warnings: 1, info: 1, skipped: 0 },
  };

  it('generates markdown with summary table', () => {
    const markdown = reporter.generate(cleanResults);
    expect(markdown).toContain('# Documentation Freshness Report');
    expect(markdown).toContain('Total Checked | 2');
    expect(markdown).toContain('Info | 0');
    expect(markdown).toContain('up to date');
  });

  it('generates issues table with error, warning, and info severities', () => {
    const markdown = reporter.generate(resultsWithIssues);
    expect(markdown).toContain('## Issues');
    expect(markdown).toContain('docs/api.md');
    expect(markdown).toContain('❌ Error');
    expect(markdown).toContain('⚠️ Warning');
    expect(markdown).toContain('| 30 | ℹ️ Info |');
    expect(markdown).toContain('File not found');
    expect(markdown).toContain('missing.tsx');
    expect(markdown).toContain('URL returned 404');
  });

  it('escapes pipe characters and uses "-" for missing suggestions', () => {
    const results: ValidationResults = {
      documents: [
        {
          path: 'doc.md',
          issues: [
            {
              reference: { type: 'file-path', value: 'x', lineNumber: 1, raw: 'x', sourceFile: 'doc.md' },
              valid: false,
              severity: 'error',
              message: 'Path with | pipe',
            },
          ],
        },
      ],
      summary: { total: 1, valid: 0, errors: 1, warnings: 0, skipped: 0 },
    };
    expect(reporter.generate(results)).toMatch(/Path with \\| pipe \| -/);
  });

  it('includes vector mismatches once after scores without a success message', () => {
    const results: ValidationResults = {
      ...cleanResults,
      vectorMismatches: [
        {
          docPath: 'docs/vector-api.md',
          docSection: 'Vector API',
          docText: 'The API returns a vector',
          bestMatchScore: 0.2,
          bestMatch: { type: 'code', path: 'src/vector.ts', symbol: 'search', text: 'search implementation' },
          suggestion: 'Update the API documentation',
        },
      ],
    };
    const scores: ProjectScores = {
      projectScore: 100,
      projectGrade: 'A',
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };

    const markdown = reporter.generate(results);
    expect(markdown).not.toContain('up to date');
    expect(markdown.match(/docs\/vector-api\.md/g)).toHaveLength(1);
    const scored = reporter.generateWithScores(results, scores);
    expect(scored.indexOf('Freshness Scores')).toBeLessThan(scored.indexOf('Semantic Analysis'));
    expect(scored.match(/docs\/vector-api\.md/g)).toHaveLength(1);
  });

  it('generates populated and null freshness score modes', () => {
    const scores: ProjectScores = {
      projectScore: 92,
      projectGrade: 'A',
      documents: [
        {
          document: 'docs/api.md',
          totalScore: 92,
          factors: { referenceValidity: 100, gitTimeDelta: 90, codeChangeFrequency: 80, symbolCoverage: 90 },
          grade: 'A',
        },
      ],
      summary: { total: 1, gradeA: 1, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    const markdown = reporter.generateWithScores(cleanResults, scores);
    expect(markdown).toContain('92/100');
    expect(markdown).toContain('Grade: A');
    expect(reporter.generateWithScores(cleanResults, null)).not.toContain('Freshness Scores');
  });

  it('captures summary then documents before the clock and retains those references', () => {
    const events: string[] = [];
    const summary = { total: 1, valid: 0, errors: 1, warnings: 0, skipped: 0 };
    const documents: ValidationResults['documents'] = [];
    let currentSummary = summary;
    let currentDocuments = documents;
    const results: ValidationResults = {
      get summary() {
        events.push('summary');
        return currentSummary;
      },
      set summary(value) {
        currentSummary = value;
      },
      get documents() {
        events.push('documents');
        return currentDocuments;
      },
      set documents(value) {
        currentDocuments = value;
      },
    };
    const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
      events.push('clock');
      summary.total = 7;
      documents.push({
        path: 'docs/captured.md',
        issues: [
          {
            reference: { type: 'file-path', value: 'x', lineNumber: 1, raw: 'x', sourceFile: 'captured.md' },
            valid: false,
            severity: 'error',
            message: 'captured issue',
          },
        ],
      });
      results.summary = { total: 99, valid: 99, errors: 0, warnings: 0, skipped: 0 };
      results.documents = [];
      return '2025-01-02T03:04:05.678Z';
    });

    try {
      const report = reporter.generate(results);
      expect(events).toEqual(['summary', 'documents', 'clock']);
      expect(report).toContain('| Total Checked | 7 |');
      expect(report).toContain('docs/captured.md');
      expect(report).not.toContain('| Total Checked | 99 |');
    }
    finally {
      clock.mockRestore();
    }
  });

  it.each([
    { failure: 'summary', expected: ['summary'] },
    { failure: 'documents', expected: ['summary', 'documents'] },
  ] as const)('does not read the clock after a throwing $failure getter', ({ failure, expected }) => {
    const events: string[] = [];
    const results: ValidationResults = {
      get summary() {
        events.push('summary');
        if (failure === 'summary') {
          throw new Error('summary failed');
        }
        return { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 };
      },
      get documents(): ValidationResults['documents'] {
        events.push('documents');
        throw new Error('documents failed');
      },
    };
    const clock = vi.spyOn(Date.prototype, 'toISOString');

    try {
      expect(() => reporter.generate(results)).toThrow(`${failure} failed`);
      expect(events).toEqual(expected);
      expect(clock).not.toHaveBeenCalled();
    }
    finally {
      clock.mockRestore();
    }
  });
});
