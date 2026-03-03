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

## Commit Message Style

Conventional Commit style is recommended to match existing history:

- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `test: ...`
- `chore: ...`

This style is recommended but not enforced by commit hooks.

## CI Notes

This repository includes a GitHub Actions workflow focused on documentation freshness reporting. It helps surface issues in PRs and scheduled runs.

If your change affects runtime behavior, still run tests/lint/typecheck locally even when CI is not enforcing all of them yet.

## Editor Recommendations

VS Code extension recommendations:

- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`

Workspace settings already include ESLint flat config support and Prettier defaults for JS/TS.
