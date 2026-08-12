import type { ProjectScores, ValidationResults } from '../types.js';
import { MarkdownReporter } from './markdownReporter.js';

describe('MarkdownReporter', () => {
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
      const report = new MarkdownReporter().generate(results);
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
      expect(() => new MarkdownReporter().generate(results)).toThrow(`${failure} failed`);
      expect(events).toEqual(expected);
      expect(clock).not.toHaveBeenCalled();
    }
    finally {
      clock.mockRestore();
    }
  });

  it('dispatches generateWithScores through an overridden generate method', () => {
    const results: ValidationResults = {
      documents: [],
      summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
    };
    const scores: ProjectScores = {
      projectScore: 100,
      projectGrade: 'A',
      documents: [],
      summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
    };
    class CustomMarkdownReporter extends MarkdownReporter {
      calls: ValidationResults[] = [];

      override generate(input: ValidationResults): string {
        this.calls.push(input);
        return 'custom markdown\n';
      }
    }
    const reporter = new CustomMarkdownReporter();

    expect(reporter.generateWithScores(results, scores)).toMatch(/^custom markdown\n## Freshness Scores/);
    expect(reporter.calls).toEqual([results]);
  });
});
