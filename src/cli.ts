#!/usr/bin/env node

import { Command } from 'commander';
import { run } from './runner.js';
import { loadConfig } from './config/loader.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import type { DocFreshnessConfig, ValidationResults } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface PackageJson {
  version: string;
}

const packageJson: PackageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

export interface CLIOptions {
  config?: string;
  reporter?: string;
  output?: string;
  verbose?: boolean;
  fix?: boolean;
  only?: string;
  skipUrls?: boolean;
  files?: string;
  manifest?: string;
  source?: string;
  cache?: boolean;
  clearCache?: boolean;
  score?: boolean;
  incremental?: boolean;
  vectorSearch?: boolean;
}

interface CliDeps {
  loadConfig: (configPath?: string) => Promise<DocFreshnessConfig>;
  run: (config: DocFreshnessConfig) => Promise<ValidationResults>;
  logError: (...args: unknown[]) => void;
}

const defaultDeps: CliDeps = {
  loadConfig,
  run,
  logError: (...args) => console.error(...args),
};

export function createProgram(): Command {
  return new Command()
    .name('doc-freshness')
    .description('Check documentation freshness and accuracy for any project')
    .version(packageJson.version)
    .option('-c, --config <path>', 'Path to config file')
    .option('-r, --reporter <type>', 'Reporter type (console, json, markdown)', 'console')
    .option('-o, --output <path>', 'Output file path for reports')
    .option('-v, --verbose', 'Enable verbose logging')
    .option('--fix', 'Show fix suggestions')
    .option('--only <types>', 'Only check specific reference types (comma-separated)')
    .option('--skip-urls', 'Skip URL validation')
    .option('--files <patterns>', 'Only check specific files (comma-separated glob patterns)')
    .option('--manifest <files>', 'Manifest files to use (comma-separated)')
    .option('--source <patterns>', 'Source patterns to use (comma-separated)')
    .option('--no-cache', 'Disable caching')
    .option('--clear-cache', 'Clear cache before running')
    .option('--score', 'Include freshness scores in report')
    .option('--incremental', 'Only check changed files (requires cache)')
    .option('--vector-search', 'Enable semantic vector search for doc-code mismatches');
}

export function parseCliOptions(argv: string[]): CLIOptions {
  return createProgram().parse(argv).opts<CLIOptions>();
}

export function applyCliOverrides(config: DocFreshnessConfig, options: CLIOptions): void {
  if (options.reporter) {
    config.reporters = [options.reporter as 'console' | 'json' | 'markdown' | 'enhanced'];
  }
  if (options.output) {
    config.outputPath = options.output;
  }
  if (options.verbose) {
    config.verbose = true;
  }
  if (options.skipUrls) {
    config.urlValidation = config.urlValidation || {};
    config.urlValidation.enabled = false;
  }
  if (options.only) {
    const types = options.only.split(',');
    config.rules = config.rules || {};
    for (const rule of Object.keys(config.rules)) {
      const ruleConfig = config.rules[rule];
      if (ruleConfig) {
        ruleConfig.enabled = types.includes(rule);
      }
    }
  }
  if (options.files) {
    config.include = options.files.split(',');
  }
  if (options.manifest) {
    config.manifestFiles = options.manifest.split(',');
  }
  if (options.source) {
    config.sourcePatterns = options.source.split(',');
  }
  if (options.cache === false) {
    config.cache = { enabled: false };
  }
  if (options.clearCache) {
    config.clearCache = true;
  }
  if (options.score) {
    config.freshnessScoring = { ...config.freshnessScoring, enabled: true };
  }
  if (options.incremental) {
    config.incremental = { enabled: true };
  }
  if (options.vectorSearch) {
    config.vectorSearch = { ...config.vectorSearch, enabled: true };
  }
}

export async function runCli(
  options: CLIOptions,
  deps: CliDeps = defaultDeps,
): Promise<number> {
  try {
    const config = await deps.loadConfig(options.config);
    applyCliOverrides(config, options);
    const result = await deps.run(config);

    // Exit with error code if there are errors
    if (result.summary.errors > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    deps.logError('Error:', (error as Error).message);
    if (options.verbose) {
      deps.logError((error as Error).stack);
    }
    return 1;
  }
}

export async function main(
  argv: string[] = process.argv,
  deps: CliDeps = defaultDeps,
): Promise<number> {
  const options = parseCliOptions(argv);
  return runCli(options, deps);
}

// This wrapper keeps the process-exit side effect out of `main` so tests can
// verify CLI behavior without terminating the Vitest process.
export async function runAsCli(
  argv: string[] = process.argv,
  deps: CliDeps = defaultDeps,
): Promise<void> {
  const options = parseCliOptions(argv);
  const exitCode = await runCli(options, deps);
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  void runAsCli();
}
