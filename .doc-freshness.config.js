/**
 * Documentation Freshness Checker Configuration
 *
 * @type {import('./dist/index.js').DocFreshnessConfig}
 */
export default {
  // Documentation files to check
  include: ['docs/**/*.md', 'README.md', 'CONTRIBUTING.md'],

  // Files to exclude
  exclude: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**'],

  // Manifest files to read for version/dependency checking
  // Auto-detected if not specified
  // manifestFiles: ['package.json'],

  // Source code patterns for code pattern validation
  // Auto-detected if not specified
  // sourcePatterns: ['src/**/*.{ts,tsx,js,jsx}'],

  // URL validation settings
  urlValidation: {
    enabled: true,
    timeout: 10000,
    concurrency: 5,
    skipDomains: ['localhost', '127.0.0.1', 'example.com'],
  },

  // Validation rules configuration
  rules: {
    'file-path': {
      enabled: true,
      severity: 'error',
    },
    'external-url': {
      enabled: true,
      severity: 'warning',
    },
    version: {
      enabled: true,
      severity: 'warning',
    },
    'directory-structure': {
      enabled: true,
      severity: 'warning',
    },
    'code-pattern': {
      enabled: true,
      severity: 'warning',
    },
    dependency: {
      enabled: true,
      severity: 'info',
    },
  },

  // Reporter configuration
  reporters: ['console'],

  // Enable freshness scoring
  freshnessScoring: {
    enabled: false,
    weights: {
      referenceValidity: 0.4,
      gitTimeDelta: 0.3,
      codeChangeFrequency: 0.15,
      symbolCoverage: 0.15,
    },
  },

  // Cache settings
  cache: {
    enabled: true,
    dir: '.doc-freshness-cache',
  },
};
