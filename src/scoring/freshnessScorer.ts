import type {
  DocFreshnessConfig,
  DocScore,
  Document,
  FreshnessScoringThresholds,
  FreshnessScoringWeights,
  Grade,
  ProjectScores,
  ValidationResults,
} from '../types.js';
import type { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';

/**
 * Calculates freshness scores for documentation
 */
export class FreshnessScorer {
  private weights: Required<FreshnessScoringWeights>;
  private thresholds: Required<FreshnessScoringThresholds>;

  constructor(config: DocFreshnessConfig) {
    // Configurable weights for different factors
    this.weights = {
      referenceValidity: config.freshnessScoring?.weights?.referenceValidity ?? 0.4,
      gitTimeDelta: config.freshnessScoring?.weights?.gitTimeDelta ?? 0.3,
      codeChangeFrequency: config.freshnessScoring?.weights?.codeChangeFrequency ?? 0.15,
      symbolCoverage: config.freshnessScoring?.weights?.symbolCoverage ?? 0.15,
    };

    this.thresholds = {
      gradeA: config.freshnessScoring?.thresholds?.gradeA ?? 90,
      gradeB: config.freshnessScoring?.thresholds?.gradeB ?? 80,
      gradeC: config.freshnessScoring?.thresholds?.gradeC ?? 70,
      gradeD: config.freshnessScoring?.thresholds?.gradeD ?? 60,
    };
  }

  /**
   * Calculate freshness score for a single document
   * Returns score 0-100 (100 = perfectly fresh)
   */
  calculateDocScore(
    doc: Document,
    validationResults: ValidationResults,
    gitTracker: GitChangeTracker | null,
    graph: CodeDocGraph | null
  ): DocScore {
    const scores = {
      referenceValidity: this.calculateReferenceValidityScore(doc, validationResults),
      gitTimeDelta: this.calculateGitTimeDeltaScore(doc, gitTracker, graph),
      codeChangeFrequency: this.calculateChangeFrequencyScore(doc, gitTracker, graph),
      symbolCoverage: this.calculateSymbolCoverageScore(doc, graph),
    };

    // Calculate weighted total
    const totalScore =
      scores.referenceValidity * this.weights.referenceValidity +
      scores.gitTimeDelta * this.weights.gitTimeDelta +
      scores.codeChangeFrequency * this.weights.codeChangeFrequency +
      scores.symbolCoverage * this.weights.symbolCoverage;

    return {
      document: doc.path,
      totalScore: Math.round(totalScore),
      factors: scores,
      grade: this.scoreToGrade(totalScore),
    };
  }

  /**
   * Calculate score based on how many references are still valid
   */
  private calculateReferenceValidityScore(doc: Document, validationResults: ValidationResults): number {
    const docResults = validationResults.documents.find((d) => d.path === doc.path);

    if (!docResults || doc.references.length === 0) {
      return 100; // No references = assume fresh
    }

    const totalRefs = doc.references.length;
    const invalidRefs = docResults.issues.filter((i) => i.severity === 'error').length;

    return Math.round(((totalRefs - invalidRefs) / totalRefs) * 100);
  }

  /**
   * Calculate score based on time difference between doc and code updates
   */
  private calculateGitTimeDeltaScore(doc: Document, gitTracker: GitChangeTracker | null, graph: CodeDocGraph | null): number {
    if (!gitTracker?.isGitRepo()) {
      return 75; // Default score for non-git repos
    }

    const docCommitInfo = gitTracker.getFileCommitInfo(doc.path);
    if (!docCommitInfo) {
      return 50; // Doc not in git
    }

    const referencedFiles = graph?.getCodeReferencedByDoc(doc.path);
    if (!referencedFiles || referencedFiles.size === 0) {
      return 100; // No code references
    }

    let maxCodeTimestamp = 0;
    for (const codeFile of referencedFiles) {
      const codeCommitInfo = gitTracker.getFileCommitInfo(codeFile);
      if (codeCommitInfo && codeCommitInfo.timestamp > maxCodeTimestamp) {
        maxCodeTimestamp = codeCommitInfo.timestamp;
      }
    }

    if (maxCodeTimestamp === 0) {
      return 75; // Code not in git
    }

    // Doc was updated after code = fresh
    if (docCommitInfo.timestamp >= maxCodeTimestamp) {
      return 100;
    }

    // Calculate decay based on time difference
    const daysDiff = (maxCodeTimestamp - docCommitInfo.timestamp) / (1000 * 60 * 60 * 24);

    // Score decays: 100 at 0 days, ~50 at 30 days, ~25 at 90 days
    const decayRate = 0.02;
    return Math.max(0, Math.round(100 * Math.exp(-decayRate * daysDiff)));
  }

  /**
   * Calculate score based on how frequently referenced code changes
   */
  private calculateChangeFrequencyScore(doc: Document, gitTracker: GitChangeTracker | null, graph: CodeDocGraph | null): number {
    if (!gitTracker?.isGitRepo()) {
      return 75;
    }

    const referencedFiles = graph?.getCodeReferencedByDoc(doc.path);
    if (!referencedFiles || referencedFiles.size === 0) {
      return 100;
    }

    // High-churn code is harder to keep documented
    // This is informational - not a penalty
    return 75; // Placeholder - would need git log analysis
  }

  /**
   * Calculate what percentage of symbols in referenced files are documented
   */
  private calculateSymbolCoverageScore(doc: Document, graph: CodeDocGraph | null): number {
    const referencedFiles = graph?.getCodeReferencedByDoc(doc.path);
    if (!referencedFiles || referencedFiles.size === 0) {
      return 100;
    }

    const docSymbols = new Set(doc.references.filter((r) => r.type === 'code-pattern').map((r) => r.value));

    let totalSymbols = 0;
    let documentedSymbols = 0;

    for (const codeFile of referencedFiles) {
      const fileSymbols = graph?.codeSymbols?.get(codeFile);
      if (fileSymbols) {
        totalSymbols += fileSymbols.size;
        for (const symbol of fileSymbols) {
          if (docSymbols.has(symbol)) {
            documentedSymbols++;
          }
        }
      }
    }

    if (totalSymbols === 0) {
      return 100;
    }

    return Math.round((documentedSymbols / totalSymbols) * 100);
  }

  /**
   * Convert numeric score to letter grade
   */
  private scoreToGrade(score: number): Grade {
    if (score >= this.thresholds.gradeA) return 'A';
    if (score >= this.thresholds.gradeB) return 'B';
    if (score >= this.thresholds.gradeC) return 'C';
    if (score >= this.thresholds.gradeD) return 'D';
    return 'F';
  }

  /**
   * Calculate scores for all documents
   */
  calculateProjectScores(
    documents: Document[],
    validationResults: ValidationResults,
    gitTracker: GitChangeTracker | null,
    graph: CodeDocGraph | null
  ): ProjectScores {
    const docScores = documents.map((doc) => this.calculateDocScore(doc, validationResults, gitTracker, graph));

    // Calculate overall project score
    const avgScore = docScores.length > 0 ? docScores.reduce((sum, d) => sum + d.totalScore, 0) / docScores.length : 100;

    return {
      projectScore: Math.round(avgScore),
      projectGrade: this.scoreToGrade(avgScore),
      documents: docScores,
      summary: {
        total: docScores.length,
        gradeA: docScores.filter((d) => d.grade === 'A').length,
        gradeB: docScores.filter((d) => d.grade === 'B').length,
        gradeC: docScores.filter((d) => d.grade === 'C').length,
        gradeD: docScores.filter((d) => d.grade === 'D').length,
        gradeF: docScores.filter((d) => d.grade === 'F').length,
      },
    };
  }
}
