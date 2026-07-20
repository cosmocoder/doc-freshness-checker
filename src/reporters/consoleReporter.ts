import type { ProjectScores, ValidationResults } from '../types.js';
import { createReportContext } from './reportContext.js';

type ReportContext = ReturnType<typeof createReportContext>;

function* validationConsoleChunks(report: ReportContext): Generator<string> {
  const { summary, documents, vectorMismatches } = report.results;

  yield '\n📚 Documentation Freshness Report\n';
  yield '━'.repeat(50);
  yield '\n📊 Summary:';
  yield `   Total references checked: ${summary.total}`;
  yield `   ✅ Valid: ${summary.valid}`;
  yield `   ❌ Errors: ${summary.errors}`;
  yield `   ⚠️  Warnings: ${summary.warnings}`;
  yield `   ℹ️  Info: ${summary.info ?? 0}`;
  yield `   ⏭️  Skipped: ${summary.skipped}`;

  if (documents.length === 0) {
    yield vectorMismatches?.length ? '' : '\n✨ All documentation is up to date!\n';
    return;
  }

  yield '\n📋 Issues by Document:\n';
  for (const document of documents) {
    yield `\n📄 ${document.path}`;
    yield '─'.repeat(40);
    for (const issue of document.issues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'info' ? 'ℹ️' : '⚠️';
      yield `  ${icon} Line ${issue.reference.lineNumber}: ${issue.message}`;
      if (issue.suggestion) {
        yield `     💡 ${issue.suggestion}`;
      }
    }
  }
  yield '\n';
}

function* scoreConsoleChunks(report: ReportContext): Generator<string> {
  const { freshnessScores } = report;
  if (!freshnessScores) {
    return;
  }

  yield '📊 Freshness Scores:\n';
  yield `   Project Score: ${freshnessScores.projectScore}/100 (Grade: ${freshnessScores.projectGrade})\n`;
  yield '   By Document:';
  for (const document of freshnessScores.documents) {
    const { grade } = document;
    const icon = grade === 'A' ? '🟢' : grade === 'B' ? '🟡' : grade === 'C' ? '🟠' : '🔴';
    yield `   ${icon} ${document.document}: ${document.totalScore}/100 (${grade})`;
  }
  yield '';
}

function* semanticConsoleChunks(report: ReportContext): Generator<string> {
  const mismatches = report.results.vectorMismatches;
  if (!mismatches?.length) {
    return;
  }

  yield '🔍 Semantic Analysis (Vector Search):\n';
  yield `   Found ${mismatches.length} potential semantic mismatches:\n`;
  for (const mismatch of mismatches) {
    yield `   ⚠️  ${mismatch.docPath}`;
    yield `      Section: "${mismatch.docSection}"`;
    yield `      Similarity: ${(mismatch.bestMatchScore * 100).toFixed(1)}%`;
    const bestMatch = mismatch.bestMatch ? `${mismatch.bestMatch.path} (${mismatch.bestMatch.symbol})` : '-';
    yield `      Best match: ${bestMatch}`;
    yield `      💡 ${mismatch.suggestion}`;
    yield '';
  }
}

function emitChunks(chunks: Iterable<string>): void {
  for (const chunk of chunks) {
    console.log(chunk);
  }
}

export function emitConsoleReport(report: ReportContext): void {
  emitChunks(validationConsoleChunks(report));
  emitChunks(scoreConsoleChunks(report));
  emitChunks(semanticConsoleChunks(report));
}

/** Console reporter for terminal output. */
export class ConsoleReporter {
  generate(results: ValidationResults): void {
    emitConsoleReport(createReportContext(results));
  }

  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): void {
    emitConsoleReport(createReportContext(results, freshnessScores));
  }
}
