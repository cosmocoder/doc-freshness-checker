import type { DocFreshnessConfig, Reference, Severity, ValidationResult } from '../types.js';

/**
 * Get a rule severity with fallback.
 */
export function getRuleSeverity(config: DocFreshnessConfig, ruleType: string, fallback: Severity): Severity {
  return config.rules?.[ruleType]?.severity || fallback;
}

/**
 * Downgrade severity for illustrative references.
 */
export function severityForIllustrative(isIllustrative: boolean, baseSeverity: Severity): Severity {
  return isIllustrative ? 'info' : baseSeverity;
}

/**
 * Standard skipped result for illustrative references.
 */
export function createIllustrativeSkippedResult(reference: Reference, message: string): ValidationResult {
  return {
    reference,
    valid: true,
    skipped: true,
    message,
  };
}
