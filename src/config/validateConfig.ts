import { DEFAULT_CONFIG } from './defaults.js';
import type { DocFreshnessConfig, FreshnessScoringThresholds, FreshnessScoringWeights, UrlValidationConfig } from '../types.js';

const FRESHNESS_SCORING_WEIGHT_KEYS = Object.keys(DEFAULT_CONFIG.freshnessScoring.weights) as Array<keyof FreshnessScoringWeights>;
const FRESHNESS_SCORING_THRESHOLD_KEYS = Object.keys(DEFAULT_CONFIG.freshnessScoring.thresholds) as Array<keyof FreshnessScoringThresholds>;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function validateConfig(config: DocFreshnessConfig): void {
  const urlValidation = (config as { urlValidation?: unknown }).urlValidation;
  if (urlValidation !== undefined && !isPlainObject(urlValidation)) {
    throw new Error('urlValidation must be a plain object');
  }

  const freshnessScoring = (config as { freshnessScoring?: unknown }).freshnessScoring;
  if (freshnessScoring !== undefined && !isPlainObject(freshnessScoring)) {
    throw new Error('freshnessScoring must be a plain object');
  }

  const weights = freshnessScoring?.weights;
  if (weights !== undefined && !isPlainObject(weights)) {
    throw new Error('freshnessScoring.weights must be a plain object');
  }

  const thresholds = freshnessScoring?.thresholds;
  if (thresholds !== undefined && !isPlainObject(thresholds)) {
    throw new Error('freshnessScoring.thresholds must be a plain object');
  }

  const validatedUrlValidation = urlValidation as UrlValidationConfig | undefined;
  const timeout = validatedUrlValidation?.timeout;
  if (timeout !== undefined && (!isPositiveFiniteNumber(timeout) || timeout > MAX_TIMER_DELAY_MS)) {
    throw new Error(`urlValidation.timeout must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
  }

  const concurrency = validatedUrlValidation?.concurrency;
  if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency <= 0)) {
    throw new Error('urlValidation.concurrency must be a positive integer');
  }

  validateScoringWeights(weights as FreshnessScoringWeights | undefined);
  validateScoringThresholds(thresholds as FreshnessScoringThresholds | undefined);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validateScoringWeights(weights: FreshnessScoringWeights | undefined): void {
  for (const key of FRESHNESS_SCORING_WEIGHT_KEYS) {
    const value = weights?.[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`freshnessScoring.weights.${key} must be a finite number between 0 and 1`);
    }
  }
}

function validateScoringThresholds(thresholds: FreshnessScoringThresholds | undefined): void {
  if (!thresholds) {
    return;
  }

  const effective = { ...DEFAULT_CONFIG.freshnessScoring.thresholds };
  for (const key of FRESHNESS_SCORING_THRESHOLD_KEYS) {
    const value = thresholds[key];
    if (value !== undefined) {
      effective[key] = value;
    }
  }

  for (const key of FRESHNESS_SCORING_THRESHOLD_KEYS) {
    const value = effective[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`freshnessScoring.thresholds.${key} must be a finite number between 0 and 100`);
    }
  }

  if (!(effective.gradeA > effective.gradeB && effective.gradeB > effective.gradeC && effective.gradeC > effective.gradeD)) {
    throw new Error(
      `freshnessScoring.thresholds must satisfy gradeA > gradeB > gradeC > gradeD; effective values: ${JSON.stringify(effective)}`
    );
  }
}
