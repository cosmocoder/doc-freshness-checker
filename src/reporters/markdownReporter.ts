import type { ProjectScores, ValidationResults } from '../types.js';

/**
 * Markdown reporter for documentation-friendly output
 */
export class MarkdownReporter {
  generate(results: ValidationResults): string {
    const { summary, documents } = results;
    let md = '';

    md += '# Documentation Freshness Report\n\n';
    md += `Generated: ${new Date().toISOString()}\n\n`;

    md += '## Summary\n\n';
    md += '| Metric | Count |\n';
    md += '|--------|-------|\n';
    md += `| Total Checked | ${summary.total} |\n`;
    md += `| ✅ Valid | ${summary.valid} |\n`;
    md += `| ❌ Errors | ${summary.errors} |\n`;
    md += `| ⚠️ Warnings | ${summary.warnings} |\n`;
    md += `| ⏭️ Skipped | ${summary.skipped} |\n\n`;

    if (documents.length === 0) {
      md += '✨ **All documentation is up to date!**\n';
      return md;
    }

    md += '## Issues\n\n';

    for (const doc of documents) {
      md += `### 📄 \`${doc.path}\`\n\n`;
      md += '| Line | Severity | Issue | Suggestion |\n';
      md += '|------|----------|-------|------------|\n';

      for (const issue of doc.issues) {
        const severity = issue.severity === 'error' ? '❌ Error' : '⚠️ Warning';
        const suggestion = issue.suggestion || '-';
        const message = (issue.message || '').replace(/\|/g, '\\|');
        md += `| ${issue.reference.lineNumber} | ${severity} | ${message} | ${suggestion} |\n`;
      }

      md += '\n';
    }

    return md;
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    let md = this.generate(results);

    if (freshnessScores) {
      md += '## Freshness Scores\n\n';
      md += `**Project Score:** ${freshnessScores.projectScore}/100 (Grade: ${freshnessScores.projectGrade})\n\n`;

      md += '| Document | Score | Grade |\n';
      md += '|----------|-------|-------|\n';

      for (const doc of freshnessScores.documents) {
        md += `| \`${doc.document}\` | ${doc.totalScore}/100 | ${doc.grade} |\n`;
      }

      md += '\n';
    }

    return md;
  }
}
