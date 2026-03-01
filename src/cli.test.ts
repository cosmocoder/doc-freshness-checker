import { applyCliOverrides, main, parseCliOptions, runAsCli, runCli, type CLIOptions } from './cli.js';
import type { DocFreshnessConfig, ValidationResults } from './types.js';

function makeConfig(): DocFreshnessConfig {
  return {
    reporters: ['console'],
    rules: {
      'file-path': { enabled: true },
      'external-url': { enabled: true },
      version: { enabled: true },
    },
    urlValidation: { enabled: true },
    cache: { enabled: true },
  };
}

function makeResults(errors: number): ValidationResults {
  return {
    documents: [],
    summary: {
      total: 0,
      valid: 0,
      errors,
      warnings: 0,
      skipped: 0,
    },
  };
}

describe('CLI option parsing', () => {
  it('parses supported flags and values', () => {
    const options = parseCliOptions([
      'node',
      'doc-freshness',
      '--config',
      'my-config.json',
      '--reporter',
      'json',
      '--only',
      'file-path,version',
      '--no-cache',
      '--vector-search',
    ]);

    expect(options.config).toBe('my-config.json');
    expect(options.reporter).toBe('json');
    expect(options.only).toBe('file-path,version');
    expect(options.cache).toBe(false);
    expect(options.vectorSearch).toBe(true);
  });
});

describe('applyCliOverrides', () => {
  it('applies all overrideable CLI options to config', () => {
    const config = makeConfig();
    const options: CLIOptions = {
      reporter: 'markdown',
      output: 'reports/out.md',
      verbose: true,
      skipUrls: true,
      only: 'version',
      files: 'docs/**/*.md,README.md',
      manifest: 'package.json,requirements.txt',
      source: 'src/**/*.ts,lib/**/*.ts',
      cache: false,
      clearCache: true,
      score: true,
      incremental: true,
      vectorSearch: true,
    };

    applyCliOverrides(config, options);

    expect(config.reporters).toEqual(['markdown']);
    expect(config.outputPath).toBe('reports/out.md');
    expect(config.verbose).toBe(true);
    expect(config.urlValidation?.enabled).toBe(false);
    expect(config.rules?.version?.enabled).toBe(true);
    expect(config.rules?.['file-path']?.enabled).toBe(false);
    expect(config.rules?.['external-url']?.enabled).toBe(false);
    expect(config.include).toEqual(['docs/**/*.md', 'README.md']);
    expect(config.manifestFiles).toEqual(['package.json', 'requirements.txt']);
    expect(config.sourcePatterns).toEqual(['src/**/*.ts', 'lib/**/*.ts']);
    expect(config.cache).toEqual({ enabled: false });
    expect(config.clearCache).toBe(true);
    expect(config.freshnessScoring?.enabled).toBe(true);
    expect(config.incremental?.enabled).toBe(true);
    expect(config.vectorSearch?.enabled).toBe(true);
  });
});

describe('runCli', () => {
  it('returns 0 on successful run with no errors', async () => {
    const loadConfigMock = vi.fn().mockResolvedValue(makeConfig());
    const runMock = vi.fn().mockResolvedValue(makeResults(0));
    const logErrorMock = vi.fn();

    const exitCode = await runCli({ config: 'doc-freshness.config.ts' }, {
      loadConfig: loadConfigMock,
      run: runMock,
      logError: logErrorMock,
    });

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('doc-freshness.config.ts');
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('returns 1 when validation reports errors', async () => {
    const exitCode = await runCli({}, {
      loadConfig: vi.fn().mockResolvedValue(makeConfig()),
      run: vi.fn().mockResolvedValue(makeResults(2)),
      logError: vi.fn(),
    });

    expect(exitCode).toBe(1);
  });

  it('returns 1 and logs error details on exception', async () => {
    const logErrorMock = vi.fn();
    const thrown = new Error('boom');

    const exitCode = await runCli({ verbose: true }, {
      loadConfig: vi.fn().mockRejectedValue(thrown),
      run: vi.fn(),
      logError: logErrorMock,
    });

    expect(exitCode).toBe(1);
    expect(logErrorMock).toHaveBeenCalledWith('Error:', 'boom');
    expect(logErrorMock).toHaveBeenCalledWith(thrown.stack);
  });
});

describe('main', () => {
  it('parses argv and applies options before running', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResults(0));
    const deps = {
      loadConfig: vi.fn().mockResolvedValue(makeConfig()),
      run: runMock,
      logError: vi.fn(),
    };

    const exitCode = await main(
      ['node', 'doc-freshness', '--reporter', 'json', '--no-cache'],
      deps,
    );

    expect(exitCode).toBe(0);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reporters: ['json'],
        cache: { enabled: false },
      }),
    );
  });
});

describe('runAsCli', () => {
  it('calls process.exit when CLI run fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const deps = {
      loadConfig: vi.fn().mockResolvedValue(makeConfig()),
      run: vi.fn().mockResolvedValue(makeResults(1)),
      logError: vi.fn(),
    };

    await runAsCli(['node', 'doc-freshness'], deps);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not call process.exit on successful run', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const deps = {
      loadConfig: vi.fn().mockResolvedValue(makeConfig()),
      run: vi.fn().mockResolvedValue(makeResults(0)),
      logError: vi.fn(),
    };

    await runAsCli(['node', 'doc-freshness'], deps);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
