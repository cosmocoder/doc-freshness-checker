# Documentation Freshness Checker

A **universal, project-agnostic** tool that validates documentation accuracy by checking references against the actual codebase. It detects stale documentation, broken links, outdated version references, and missing code patterns.

## Features

- **Language Agnostic**: Works with any programming language (JavaScript, TypeScript, Python, Go, Rust, Java, etc.)
- **Package Manager Agnostic**: Supports npm, yarn, pnpm, pip, cargo, go modules, Maven, Gradle, and more
- **Documentation Format Support**: Validates markdown (.md), reStructuredText (.rst), AsciiDoc (.adoc), and more
- **Flexible Configuration**: Adapts to any project structure - monorepos, microservices, or simple libraries
- **CI/CD Ready**: Built-in support for GitHub Actions, GitLab CI, CircleCI, and other CI platforms

## Quick Start

### Installation

```bash
# Install globally
npm install -g doc-freshness-checker

# Or add to your project
npm install --save-dev doc-freshness-checker
```

### Zero-Config Usage

The tool works out of the box with sensible defaults:

```bash
# Check all markdown files in docs/ and README.md
doc-freshness
```

### Basic Configuration

Create a config file in your project root. The tool searches for these names (in order):

- `.doc-freshness.config.js`
- `.doc-freshness.config.json`
- `doc-freshness.config.js`
- `doc-freshness.config.json`

```javascript
export default {
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**'],
};
```

### Type-Safe Configuration

Get full IntelliSense and type checking for your configuration file. First, install as a dev dependency:

```bash
npm install --save-dev doc-freshness-checker
```

#### Option 1: Using `defineConfig` (Recommended)

The `defineConfig` helper provides type inference without needing TypeScript:

```javascript
// .doc-freshness.config.js
import { defineConfig } from 'doc-freshness-checker';

export default defineConfig({
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**'],
  rules: {
    'file-path': { enabled: true, severity: 'error' },
    'external-url': { enabled: true, severity: 'warning' },
  },
});
```

#### Option 2: Using JSDoc Type Annotation

For projects that can't use ESM imports, use a JSDoc annotation:

```javascript
// .doc-freshness.config.js

/** @type {import('doc-freshness-checker').DocFreshnessConfig} */
export default {
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**'],
};
```

This also works with CommonJS:

```javascript
// .doc-freshness.config.cjs

/** @type {import('doc-freshness-checker').DocFreshnessConfig} */
module.exports = {
  include: ['docs/**/*.md', 'README.md'],
};
```

#### Option 3: TypeScript Configuration

You can use a TypeScript config file directly:

```typescript
// .doc-freshness.config.ts
import type { DocFreshnessConfig } from 'doc-freshness-checker';

const config: DocFreshnessConfig = {
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**'],
  rules: {
    'file-path': { enabled: true, severity: 'error' },
  },
};

export default config;
```

> **Note**: TypeScript config files require a runtime that supports `.ts` files (e.g., `tsx`, `ts-node`, or Node.js 22+ with `--experimental-strip-types`).

## Usage

### Command Line Options

```bash
doc-freshness [options]

Options:
  -c, --config <path>     Path to config file
  -r, --reporter <type>   Reporter type (console, json, markdown, enhanced)
  -o, --output <path>     Output file path for reports
  -v, --verbose           Enable verbose logging
  --fix                   Show fix suggestions
  --only <types>          Only check specific reference types (comma-separated)
  --skip-urls             Skip URL validation
  --files <patterns>      Only check specific files (comma-separated glob patterns)
  --manifest <files>      Manifest files to use (comma-separated)
  --source <patterns>     Source patterns to use (comma-separated)
  --no-cache              Disable caching
  --clear-cache           Clear cache before running
  --score                 Include freshness scores in report
  --incremental           Only check changed files (requires cache)
  --vector-search         Enable semantic vector search for doc-code mismatches
```

### Examples

```bash
# Basic check with console output
doc-freshness

# Generate JSON report
doc-freshness --reporter json --output reports/doc-freshness.json

# Generate Markdown report
doc-freshness --reporter markdown --output reports/doc-freshness.md

# Skip URL validation (faster)
doc-freshness --skip-urls

# Check only specific files
doc-freshness --files "README.md,docs/api.md"

# Include freshness scores
doc-freshness --score

# Incremental mode - only check changed files (faster for large projects)
doc-freshness --incremental

# Verbose output for debugging
doc-freshness --verbose
```

## What It Checks

### Reference Types

| Type | Description |
|------|-------------|
| **file-path** | Links to files/directories (e.g., `[readme](./README.md)`) |
| **external-url** | External URLs (e.g., `https://example.com`) |
| **version** | Version mentions (e.g., "Node.js 18.x", "React 18.2.0") |
| **directory-structure** | ASCII tree structures in code blocks |
| **code-pattern** | Code symbols in fenced code blocks (classes, functions) |
| **dependency** | Package names in backticks |

