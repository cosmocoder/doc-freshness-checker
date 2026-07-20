import type { ProjectScores, ValidationResults } from '../types.js';
import { createReportContext, createTimestampedReportContext, type ReportContext } from './reportContext.js';

export function createScoredJsonReportContext(results: ValidationResults, freshnessScores: ProjectScores | null): ReportContext {
  const resultsSnapshot = { ...results };
  return createTimestampedReportContext(resultsSnapshot, freshnessScores);
}

export function renderJsonReport(report: ReportContext): string {
  if (report.freshnessScores === undefined) {
    return JSON.stringify(report.results, null, 2);
  }
  return JSON.stringify(
    {
      ...report.results,
      freshnessScores: report.freshnessScores || null,
      generatedAt: report.generatedAt,
    },
    null,
    2
  );
}

/**
 * JSON reporter for machine-readable output
 */
export class JsonReporter {
  generate(results: ValidationResults): string {
    return renderJsonReport(createReportContext(results));
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    return renderJsonReport(createScoredJsonReportContext(results, freshnessScores));
  }
}
