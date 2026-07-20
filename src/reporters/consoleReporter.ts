import type { ProjectScores, ValidationResults } from '../types.js';
import { createReportContext, type ReportContext } from './reportContext.js';

function* baseConsoleReportChunks(report: ReportContext): Generator<string> {
  const { summary, documents } = report.results;

  yield '\n📚 Documentation Freshness Report\n';
  yield '━'.repeat(50);
  yield '\n📊 Summary:';
  yield `   Total references checked: ${summary.total}`;
  yield `   ✅ Valid: ${summary.valid}`;
  yield `   ❌ Errors: ${summary.errors}`;
  yield `   ⚠️  Warnings: ${summary.warnings}`;
  yield `   ⏭️  Skipped: ${summary.skipped}`;

  if (documents.length === 0) {
    yield '\n✨ All documentation is up to date!\n';
    return;
  }

  yield '\n📋 Issues by Document:\n';
  for (const document of documents) {
    yield `\n📄 ${document.path}`;
    yield '─'.repeat(40);
    for (const issue of document.issues) {
      const icon = issue.severity === 'error' ? '❌' : '⚠️';
      yield `  ${icon} Line ${issue.reference.lineNumber}: ${issue.message}`;
      if (issue.suggestion) {
        yield `     💡 ${issue.suggestion}`;
      }
    }
  }
  yield '\n';
}

function* supplementalConsoleReportChunks(report: ReportContext): Generator<string> {
  const { freshnessScores, results } = report;

  if (freshnessScores) {
    yield '📊 Freshness Scores:\n';
    yield `   Project Score: ${freshnessScores.projectScore}/100 (Grade: ${freshnessScores.projectGrade})\n`;
    yield '   By Document:';
    for (const document of freshnessScores.documents) {
      const grade = document.grade;
      const icon = grade === 'A' ? '🟢' : grade === 'B' ? '🟡' : grade === 'C' ? '🟠' : '🔴';
      yield `   ${icon} ${document.document}: ${document.totalScore}/100 (${grade})`;
    }
    yield '';
  }

  if (freshnessScores !== undefined && results.vectorMismatches?.length) {
    yield '🔍 Semantic Analysis (Vector Search):\n';
    yield `   Found ${results.vectorMismatches.length} potential documentation-code mismatches:\n`;
    for (const mismatch of results.vectorMismatches) {
      yield `   ⚠️  ${mismatch.docPath}`;
      yield `      Section: "${mismatch.docSection}"`;
      yield `      Similarity: ${(mismatch.bestMatchScore * 100).toFixed(1)}%`;
      if (mismatch.bestMatch) {
        yield `      Best match: ${mismatch.bestMatch.path} (${mismatch.bestMatch.symbol})`;
      }
      yield `      💡 ${mismatch.suggestion}`;
      yield '';
    }
  }
}

function emitChunks(chunks: Iterable<string>): void {
  for (const chunk of chunks) {
    console.log(chunk);
  }
}

export function emitConsoleReport(report: ReportContext): void {
  emitChunks(baseConsoleReportChunks(report));
  emitChunks(supplementalConsoleReportChunks(report));
}

/**
 * Console reporter for terminal output
 */
export class ConsoleReporter {
  generate(results: ValidationResults): void {
    emitChunks(baseConsoleReportChunks(createReportContext(results)));
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): void {
    this.generate(results);
    emitChunks(supplementalConsoleReportChunks(createReportContext(results, freshnessScores)));
  }
}
