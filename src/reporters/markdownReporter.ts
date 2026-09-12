import type { ProjectScores, ValidationResults } from '../types.js';
import { formatVectorMismatches } from './formatVectorMismatches.js';
import { normalizeMarkdownIssueCells } from './markdownIssueCells.js';
import { createTimestampedReportContext } from './reportContext.js';

type MarkdownReportContext = ReturnType<typeof createTimestampedReportContext>;

function renderMarkdownBase(report: MarkdownReportContext): string {
  const { summary, documents, vectorMismatches } = report.results;
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
  markdown += `| ℹ️ Info | ${summary.info ?? 0} |\n`;
  markdown += `| ⏭️ Skipped | ${summary.skipped} |\n\n`;

  if (documents.length === 0) {
    return vectorMismatches?.length ? markdown : `${markdown}✨ **All documentation is up to date!**\n`;
  }

  markdown += '## Issues\n\n';
  for (const document of documents) {
    markdown += `### 📄 \`${document.path}\`\n\n`;
    markdown += '| Line | Severity | Issue | Suggestion |\n';
    markdown += '|------|----------|-------|------------|\n';
    for (const issue of document.issues) {
      const { isError, isInfo, suggestion, message } = normalizeMarkdownIssueCells(issue);
      const severity = isError ? '❌ Error' : isInfo ? 'ℹ️ Info' : '⚠️ Warning';
      markdown += `| ${issue.reference.lineNumber} | ${severity} | ${message} | ${suggestion} |\n`;
    }
    markdown += '\n';
  }
  return markdown;
}

function renderMarkdownScores(freshnessScores: NonNullable<MarkdownReportContext['freshnessScores']>): string {
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
  let markdown = renderMarkdownBase(report);
  if (report.freshnessScores) {
    markdown += renderMarkdownScores(report.freshnessScores);
  }
  const mismatches = report.results.vectorMismatches;
  return markdown + formatVectorMismatches(mismatches ? [...mismatches] : undefined);
}

export function generateMarkdownReport(results: ValidationResults, freshnessScores: ProjectScores | null | undefined = undefined): string {
  return renderMarkdownReport(createTimestampedReportContext(results, freshnessScores));
}

/** Markdown reporter for documentation-friendly output. */
export class MarkdownReporter {
  generate(results: ValidationResults): string {
    return generateMarkdownReport(results);
  }

  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    return generateMarkdownReport(results, freshnessScores);
  }
}