#### Smart URL Validation

The URL validator includes intelligent handling for common cases:

- **Deduplication**: Each unique URL is checked only once, even if referenced multiple times
- **Template URLs**: URLs with placeholders (`${...}`, `{{...}}`) are automatically skipped
- **GitHub private repos**: 404s from `github.com` are treated as potentially valid (private repos return 404 to unauthenticated requests)
- **Authentication-required**: 401/403 responses are treated as valid with a note
- **Skip domains**: Configure `urlValidation.skipDomains` to skip internal domains (`localhost`, `127.0.0.1`, and `example.com` are skipped by default)
- **Caching**: Results are cached (default `cacheSeconds: 3600` — 1 hour) to speed up subsequent runs

### Validation Rules

Each reference type can be configured with:
- `enabled`: Whether to check this type
- `severity`: `error`, `warning`, or `info`

The `version` rule also supports:
- `allowMinorDrift`: When `true` (default), only major version mismatches are flagged as issues; minor/patch differences are tolerated

### Illustrative Path Detection

Documentation often contains **illustrative paths** — example file names or code patterns used in tutorials that don't represent actual files in the codebase. The tool automatically detects and skips these to reduce false positives.

#### Default Patterns

The following patterns are detected as illustrative by default:

**File/Directory Paths:**
- Placeholder prefixes: `YourComponent.tsx`, `MyService.ts`, `ExampleConfig.js`
- Tutorial placeholders: `first.ts`, `second.js`, `another-file.py`
- Generic names: `foo`, `bar`, `baz`
- Template syntax: `<your-file>.ts`, `{filename}.js`

**Code Symbols:**
- Placeholder classes/functions: `YourClass`, `MyFunction`, `ExampleComponent`
- HTTP method names (common in REST tutorials): `POST`, `GET`, `PUT`
- Very short names (likely false positives): `a`, `no`, `to`
- Common tutorial components: `Chat`, `App`, `Button`, `Modal`, `Form`, etc.

#### Configuring Illustrative Patterns

You can add custom patterns or disable the feature:

```javascript
export default {
  rules: {
    'file-path': {
      enabled: true,
      severity: 'error',
      // Add custom patterns (regex strings, case-insensitive)
      illustrativePatterns: [
        '^Internal',           // Match files starting with "Internal"
        'placeholder',         // Match files containing "placeholder"
        '/templates/',         // Match paths containing /templates/
      ],
      // Skip validation for illustrative paths (default: true)
      // Set to false to validate them with reduced severity (info)
      skipIllustrative: true,
    },
    'directory-structure': {
      enabled: true,
      severity: 'warning',
      illustrativePatterns: [
        '^Your',               // Match entries starting with "Your"
      ],
      skipIllustrative: true,
    },
  },
};
```

#### Line Number References

File paths with line number suffixes are automatically parsed correctly:

| Documentation Reference | Validated Path |
|------------------------|----------------|
| `../src/file.ts:42` | `../src/file.ts` |
| `../src/file.ts:10-25` | `../src/file.ts` |
| `./component.tsx#L100` | `./component.tsx` |
| `./utils.js#L50-L75` | `./utils.js` |

The line number reference is stripped before validation and stored as metadata.

## Configuration

### Full Configuration Example

```javascript
// .doc-freshness.config.js

/** @type {import('doc-freshness-checker').DocFreshnessConfig} */
export default {
  // Root directory (defaults to process.cwd())
  rootDir: process.cwd(),

  // Documentation files to check
  include: ['docs/**/*.md', 'README.md', 'CONTRIBUTING.md'],

  // Files to exclude
  exclude: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/build/**'],

  // Manifest files for version checking (auto-detected if null)
  manifestFiles: ['package.json'],

  // Source code patterns (auto-detected if null)
  sourcePatterns: ['src/**/*.{ts,tsx,js,jsx}'],

  // URL validation settings
  urlValidation: {
    enabled: true,
    timeout: 10000,
    concurrency: 5,
    skipDomains: ['localhost', '127.0.0.1', 'example.com'],
    cacheSeconds: 3600,
  },

  // Validation rules
  rules: {
    'file-path': {
      enabled: true,
      severity: 'error',
      illustrativePatterns: [],
      skipIllustrative: true,
    },
    'external-url': { enabled: true, severity: 'warning' },
    'version': {
      enabled: true,
      severity: 'warning',
      allowMinorDrift: true,
    },
    'directory-structure': {
      enabled: true,
      severity: 'warning',
      illustrativePatterns: [],
      skipIllustrative: true,
    },
    'code-pattern': { enabled: true, severity: 'warning' },
    'dependency': { enabled: true, severity: 'info' },
  },

  // Reporters
  reporters: ['console'],

  // Output directory for reports
  outputDir: '.doc-freshness-reports',

  // Code-to-Doc graph
  graph: {
    enabled: true,
    cacheDir: '.doc-freshness-cache',
    cacheMaxAge: 86400000, // 24 hours
  },

  // Git integration
  git: {
    enabled: true,
    trackChanges: true,
    changeWindow: 7, // Days to look back
  },

  // Freshness scoring
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

  // Semantic vector search (disabled by default)
  vectorSearch: {
    enabled: false,
    similarityThreshold: 0.3,
    indexCodeComments: true,
    indexDocstrings: true,
  },

  // Caching
  cache: {
    enabled: true,
    dir: '.doc-freshness-cache',
    maxAge: 86400000, // 24 hours
  },

  // Incremental checking (only check changed files)
  incremental: {
    enabled: false,
  },

  // Verbose logging
  verbose: false,
};
```

