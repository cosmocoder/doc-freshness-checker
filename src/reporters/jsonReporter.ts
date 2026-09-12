import type { ProjectScores, ValidationResults } from '../types.js';
import { createReportContext, createTimestampedReportContext } from './reportContext.js';

type ReportContext = ReturnType<typeof createReportContext>;

function normalizeResults(results: ValidationResults): ValidationResults {
  return { ...results, summary: { ...results.summary, info: results.summary.info ?? 0 } };
}

export function createScoredJsonReportContext(results: ValidationResults, freshnessScores: ProjectScores | null): ReportContext {
  return createTimestampedReportContext(normalizeResults(results), freshnessScores);
}

export function renderJsonReport(report: ReportContext): string {
  const results = {
    ...report.results,
    summary: { ...report.results.summary, info: report.results.summary.info ?? 0 },
  };
  if (report.freshnessScores === undefined) {
    return JSON.stringify(results, null, 2);
  }
  return JSON.stringify(
    {
      ...results,
      freshnessScores: report.freshnessScores || null,
      generatedAt: report.generatedAt,
    },
    null,
    2
  );
}

/** JSON reporter for machine-readable output. */
export class JsonReporter {
  generate(results: ValidationResults): string {
    return renderJsonReport(createReportContext(results));
  }

  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    return renderJsonReport(createScoredJsonReportContext(results, freshnessScores));
  }
}
