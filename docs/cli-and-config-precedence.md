# CLI and Configuration Precedence

This document explains how effective runtime configuration is computed and how key flags interact.

## Precedence Order

Final config is assembled in this order:

1. Built-in defaults (`DEFAULT_CONFIG`)
2. Config file values (`loadConfig`)
3. CLI overrides (`applyCliOverrides`)

In short: **CLI flags win over config file, config file wins over defaults**.

## Config Discovery Behavior

When `--config` is omitted, the loader checks these filenames in project root:

- `.doc-freshness.config.js`
- `.doc-freshness.config.json`
- `doc-freshness.config.js`
- `doc-freshness.config.json`

If none are found, defaults are used with auto-detection for some values.

When you provide `--config <path>`, the loader reads that file directly.

## Auto-Detected Values

When these fields are `null`/unset, they are auto-detected:

- `manifestFiles`
- `sourcePatterns`

Manifest candidate list includes:

- `package.json`
- `requirements.txt`
- `pyproject.toml`
- `go.mod`
- `Cargo.toml`
- `pom.xml`
- `build.gradle` (detection candidate only; parser support is not currently implemented for validation)

## Flag-to-Config Mapping

| CLI flag | Effective config impact |
| --- | --- |
| `--reporter <type>` | `config.reporters = [type]` |
| `--output <path>` | `config.outputPath = path` |
| `--verbose` | `config.verbose = true` |
| `--skip-urls` | `config.urlValidation.enabled = false` |
| `--only <types>` | Enables only listed rule keys inside `config.rules` |
| `--files <patterns>` | Replaces `config.include` |
| `--manifest <files>` | Replaces `config.manifestFiles` |
| `--source <patterns>` | Replaces `config.sourcePatterns` |
| `--no-cache` | Sets `config.cache.enabled = false` |
| `--clear-cache` | Sets `config.clearCache = true` |
| `--score` | Sets `config.freshnessScoring.enabled = true` |
| `--incremental` | Sets `config.incremental.enabled = true` |
| `--vector-search` | Sets `config.vectorSearch.enabled = true` |

## Important Interactions and Caveats

- `--only` only toggles rules that already exist in `config.rules`.
- `--files`, `--manifest`, and `--source` are comma-split lists and replace prior values.
- `--no-cache` disables cache usage; `--clear-cache` still requests cache clearing early in runtime.
- `--output` controls file output for reporters that emit string payloads (`json`, `markdown`, `enhanced`).
- The `console` reporter prints directly and does not use `outputPath`.

## Exit Code Semantics

- Exit code `1` when:
  - at least one validation error exists, or
  - runtime/config loading fails.
- Exit code `0` otherwise.

## Practical CI Pattern

Use CLI overrides for environment-specific behavior while keeping shared defaults in config:

```bash
npx doc-freshness --reporter markdown --output .doc-freshness-reports/report.md --skip-urls
```

This keeps shared settings in config and CI-specific output flags in the workflow/job.
