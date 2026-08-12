import type { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import type { ProjectScores, ValidationResults } from '../types.js';
import { normalizeMarkdownIssueCells } from './markdownIssueCells.js';

interface EnhancedProjectScore {
  readonly projectScore: number;
  readonly projectGrade: string;
  readonly gradeA: number;
  readonly gradeB: number;
  readonly gradeC: number;
  readonly gradeD: number;
  readonly gradeF: number;
}

interface EnhancedCodeFile {
  readonly path: string;
  readonly lastModifiedDate: string | null;
}

interface EnhancedIssueRow {
  readonly lineNumber: number;
  readonly severity: string;
  readonly type: string;
  readonly message: string;
  readonly suggestion: string;
}

interface EnhancedDocument {
  readonly path: string;
  readonly score: { readonly totalScore: number; readonly grade: string } | null;
  readonly codeFiles: readonly EnhancedCodeFile[];
  readonly issues: readonly EnhancedIssueRow[];
}

interface EnhancedReportModel {
  readonly generatedAt: string;
  readonly projectScore: EnhancedProjectScore | null;
  readonly summary: { readonly total: number; readonly valid: number; readonly errors: number; readonly warnings: number };
  readonly documents: readonly EnhancedDocument[];
  readonly recentlyImpactedDocuments: readonly string[];
}

interface EnhancedReportContext {
  readonly model: EnhancedReportModel;
}

export function createEnhancedReportContext(
  results: ValidationResults,
  graph: CodeDocGraph | null,
  gitTracker: GitChangeTracker | null,
  freshnessScores: ProjectScores | null
): EnhancedReportContext {
  const generatedAt = new Date().toISOString();
  const projectScore = freshnessScores
    ? Object.freeze({
        projectScore: freshnessScores.projectScore,
        projectGrade: freshnessScores.projectGrade,
        gradeA: freshnessScores.summary.gradeA,
        gradeB: freshnessScores.summary.gradeB,
        gradeC: freshnessScores.summary.gradeC,
        gradeD: freshnessScores.summary.gradeD,
        gradeF: freshnessScores.summary.gradeF,
      })
    : null;
  const summary = Object.freeze({
    total: results.summary.total,
    valid: results.summary.valid,
    errors: results.summary.errors,
    warnings: results.summary.warnings,
  });

  const documents: EnhancedDocument[] = [];
  if (results.documents.length > 0) {
    for (const document of results.documents) {
      const documentScore = freshnessScores?.documents.find((candidate) => candidate.document === document.path);
      const score = documentScore ? Object.freeze({ totalScore: documentScore.totalScore, grade: documentScore.grade }) : null;
      const documentPath = document.path;

      const codeFileRows: EnhancedCodeFile[] = [];
      const codeFiles = graph?.getCodeReferencedByDoc(document.path);
      if (codeFiles?.size) {
        for (const filePath of codeFiles) {
          const commitInfo = gitTracker?.getFileCommitInfo(filePath);
          const lastModifiedDate = commitInfo ? new Date(commitInfo.timestamp).toLocaleDateString() : null;
          codeFileRows.push(Object.freeze({ path: filePath, lastModifiedDate }));
        }
      }

      const issues: EnhancedIssueRow[] = [];
      for (const issue of document.issues) {
        const { isError, suggestion, message } = normalizeMarkdownIssueCells(issue);
        const severity = isError ? '❌' : '⚠️';
        issues.push(
          Object.freeze({
            lineNumber: issue.reference.lineNumber,
            severity,
            type: issue.reference.type,
            message,
            suggestion,
          })
        );
      }

      documents.push(
        Object.freeze({
          path: documentPath,
          score,
          codeFiles: Object.freeze(codeFileRows),
          issues: Object.freeze(issues),
        })
      );
    }
  }

  let recentlyImpactedDocuments: readonly string[] = Object.freeze([]);
  if (gitTracker?.isGitRepo() && graph) {
    try {
      const recentChanges = gitTracker.getChangedFilesSince(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const impactedDocuments = gitTracker.getAffectedDocs(graph, recentChanges);
      if (impactedDocuments.length > 0) {
        recentlyImpactedDocuments = Object.freeze([...impactedDocuments]);
      }
    }
    catch {
      // Preserve reporting when recent-change lookup fails.
    }
  }

  const model = Object.freeze({
    generatedAt,
    projectScore,
    summary,
    documents: Object.freeze(documents),
    recentlyImpactedDocuments,
  });
  return Object.freeze({ model });
}

export function renderEnhancedReport(report: EnhancedReportContext): string {
  const enhanced = report.model;
  let output = '';

  output += '# 📚 Documentation Freshness Scan Report\n\n';
  output += `**Generated:** ${enhanced.generatedAt}\n\n`;

  if (enhanced.projectScore) {
    output += `## 📊 Project Freshness Score: ${enhanced.projectScore.projectScore}/100 `;
    output += `(Grade: ${enhanced.projectScore.projectGrade})\n\n`;
    output += '| Grade | Count |\n|-------|-------|\n';
    output += `| A (90-100) | ${enhanced.projectScore.gradeA} |\n`;
    output += `| B (80-89)  | ${enhanced.projectScore.gradeB} |\n`;
    output += `| C (70-79)  | ${enhanced.projectScore.gradeC} |\n`;
    output += `| D (60-69)  | ${enhanced.projectScore.gradeD} |\n`;
    output += `| F (0-59)   | ${enhanced.projectScore.gradeF} |\n\n`;
  }

  output += '## ✅ Validation Summary\n\n';
  output += `- **Total References:** ${enhanced.summary.total}\n`;
  output += `- **Valid:** ${enhanced.summary.valid}\n`;
  output += `- **Errors:** ${enhanced.summary.errors}\n`;
  output += `- **Warnings:** ${enhanced.summary.warnings}\n\n`;

  if (enhanced.documents.length > 0) {
    output += '## 📋 Affected Documents\n\n';
    for (const document of enhanced.documents) {
      const scoreText = document.score ? ` (Score: ${document.score.totalScore}, Grade: ${document.score.grade})` : '';
      output += `### 📄 \`${document.path}\`${scoreText}\n\n`;

      if (document.codeFiles.length > 0) {
        output += '**Referenced Code Files:**\n';
        for (const codeFile of document.codeFiles) {
          const commitText = codeFile.lastModifiedDate === null ? '' : ` (last modified: ${codeFile.lastModifiedDate})`;
          output += `- \`${codeFile.path}\`${commitText}\n`;
        }
        output += '\n';
      }

      output += '| Line | Type | Issue | Suggestion |\n';
      output += '|------|------|-------|------------|\n';
      for (const issue of document.issues) {
        output += `| ${issue.lineNumber} | ${issue.severity} ${issue.type} | ${issue.message} | ${issue.suggestion} |\n`;
      }
      output += '\n';
    }
  }

  if (enhanced.recentlyImpactedDocuments.length > 0) {
    output += '## 🔄 Recent Code Changes Impacting Docs\n\n';
    output += 'The following documents reference code that changed in the last 7 days:\n\n';
    for (const documentPath of enhanced.recentlyImpactedDocuments) {
      output += `- \`${documentPath}\`\n`;
    }
    output += '\n';
  }

  return output;
}

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
    return renderEnhancedReport(createEnhancedReportContext(results, graph, gitTracker, freshnessScores));
  }
}
