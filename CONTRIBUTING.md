# Contributing

Thanks for contributing to `doc-freshness-checker`.

This guide covers the current workflow used in this repository.

## Prerequisites

- Node.js `>=22.19.0`
- npm

The repo enforces Node engine compatibility (`engine-strict=true`), so installs fail on unsupported Node versions.

## Install

```bash
npm ci
```

## Build

```bash
npm run build
```

For iterative development:

```bash
npm run build:watch
```

## Local Quality Checks

Run these checks before opening a PR:

```bash
# Unit tests
npm test

# Type check
npm run test:types

# Lint
npm run lint

# Formatting check
npm run prettier:ci
```

Auto-fix helpers:

```bash
npm run lint:fix
npm run prettier
```

## Documentation Freshness Checks

The docs-check scripts run the built CLI from `dist`, so build first on a clean clone.

```bash
npm run build
npm run docs:check
npm run docs:check:json
```

The JSON script writes a report to `reports/doc-freshness.json`.

## Typical Development Loop

```bash
npm ci
npm run build
npm test
npm run lint
npm run prettier:ci
```

When changing docs behavior or examples, also run:

```bash
npm run docs:check
```

## Pull Request Guidelines

- Keep PRs focused and explain the user-visible impact.
- Add or update tests for behavior changes.
- Update documentation when CLI/config behavior changes.
- Include a short test plan in the PR description.

## Commit Conventions

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and release notes generation. Your commit messages directly impact the changelog and version bumps, so please follow these conventions carefully.

### Commit Message Format

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type**: The type of change (see below)
- **scope**: Optional, the area of the codebase affected
- **subject**: A short description of the change (imperative mood, no period)
- **body**: Optional, detailed description of the change
- **footer**: Optional, for breaking changes or issue references

### Commit Types and Release Impact

| Type | Description | Release Impact |
|------|-------------|----------------|
| `feat` | A new feature | **Minor** version bump (1.x.0) |
| `fix` | A bug fix | **Patch** version bump (1.0.x) |
| `perf` | Performance improvement | **Patch** version bump |
| `docs` | Documentation only | No release |
| `style` | Code style (formatting, etc.) | No release |
| `refactor` | Code change that neither fixes nor adds | No release |
| `test` | Adding or updating tests | No release |
| `chore` | Maintenance tasks | No release |
| `ci` | CI/CD changes | No release |
| `build` | Build system changes | No release |

### Commit Strategy for Pull Requests

**For feature PRs:**

1. **Primary commit** — Use `feat` prefix for the main feature:
   ```
   feat(checker): add custom rule support for freshness checks
   ```

2. **Follow-up fixes within the same PR** — Use `chore` or `refactor` for bug fixes or improvements to your new feature:
   ```
   chore(checker): fix typo in rule validation logic
   refactor(checker): simplify rule matching
   ```

   This ensures only the main feature appears in release notes, not every small fix you made while developing it.

3. **Unrelated bug fixes** — If you discover and fix a bug unrelated to your feature, use `fix`:
   ```
   fix(cli): handle missing config file gracefully
   ```

**For bug fix PRs:**

- Use `fix` prefix for the primary commit:
  ```
  fix(reporter): correct line number offset in JSON output
  ```

**For documentation/maintenance PRs:**

- Use `docs`, `chore`, `refactor`, etc. as appropriate

### Writing Good Commit Bodies

The commit body is included in release notes, so write it for your users! Use it to explain:
- What the change does and why
- Any important details or caveats
- Sub-features or components (use `-` for bullet points)

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit footer:

```
feat(cli): change default output format

BREAKING CHANGE: The default reporter is now JSON instead of text.
Update scripts that parse stdout to handle the new format.
```

This triggers a **major** version bump (x.0.0).

## CI and Release Notes

The GitHub Actions workflow runs linting, type checking, tests, and builds on every push. The release job runs only on `main` and `beta` branches, publishing to npm via semantic-release with npm provenance enabled.

If your change affects runtime behavior, run tests/lint/typecheck locally before pushing.

## Editor Recommendations

VS Code extension recommendations:

- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`

Workspace settings already include ESLint flat config support and Prettier defaults for JS/TS.
