import type { ProjectScores, ValidationResults } from '../types.js';
import type { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';

/**
 * Enhanced reporter with DeepDocs-style output
 */
export class EnhancedReporter {
  /**
   * Generate a DeepDocs-style scan report
   */
  generateScanReport(
    results: ValidationResults,
    graph: CodeDocGraph | null,
    gitTracker: GitChangeTracker | null,
    freshnessScores: ProjectScores | null
  ): string {
    let report = '';

    report += '# 📚 Documentation Freshness Scan Report\n\n';
    report += `**Generated:** ${new Date().toISOString()}\n\n`;

    // Project Score
    if (freshnessScores) {
      report += `## 📊 Project Freshness Score: ${freshnessScores.projectScore}/100 `;
      report += `(Grade: ${freshnessScores.projectGrade})\n\n`;

      report += '| Grade | Count |\n|-------|-------|\n';
      report += `| A (90-100) | ${freshnessScores.summary.gradeA} |\n`;
      report += `| B (80-89)  | ${freshnessScores.summary.gradeB} |\n`;
      report += `| C (70-79)  | ${freshnessScores.summary.gradeC} |\n`;
      report += `| D (60-69)  | ${freshnessScores.summary.gradeD} |\n`;
      report += `| F (0-59)   | ${freshnessScores.summary.gradeF} |\n\n`;
    }

    // Validation Summary
    report += '## ✅ Validation Summary\n\n';
    report += `- **Total References:** ${results.summary.total}\n`;
    report += `- **Valid:** ${results.summary.valid}\n`;
    report += `- **Errors:** ${results.summary.errors}\n`;
    report += `- **Warnings:** ${results.summary.warnings}\n\n`;

    // Affected Documents (DeepDocs-style)
    if (results.documents.length > 0) {
      report += '## 📋 Affected Documents\n\n';

      for (const doc of results.documents) {
        const score = freshnessScores?.documents.find((d) => d.document === doc.path);
        const scoreStr = score ? ` (Score: ${score.totalScore}, Grade: ${score.grade})` : '';

        report += `### 📄 \`${doc.path}\`${scoreStr}\n\n`;

        // Show referenced code files
        const codeFiles = graph?.getCodeReferencedByDoc(doc.path);
        if (codeFiles && codeFiles.size > 0) {
          report += '**Referenced Code Files:**\n';
          for (const codeFile of codeFiles) {
            const commitInfo = gitTracker?.getFileCommitInfo(codeFile);
            const commitStr = commitInfo ? ` (last modified: ${new Date(commitInfo.timestamp).toLocaleDateString()})` : '';
            report += `- \`${codeFile}\`${commitStr}\n`;
          }
          report += '\n';
        }

        // Issues table
        report += '| Line | Type | Issue | Suggestion |\n';
        report += '|------|------|-------|------------|\n';

        for (const issue of doc.issues) {
          const severity = issue.severity === 'error' ? '❌' : '⚠️';
          const suggestion = issue.suggestion || '-';
          const message = (issue.message || '').replace(/\|/g, '\\|');
          report += `| ${issue.reference.lineNumber} | ${severity} ${issue.reference.type} | ${message} | ${suggestion} |\n`;
        }

        report += '\n';
      }
    }

    // Code Change Impact (if git available)
    if (gitTracker?.isGitRepo() && graph) {
      try {
        const recentChanges = gitTracker.getChangedFilesSince(
          Date.now() - 7 * 24 * 60 * 60 * 1000 // Last 7 days
        );

        const impactedDocs = gitTracker.getAffectedDocs(graph, recentChanges);

        if (impactedDocs.length > 0) {
          report += '## 🔄 Recent Code Changes Impacting Docs\n\n';
          report += 'The following documents reference code that changed in the last 7 days:\n\n';

          for (const docPath of impactedDocs) {
            report += `- \`${docPath}\`\n`;
          }
          report += '\n';
        }
      } catch {
        // Git operations failed
      }
    }

    return report;
  }
}
