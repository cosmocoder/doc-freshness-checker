import { validateConfig } from './validateConfig.js';
import type { DocFreshnessConfig } from '../types.js';

describe('validateConfig', () => {
  const timeoutError = 'urlValidation.timeout must be a positive finite number no greater than 2147483647';
  const orderingError = (gradeA: number, gradeB: number, gradeC: number, gradeD: number) =>
    `freshnessScoring.thresholds must satisfy gradeA > gradeB > gradeC > gradeD; effective values: ${JSON.stringify({ gradeA, gradeB, gradeC, gradeD })}`;

  it.each([
    ['null URL validation config', { urlValidation: null }, 'urlValidation must be a plain object'],
    ['array freshness scoring config', { freshnessScoring: [] }, 'freshnessScoring must be a plain object'],
    ['string scoring weights', { freshnessScoring: { weights: 'invalid' } }, 'freshnessScoring.weights must be a plain object'],
    ['number scoring thresholds', { freshnessScoring: { thresholds: 1 } }, 'freshnessScoring.thresholds must be a plain object'],
  ])('rejects %s', (_name, config, message) => {
    expect(() => validateConfig(config as unknown as DocFreshnessConfig)).toThrow(message);
  });

  it('accepts null-prototype config containers', () => {
    const urlValidation = Object.assign(Object.create(null) as NonNullable<DocFreshnessConfig['urlValidation']>, { timeout: 5000 });
    expect(() => validateConfig({ urlValidation })).not.toThrow();
  });

  it('rejects custom-prototype config containers', () => {
    class UrlValidation {
      timeout = 5000;
    }
    expect(() => validateConfig({ urlValidation: new UrlValidation() })).toThrow('urlValidation must be a plain object');
  });

  it.each([
    ['zero timeout', { urlValidation: { timeout: 0 } }, timeoutError],
    ['NaN timeout', { urlValidation: { timeout: Number.NaN } }, timeoutError],
    ['timeout above Node timer maximum', { urlValidation: { timeout: 2_147_483_648 } }, timeoutError],
    ['zero concurrency', { urlValidation: { concurrency: 0 } }, 'urlValidation.concurrency must be a positive integer'],
    ['fractional concurrency', { urlValidation: { concurrency: 1.5 } }, 'urlValidation.concurrency must be a positive integer'],
    [
      'infinite concurrency',
      { urlValidation: { concurrency: Number.POSITIVE_INFINITY } },
      'urlValidation.concurrency must be a positive integer',
    ],
  ])('rejects %s', (_name, config, message) => {
    expect(() => validateConfig(config)).toThrow(message);
  });

  it.each([
    ['referenceValidity', -1],
    ['gitTimeDelta', Number.NaN],
    ['codeChangeFrequency', Number.POSITIVE_INFINITY],
    ['symbolCoverage', Number.NEGATIVE_INFINITY],
    ['referenceValidity', 1.01],
  ] as const)('rejects invalid %s scoring weight (%s)', (key, value) => {
    expect(() => validateConfig({ freshnessScoring: { weights: { [key]: value } } })).toThrow(
      `freshnessScoring.weights.${key} must be a finite number between 0 and 1`
    );
  });

  it('accepts inclusive upper-bound weights without constraining their total', () => {
    const weights = { referenceValidity: 1, gitTimeDelta: 1, codeChangeFrequency: 1, symbolCoverage: 1 };
    expect(() => validateConfig({ freshnessScoring: { weights } })).not.toThrow();
  });

  it('treats explicitly undefined optional scoring values as omitted', () => {
    expect(() =>
      validateConfig({
        freshnessScoring: {
          enabled: false,
          weights: {
            referenceValidity: 0.5,
            gitTimeDelta: 0.3,
            codeChangeFrequency: 0.2,
            symbolCoverage: undefined,
          },
          thresholds: { gradeA: undefined },
        },
      })
    ).not.toThrow();
  });

  it.each([
    ['gradeA above range', { gradeA: 101 }, 'freshnessScoring.thresholds.gradeA must be a finite number between 0 and 100'],
    ['gradeB below range', { gradeB: -1 }, 'freshnessScoring.thresholds.gradeB must be a finite number between 0 and 100'],
    ['NaN gradeC', { gradeC: Number.NaN }, 'freshnessScoring.thresholds.gradeC must be a finite number between 0 and 100'],
    [
      'infinite gradeD',
      { gradeD: Number.POSITIVE_INFINITY },
      'freshnessScoring.thresholds.gradeD must be a finite number between 0 and 100',
    ],
    ['gradeA equal to gradeB', { gradeA: 80 }, orderingError(80, 80, 70, 60)],
    ['gradeB equal to gradeC', { gradeB: 70 }, orderingError(90, 70, 70, 60)],
    ['gradeC equal to gradeD', { gradeC: 60 }, orderingError(90, 80, 60, 60)],
    ['gradeD above gradeC', { gradeD: 75 }, orderingError(90, 80, 70, 75)],
  ])('rejects %s', (_name, thresholds, message) => {
    expect(() => validateConfig({ freshnessScoring: { thresholds } })).toThrow(message);
  });

  it.each([
    [
      'maximum timeout and weight total of one',
      {
        urlValidation: { enabled: false, timeout: 2_147_483_647, concurrency: 1 },
        freshnessScoring: {
          enabled: false,
          weights: { referenceValidity: 0.4, gitTimeDelta: 0.3, codeChangeFrequency: 0.15, symbolCoverage: 0.15 },
          thresholds: { gradeA: 100, gradeD: 0 },
        },
      },
    ],
    [
      'minimum timeout and supported partial weight override',
      {
        urlValidation: { enabled: false, timeout: Number.MIN_VALUE, concurrency: 1 },
        freshnessScoring: { enabled: false, weights: { referenceValidity: 0.5 } },
      },
    ],
  ] as const)('accepts %s', (_name, config) => {
    expect(() => validateConfig(config)).not.toThrow();
  });
});