### Project-Specific Examples

#### Python Project

```javascript
export default {
  include: ['docs/**/*.{md,rst}', 'README.md'],
  exclude: ['**/.venv/**', '**/venv/**'],
  manifestFiles: ['requirements.txt', 'pyproject.toml'],
  sourcePatterns: ['src/**/*.py', 'app/**/*.py'],
};
```

#### Go Project

```javascript
export default {
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/vendor/**'],
  manifestFiles: ['go.mod'],
  sourcePatterns: ['**/*.go', '!**/*_test.go'],
};
```

#### Monorepo

```javascript
export default {
  include: ['docs/**/*.md', 'README.md', 'packages/*/README.md'],
  exclude: ['**/node_modules/**', '**/dist/**'],
  manifestFiles: ['package.json', 'packages/*/package.json'],
  sourcePatterns: ['packages/*/src/**/*.{ts,tsx}'],
};
```

## Advanced Features

### Incremental Checking

For large projects, incremental mode only checks documentation files that have changed since the last run. This can significantly speed up repeated checks.

```bash
# Enable incremental mode
doc-freshness --incremental

# First run: checks all files, saves hashes
# Second run: only checks files that changed
```

Incremental checking uses file hashes stored in `.doc-freshness-cache/file-hashes.json`. Clear the cache to force a full check:

```bash
doc-freshness --clear-cache
```

### Freshness Scoring

Get a quantitative freshness score for your documentation:

```bash
doc-freshness --score
```

Scores are calculated based on:
- Reference validity (40%)
- Git time delta between docs and code (30%)
- Code change frequency (15%)
- Symbol coverage (15%)

Grades: A (90+), B (80+), C (70+), D (60+), F (<60)

### Vector Search (Optional)

For semantic similarity matching between documentation and code comments, enable vector search in your config:

```javascript
export default {
  vectorSearch: {
    enabled: true,
    similarityThreshold: 0.3,  // Lower = stricter matching
  },
};
```

When enabled, the tool will:
1. Automatically download the BGE-Small-EN embedding model on first run (cached in `~/.doc-freshness/fastembed-cache/`)
2. Generate embeddings for your documentation sections and code comments
3. Cache embeddings incrementally - only re-embedding changed content on subsequent runs
4. Detect when documentation describes functionality that doesn't exist in the codebase

This feature runs entirely locally with no external API calls.

### Code-to-Doc Graph

The tool builds a bidirectional graph linking documentation files to the source code they reference. This enables:

- Tracking which docs need updating when specific code files change
- Identifying undocumented code files
- Git-aware change detection

The graph is cached in `.doc-freshness-cache/graph-cache.json` for incremental updates.

### Enhanced Reporter

For detailed reports, use the enhanced reporter:

```bash
doc-freshness --reporter enhanced --output report.md
```

This generates a comprehensive report including:
- Affected documentation files
- Reason for each issue
- Code file references
- Freshness scores (if enabled)
- Git change information

## CI/CD Integration

### GitHub Actions

Copy `.github/workflows/doc-freshness.yml` to your repository:

```yaml
name: Documentation Freshness Check

on:
  schedule:
    - cron: '0 9 * * 1'  # Weekly on Monday
  pull_request:
    paths:
      - 'docs/**'
      - '*.md'

jobs:
  check-freshness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '24.x'
      - run: npm ci
      - run: npx doc-freshness --reporter markdown --output report.md
```

## Programmatic Usage

```javascript
import { run, loadConfig } from 'doc-freshness-checker';

// With default config
const results = await run(await loadConfig());

// With custom config
const results = await run({
  include: ['README.md'],
  rules: {
    'file-path': { enabled: true, severity: 'error' },
  },
});

console.log(`Errors: ${results.summary.errors}`);
console.log(`Warnings: ${results.summary.warnings}`);
```

## License

MIT
