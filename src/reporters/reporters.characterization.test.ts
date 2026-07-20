import { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import { captureConsoleLog } from '../test-utils/console.js';
import type { ProjectScores, Reference, ValidationResults } from '../types.js';
import { ConsoleReporter } from './consoleReporter.js';
import { EnhancedReporter } from './enhancedReporter.js';
import { JsonReporter } from './jsonReporter.js';
import { MarkdownReporter } from './markdownReporter.js';

const generatedAt = '2025-01-02T03:04:05.678Z';
const reference = (type: Reference['type'], lineNumber: number): Reference => ({
  type,
  value: 'value',
  lineNumber,
  raw: 'value',
  sourceFile: 'api.md',
});
const cleanResults: ValidationResults = {
  documents: [],
  summary: { total: 2, valid: 2, errors: 0, warnings: 0, skipped: 0 },
};
const issueResults: ValidationResults = {
  documents: [
    {
      path: 'docs/api.md',
      issues: [
        { reference: reference('file-path', 4), valid: false, severity: 'error', message: 'Missing | file', suggestion: 'Try | next' },
        { reference: reference('external-url', 8), valid: false, severity: 'warning', message: 'Old URL' },
        { reference: reference('dependency', 12), valid: false, severity: 'info', message: '', suggestion: null },
      ],
    },
  ],
  summary: { total: 3, valid: 0, errors: 1, warnings: 2, skipped: 0 },
  vectorMismatches: [
    {
      docPath: 'docs/api.md',
      docSection: 'Usage',
      docText: 'Example',
      bestMatchScore: 0.125,
      bestMatch: null,
      suggestion: 'Review this section',
    },
  ],
};
const scores: ProjectScores = {
  projectScore: 85,
  projectGrade: 'B',
  documents: [
    {
      document: 'docs/api.md',
      totalScore: 85,
      factors: { referenceValidity: 100, gitTimeDelta: 80, codeChangeFrequency: 75, symbolCoverage: 85 },
      grade: 'B',
    },
  ],
  summary: { total: 1, gradeA: 0, gradeB: 1, gradeC: 0, gradeD: 0, gradeF: 0 },
};

describe('reporter output compatibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(generatedAt));
  });
  afterEach(() => vi.useRealTimers());

  it('preserves Console chunks, fallbacks, blank lines, and vector output', () => {
    const log = captureConsoleLog();
    const reporter = new ConsoleReporter();
    reporter.generate(issueResults);
    expect(log.mock.calls).toEqual(
      [
        '\n📚 Documentation Freshness Report\n',
        '━'.repeat(50),
        '\n📊 Summary:',
        '   Total references checked: 3',
        '   ✅ Valid: 0',
        '   ❌ Errors: 1',
        '   ⚠️  Warnings: 2',
        '   ⏭️  Skipped: 0',
        '\n📋 Issues by Document:\n',
        '\n📄 docs/api.md',
        '─'.repeat(40),
        '  ❌ Line 4: Missing | file',
        '     💡 Try | next',
        '  ⚠️ Line 8: Old URL',
        '  ⚠️ Line 12: ',
        '\n',
      ].map((line) => [line])
    );
    log.mockClear();
    reporter.generateWithScores(issueResults, null);
    expect(log.mock.calls.slice(-7)).toEqual(
      [
        '🔍 Semantic Analysis (Vector Search):\n',
        '   Found 1 potential documentation-code mismatches:\n',
        '   ⚠️  docs/api.md',
        '      Section: "Usage"',
        '      Similarity: 12.5%',
        '      💡 Review this section',
        '',
      ].map((line) => [line])
    );
    log.mockClear();
    reporter.generate(cleanResults);
    expect(log.mock.calls.at(-1)).toEqual(['\n✨ All documentation is up to date!\n']);
  });

  it('preserves JSON bytes, key order, indentation, timestamp, and score modes', () => {
    const reporter = new JsonReporter();
    expect(reporter.generate(issueResults)).toBe(JSON.stringify(issueResults, null, 2));
    expect(reporter.generateWithScores(cleanResults, null)).toBe(
      JSON.stringify({ ...cleanResults, freshnessScores: null, generatedAt }, null, 2)
    );
    expect(reporter.generateWithScores(cleanResults, scores)).toBe(
      JSON.stringify({ ...cleanResults, freshnessScores: scores, generatedAt }, null, 2)
    );
  });

  it('preserves Markdown issue, clean, null-score, and populated-score bytes', () => {
    const reporter = new MarkdownReporter();
    expect(reporter.generate(issueResults)).toBe(`# Documentation Freshness Report

Generated: ${generatedAt}

## Summary

| Metric | Count |
|--------|-------|
| Total Checked | 3 |
| ✅ Valid | 0 |
| ❌ Errors | 1 |
| ⚠️ Warnings | 2 |
| ⏭️ Skipped | 0 |

## Issues

### 📄 \`docs/api.md\`

| Line | Severity | Issue | Suggestion |
|------|----------|-------|------------|
| 4 | ❌ Error | Missing \\| file | Try \\| next |
| 8 | ⚠️ Warning | Old URL | - |
| 12 | ⚠️ Warning |  | - |

`);
    const clean = `# Documentation Freshness Report

Generated: ${generatedAt}

## Summary

| Metric | Count |
|--------|-------|
| Total Checked | 2 |
| ✅ Valid | 2 |
| ❌ Errors | 0 |
| ⚠️ Warnings | 0 |
| ⏭️ Skipped | 0 |

✨ **All documentation is up to date!**
`;
    expect(reporter.generate(cleanResults)).toBe(clean);
    expect(reporter.generateWithScores(cleanResults, null)).toBe(clean);
    expect(reporter.generateWithScores(cleanResults, scores)).toBe(
      `${clean}## Freshness Scores\n\n**Project Score:** 85/100 (Grade: B)\n\n` +
        '| Document | Score | Grade |\n|----------|-------|-------|\n| `docs/api.md` | 85/100 | B |\n\n'
    );
  });

  it('preserves complete Enhanced bytes and collaborator order', () => {
    const calls: string[] = [];
    const graph = new CodeDocGraph();
    for (const file of ['src/z.ts', 'src/a.ts']) {
      graph.addReference('docs/api.md', file, reference('file-path', 1));
    }
    const locale = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date) {
      calls.push(`locale:${this.getTime()}`);
      return '1/1/2025';
    });
    const gitTracker = {
      isGitRepo: vi.fn(() => (calls.push('isGitRepo'), true)),
      getFileCommitInfo: vi.fn((file: string) => {
        calls.push(`commit:${file}`);
        return { hash: 'abc', timestamp: file === 'src/z.ts' ? 1735689600000 : 1735776000000, message: 'change' };
      }),
      getChangedFilesSince: vi.fn(() => (calls.push('changedFiles'), ['src/z.ts'])),
      getAffectedDocs: vi.fn(() => (calls.push('affectedDocs'), ['docs/api.md', 'docs/other.md'])),
    } as unknown as GitChangeTracker;

    const expected =
      `# 📚 Documentation Freshness Scan Report\n\n**Generated:** ${generatedAt}\n\n` +
      '## 📊 Project Freshness Score: 85/100 (Grade: B)\n\n| Grade | Count |\n|-------|-------|\n' +
      '| A (90-100) | 0 |\n| B (80-89)  | 1 |\n| C (70-79)  | 0 |\n| D (60-69)  | 0 |\n| F (0-59)   | 0 |\n\n' +
      '## ✅ Validation Summary\n\n- **Total References:** 3\n- **Valid:** 0\n- **Errors:** 1\n- **Warnings:** 2\n\n' +
      '## 📋 Affected Documents\n\n### 📄 `docs/api.md` (Score: 85, Grade: B)\n\n**Referenced Code Files:**\n' +
      '- `src/z.ts` (last modified: 1/1/2025)\n- `src/a.ts` (last modified: 1/1/2025)\n\n' +
      '| Line | Type | Issue | Suggestion |\n|------|------|-------|------------|\n' +
      '| 4 | ❌ file-path | Missing \\| file | Try \\| next |\n| 8 | ⚠️ external-url | Old URL | - |\n| 12 | ⚠️ dependency |  | - |\n\n' +
      '## 🔄 Recent Code Changes Impacting Docs\n\nThe following documents reference code that changed in the last 7 days:\n\n' +
      '- `docs/api.md`\n- `docs/other.md`\n\n';
    expect(new EnhancedReporter().generateScanReport(issueResults, graph, gitTracker, scores)).toBe(expected);
    expect(gitTracker.getChangedFilesSince).toHaveBeenCalledWith(Date.parse(generatedAt) - 7 * 24 * 60 * 60 * 1000);
    expect(calls.join('|')).toBe(
      'commit:src/z.ts|locale:1735689600000|commit:src/a.ts|locale:1735776000000|isGitRepo|changedFiles|affectedDocs'
    );
    locale.mockRestore();
  });
});
