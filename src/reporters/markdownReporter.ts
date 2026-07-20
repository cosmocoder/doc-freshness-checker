import type { ProjectScores, ValidationResults } from '../types.js';
import { normalizeMarkdownIssueCells } from './markdownIssueCells.js';

interface MarkdownReportContext {
  readonly summary: ValidationResults['summary'];
  readonly documents: ValidationResults['documents'];
  readonly freshnessScores: ProjectScores | null | undefined;
  readonly generatedAt: string;
}

function createMarkdownReportContext(
  results: ValidationResults,
  freshnessScores: ProjectScores | null | undefined = undefined
): MarkdownReportContext {
  const { summary, documents } = results;
  const generatedAt = new Date().toISOString();
  return { summary, documents, freshnessScores, generatedAt };
}

function renderMarkdownBase(report: MarkdownReportContext): string {
  const { summary, documents } = report;
  let markdown = '';

  markdown += '# Documentation Freshness Report\n\n';
  markdown += `Generated: ${report.generatedAt}\n\n`;
  markdown += '## Summary\n\n';
  markdown += '| Metric | Count |\n';
  markdown += '|--------|-------|\n';
  markdown += `| Total Checked | ${summary.total} |\n`;
  markdown += `| ✅ Valid | ${summary.valid} |\n`;
  markdown += `| ❌ Errors | ${summary.errors} |\n`;
  markdown += `| ⚠️ Warnings | ${summary.warnings} |\n`;
  markdown += `| ⏭️ Skipped | ${summary.skipped} |\n\n`;

  if (documents.length === 0) {
    return `${markdown}✨ **All documentation is up to date!**\n`;
  }

  markdown += '## Issues\n\n';
  for (const document of documents) {
    markdown += `### 📄 \`${document.path}\`\n\n`;
    markdown += '| Line | Severity | Issue | Suggestion |\n';
    markdown += '|------|----------|-------|------------|\n';
    for (const issue of document.issues) {
      const { isError, suggestion, message } = normalizeMarkdownIssueCells(issue);
      const severity = isError ? '❌ Error' : '⚠️ Warning';
      markdown += `| ${issue.reference.lineNumber} | ${severity} | ${message} | ${suggestion} |\n`;
    }
    markdown += '\n';
  }
  return markdown;
}

function renderMarkdownScores(freshnessScores: ProjectScores): string {
  let markdown = '## Freshness Scores\n\n';
  markdown += `**Project Score:** ${freshnessScores.projectScore}/100 (Grade: ${freshnessScores.projectGrade})\n\n`;
  markdown += '| Document | Score | Grade |\n';
  markdown += '|----------|-------|-------|\n';
  for (const document of freshnessScores.documents) {
    markdown += `| \`${document.document}\` | ${document.totalScore}/100 | ${document.grade} |\n`;
  }
  return `${markdown}\n`;
}

function renderMarkdownReport(report: MarkdownReportContext): string {
  const markdown = renderMarkdownBase(report);
  return report.freshnessScores ? markdown + renderMarkdownScores(report.freshnessScores) : markdown;
}

export function generateMarkdownReport(results: ValidationResults, freshnessScores: ProjectScores | null | undefined = undefined): string {
  return renderMarkdownReport(createMarkdownReportContext(results, freshnessScores));
}

/**
 * Markdown reporter for documentation-friendly output
 */
export class MarkdownReporter {
  generate(results: ValidationResults): string {
    return generateMarkdownReport(results);
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    const markdown = this.generate(results);
    return freshnessScores ? markdown + renderMarkdownScores(freshnessScores) : markdown;
  }
}
