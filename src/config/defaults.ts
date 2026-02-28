import type { DocFreshnessConfig } from '../types.js';

/**
 * Default configuration values for Documentation Freshness Checker
 */
export const DEFAULT_CONFIG: DocFreshnessConfig = {
  // Root directory for resolving paths (defaults to process.cwd())
  rootDir: process.cwd(),

  // Documentation files to check
  include: ['docs/**/*.md', 'README.md'],

  // Files to exclude
  exclude: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**'],

  // Manifest files to read for version/dependency checking
  // Auto-detected if not specified
  manifestFiles: null,

  // Source code patterns for code pattern validation
  // Auto-detected if not specified
  sourcePatterns: null,

  // URL validation settings
  urlValidation: {
    enabled: true,
    timeout: 10000,
    concurrency: 5,
    skipDomains: ['localhost', '127.0.0.1', 'example.com'],
    cacheSeconds: 3600,
  },

  // Validation rules configuration
  rules: {
    'file-path': {
      enabled: true,
      severity: 'error',
      // Patterns to identify illustrative/placeholder paths (regex strings)
      illustrativePatterns: [
        // Generic placeholder prefixes (case-insensitive match on filename)
        '^(?:Your|My|Example|Sample|Demo|Test|Foo|Bar|Baz|Dummy|Mock|Fake|Stub)',
        // Common tutorial placeholders
        '^(?:first|second|third|another|some|new)\\.',
        // Placeholder with angle brackets or curly braces in name
        '<[^>]+>',
        '\\{[^}]+\\}',
        // Paths containing obvious placeholder segments
        '/(?:your|my|example|sample)-',
        '/\\[.*\\]/', // Paths with [brackets]
      ],
      skipIllustrative: true,
    },
    'external-url': {
      enabled: true,
      severity: 'warning',
    },
    version: {
      enabled: true,
      severity: 'warning',
      allowMinorDrift: true,
    },
    'directory-structure': {
      enabled: true,
      severity: 'warning',
      // Patterns to identify illustrative/placeholder paths in directory trees
      illustrativePatterns: [
        // Generic placeholder prefixes (case-insensitive match on filename)
        '^(?:Your|My|Example|Sample|Demo|Test|Foo|Bar|Baz|Dummy|Mock|Fake|Stub)',
        // Common tutorial placeholders
        '^(?:first|second|third|another|some|new)\\.',
        // Very short generic names without extensions (likely placeholders)
        '^(?:foo|bar|baz|qux|quux)$',
      ],
      skipIllustrative: true,
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

  // Output directory for reports
  outputDir: '.doc-freshness-reports',

  // Ignore patterns (regex strings)
  ignorePatterns: [],

  // Custom extractors (advanced)
  customExtractors: [],

  // Custom validators (advanced)
  customValidators: {},

  // Code-to-Doc Graph settings
  graph: {
    enabled: true,
    cacheDir: '.doc-freshness-cache',
    cacheMaxAge: 24 * 60 * 60 * 1000, // 24 hours for non-git repos
  },

  // Git integration settings
  git: {
    enabled: true, // Auto-detected
    trackChanges: true, // Enable incremental checking
    changeWindow: 7, // Days to look back for changes
  },

  // Freshness scoring settings
  freshnessScoring: {
    enabled: false,
    weights: {
      referenceValidity: 0.4,
      gitTimeDelta: 0.3,
      codeChangeFrequency: 0.15,
      symbolCoverage: 0.15,
    },
    thresholds: {
      gradeA: 90,
      gradeB: 80,
      gradeC: 70,
      gradeD: 60,
    },
  },

  // Vector search settings (optional, requires fastembed package)
  vectorSearch: {
    enabled: false, // Disabled by default
    similarityThreshold: 0.3, // Lower = stricter matching
    indexCodeComments: true,
    indexDocstrings: true,
  },

  // Cache settings
  cache: {
    enabled: true,
    dir: '.doc-freshness-cache',
    maxAge: 24 * 60 * 60 * 1000,
  },

  // Incremental checking (only check changed files)
  incremental: {
    enabled: false,
  },

  // Verbose logging
  verbose: false,
};
