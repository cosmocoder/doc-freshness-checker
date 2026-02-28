import type { ProjectScores, ValidationResults } from '../types.js';

/**
 * JSON reporter for machine-readable output
 */
export class JsonReporter {
  generate(results: ValidationResults): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): string {
    const output = {
      ...results,
      freshnessScores: freshnessScores || null,
      generatedAt: new Date().toISOString(),
    };
    return JSON.stringify(output, null, 2);
  }
}
