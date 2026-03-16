# Documentation Freshness Checker

[![npm version](https://img.shields.io/npm/v/doc-freshness-checker.svg)](https://www.npmjs.com/package/doc-freshness-checker)
[![npm downloads](https://img.shields.io/npm/dm/doc-freshness-checker.svg)](https://www.npmjs.com/package/doc-freshness-checker)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.0-brightgreen.svg)](https://nodejs.org/)
[![CI](https://github.com/cosmocoder/doc-freshness-checker/actions/workflows/release.yml/badge.svg)](https://github.com/cosmocoder/doc-freshness-checker/actions/workflows/release.yml)

Validate documentation against your codebase to catch stale references before they create confusion or slow onboarding. `doc-freshness-checker` scans your docs, extracts references to files, URLs, versions, symbols, dependencies, and directory trees, then validates each one against source code and manifests.

## Table of Contents

- [Why Use It](#why-use-it)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [What Gets Validated](#what-gets-validated)
- [Configuration](#configuration)
- [CI Integration](#ci-integration)
- [Programmatic API](#programmatic-api)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## Why Use It

- Reduce drift between docs and implementation.
- Catch broken file links and dead external URLs.
- Detect version mismatches between docs and manifests.
- Surface code symbols mentioned in docs that no longer exist.
- Detect stale code examples — wrong imports, changed function signatures, outdated config keys.
- Run in CI as a quality gate or reporting step.

## Features

- **Documentation formats:** Markdown (`.md`, `.markdown`), reStructuredText (`.rst`), AsciiDoc (`.adoc`, `.asciidoc`), plaintext (`.txt`).
- **Source indexing for symbol validation:** JavaScript, TypeScript, Python, Go, Rust, Java.
- **Code snippet validation:** verifies import paths resolve, imported symbols are exported, function call signatures still match example placeholders, and config object keys match type/interface definitions.
- **Manifest parsing for version/dependency checks:** `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`.
- **Reporters:** `console`, `json`, `markdown`, `enhanced`.
- **Advanced modes:** incremental checking, freshness scoring, graph linking, semantic vector search.

## Prerequisites

- **Node.js** >= 22.19.0
- **npm**

## Installation

```bash
npm install --save-dev doc-freshness-checker
```

Global installation is also supported:

```bash
npm install -g doc-freshness-checker
```

## Quick Start

Run with defaults (checks `docs/**/*.md` and `README.md`):

```bash
doc-freshness
```

Example console output:

```
📚 Documentation Freshness Report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Summary:
   Total references checked: 42
   ✅ Valid: 38
   ❌ Errors: 2
   ⚠️  Warnings: 2
   ⏭️  Skipped: 0

📋 Issues by Document:

📄 docs/getting-started.md
────────────────────────────────────────
  ❌ Line 14: File not found: src/old-module.ts
     💡 File may have been moved or renamed
  ⚠️  Line 27: Version mismatch: docs say 2.1.0, package.json has 3.0.0

📄 README.md
────────────────────────────────────────
  ❌ Line 45: Broken URL: https://example.com/dead-link (404)
  ⚠️  Line 82: Symbol not found in source: calculateTotal()
     💡 Symbol may have been renamed or removed
```

Create a minimal config:

```js
// .doc-freshness.config.js
export default {
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**'],
};
```

Generate a Markdown report file:

```bash
doc-freshness --reporter markdown --output .doc-freshness-reports/report.md
```

## CLI Reference

```bash
doc-freshness [options]

Options:
  -c, --config <path>     Path to config file
  -r, --reporter <type>   Reporter type (console, json, markdown, enhanced)
  -o, --output <path>     Output file path for reports
  -v, --verbose           Enable verbose logging
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

### Common Examples

```bash
# Basic scan
doc-freshness

# JSON report file
doc-freshness --reporter json --output reports/doc-freshness.json

# Faster run when network checks are not needed
doc-freshness --skip-urls

# Restrict to selected files
doc-freshness --files "README.md,docs/usage.md"

# Enable scoring and incremental mode
doc-freshness --score --incremental
```

### Exit Codes

- `0`: no validation errors
- `1`: at least one validation error, or runtime/config failure

## What Gets Validated

| Reference type        | What is checked                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| `file-path`           | Referenced files/directories exist                                                |
| `external-url`        | External URLs are reachable (with caching and skip rules)                         |
| `version`             | Mentioned versions compared to parsed manifests                                   |
| `directory-structure` | Tree snippets align with actual structure                                         |
| `code-pattern`        | Mentioned symbols exist in indexed source                                         |
| `code-snippet`        | Import paths resolve, exported symbols exist, function signatures still match, config keys valid |
| `dependency`          | Mentioned packages exist in manifest dependencies                                 |

### URL Validation Behavior

- Deduplicates repeated URLs per run.
- Skips template-like URLs with placeholders.
- Supports skip domains (defaults include `localhost`, `127.0.0.1`, `example.com`).
- Treats auth-required responses (`401`/`403`) as valid-with-note.
- Handles GitHub `404` private-repo behavior conservatively.
- Caches URL results to reduce repeated checks.

### Code Snippet Validation

Fenced code blocks in documentation go stale just as quickly as any other reference. The `code-snippet` rule validates three aspects of code examples:

**Import statements** — verifies that the module path resolves to an actual source file and that each imported symbol is exported from it. Only relative imports are checked; bare npm/package imports are skipped.

If your docs contain:

````markdown
```typescript
import { createUser, sendWelcomeEmail } from './services/userService';
```
````

The checker resolves `./services/userService` against the project source tree (trying common extensions and index files) and confirms that `createUser` and `sendWelcomeEmail` are exported. If `sendWelcomeEmail` was renamed to `sendOnboardingEmail`, the report shows:

```
⚠️  Line 12: Symbol(s) not exported from src/services/userService.ts: sendWelcomeEmail
   💡 Did you mean: sendOnboardingEmail?
```

**Function signatures** — checks that the number of arguments shown in a code example matches the function's current signature, accounting for optional and rest parameters. When an example uses simple placeholder identifiers like `name, email`, those are also compared to the current parameter names to catch renamed positional parameters.

````markdown
```typescript
const user = createUser(name, email, role, department);
```
````

If `createUser` now takes only `(name, email, role?)`, the report shows:

```
⚠️  Line 18: Function createUser called with 4 arg(s) but expects 2–3
   💡 Current signature: createUser(name, email, role)
```

**Config object keys** — when a code example assigns an object with an explicit type annotation, each key is checked against the type/interface definition in source.

````markdown
```typescript
const opts: ServerConfig = {
  port: 3000,
  hostname: 'localhost',
  maxRetries: 5,
};
```
````

If `ServerConfig` no longer has a `hostname` property (renamed to `host`):

```
⚠️  Line 24: Config key(s) not found in ServerConfig: hostname
   💡 Did you mean: hostname → host?
```

Each sub-check can be toggled independently:

```js
rules: {
  'code-snippet': {
    enabled: true,
    severity: 'warning',
    validateImports: true,
    validateFunctionCalls: true,
    validateConfigKeys: true,
  },
},
```

### False Positive Reduction

Illustrative paths and symbols (e.g., tutorial placeholders) are detected automatically and can be skipped or downgraded in severity via rule configuration.

## Configuration

### Auto-Discovery

When `--config` is not provided, the loader checks these names in project root:

- `.doc-freshness.config.js`
- `.doc-freshness.config.json`
- `doc-freshness.config.js`
- `doc-freshness.config.json`

### Explicit Config Path

With `--config`, the loader supports `.json`, `.cjs`, and JS/ESM config files.

### Type-Safe Config

Use `defineConfig` for better editor inference:

```js
import { defineConfig } from 'doc-freshness-checker';

export default defineConfig({
  include: ['docs/**/*.md', 'README.md'],
  rules: {
    'file-path': { enabled: true, severity: 'error' },
    'external-url': { enabled: true, severity: 'warning' },
  },
});
```

<details>
<summary>Full configuration example</summary>

```js
/** @type {import('doc-freshness-checker').DocFreshnessConfig} */
export default {
  rootDir: process.cwd(),
  include: ['docs/**/*.md', 'README.md'],
  exclude: ['**/node_modules/**', '**/dist/**'],

  // Optional: auto-detected when null/omitted
  manifestFiles: null,
  sourcePatterns: null,

  urlValidation: {
    enabled: true,
    timeout: 10000,
    concurrency: 5,
    skipDomains: ['localhost', '127.0.0.1', 'example.com'],
    cacheSeconds: 3600,
  },

  rules: {
    'file-path': { enabled: true, severity: 'error' },
    'external-url': { enabled: true, severity: 'warning' },
    version: { enabled: true, severity: 'warning' },
    'directory-structure': { enabled: true, severity: 'warning' },
    'code-pattern': { enabled: true, severity: 'warning' },
    'code-snippet': { enabled: true, severity: 'warning' },
    dependency: { enabled: true, severity: 'info' },
  },

  reporters: ['console'],
  cache: { enabled: true, dir: '.doc-freshness-cache', maxAge: 86400000 },
  incremental: { enabled: false },
  vectorSearch: { enabled: false, similarityThreshold: 0.3 },
  verbose: false,
};
```

</details>

For details on CLI-to-config mapping and precedence, see [CLI and Configuration Precedence](docs/cli-and-config-precedence.md). For the internal execution pipeline, see [Runtime Architecture](docs/runtime-architecture.md).

## CI Integration

This repository includes a GitHub Actions workflow at `.github/workflows/doc-freshness.yml` for a working example.

Minimal CI command:

```bash
npx doc-freshness --reporter markdown --output .doc-freshness-reports/report.md
```

The same command works in GitHub Actions, GitLab CI, CircleCI, and other CI systems.

## Programmatic API

```js
import { loadConfig, run } from 'doc-freshness-checker';

const config = await loadConfig();
const results = await run(config);

console.log(results.summary);
```

Key exports:

| Export                                                                    | Purpose                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `run`, `runWithConfig`                                                    | Execute the checker programmatically                 |
| `loadConfig`, `defineConfig`                                              | Load/merge configuration and type-safe config helper |
| `DocumentParser`                                                          | Parse documentation files and extract references     |
| `CodeSnippetExtractor`, `CodeSnippetValidator`                            | Code example validation (imports, calls, config)     |
| `ValidationEngine`                                                        | Dispatch references to validators                    |
| `ConsoleReporter`, `JsonReporter`, `MarkdownReporter`, `EnhancedReporter` | Reporter classes                                     |
| `GraphBuilder`, `FreshnessScorer`, `VectorSearch`                         | Advanced analysis modules                            |
| `DocFreshnessConfig`, `ValidationResults`                                 | Core types                                           |

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, development workflow, and PR guidelines.

## Acknowledgments

- [Commander.js](https://github.com/tj/commander.js/) — CLI argument parsing
- [glob](https://github.com/isaacs/node-glob) — File pattern matching
- [semver](https://github.com/npm/node-semver) — Semantic version parsing and comparison
- [FastEmbed](https://github.com/Anush008/fastembed) — Local embedding generation for semantic checks

## License

MIT License — see [LICENSE](LICENSE) for details.
