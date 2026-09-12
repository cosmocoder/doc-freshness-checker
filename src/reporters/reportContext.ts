import type { ProjectScores, ValidationResults } from '../types.js';

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

interface ReportContext {
  readonly results: DeepReadonly<ValidationResults>;
  readonly freshnessScores: DeepReadonly<ProjectScores> | null | undefined;
  readonly generatedAt?: string;
}

export function createReportContext(
  results: ValidationResults,
  freshnessScores: ProjectScores | null | undefined = undefined
): ReportContext {
  return Object.freeze({ results, freshnessScores });
}

export function createTimestampedReportContext(
  results: ValidationResults,
  freshnessScores: ProjectScores | null | undefined = undefined
): ReportContext {
  const capturedResults = Object.freeze({ ...results });
  return Object.freeze({ results: capturedResults, freshnessScores, generatedAt: new Date().toISOString() });
}
