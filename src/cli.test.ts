import { mkdtemp, symlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  applyCliOverrides,
  createProgram,
  isDirectCliInvocation,
  main,
  parseCliOptions,
  runAsCli,
  runCli,
  type CLIOptions,
} from './cli.js';
import { BUILT_IN_RULE_TYPES, DEFAULT_CONFIG } from './config/defaults.js';
import type { DocFreshnessConfig, ValidationResults } from './types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

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

function makeResults(errors: number, info: number = 0): ValidationResults {
  return {
    documents: [],
    summary: {
      total: errors + info,
      valid: 0,
      errors,
      warnings: 0,
      info,
      skipped: 0,
    },
  };
}

describe('CLI option parsing', () => {
  it('leaves reporter unset when the flag is absent', () => {
    expect(parseCliOptions(['node', 'doc-freshness']).reporter).toBeUndefined();
  });

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

  it('lists and validates every reporter choice', () => {
    const program = createProgram()
      .exitOverride()
      .configureOutput({ writeErr: () => {} });

    expect(program.helpInformation().replace(/\s+/g, ' ')).toContain('Reporter type (choices: "console", "json", "markdown", "enhanced")');
    expect(() => program.parse(['node', 'doc-freshness', '--reporter', 'bogus'])).toThrow(
      'Allowed choices are console, json, markdown, enhanced'
    );
  });
});

describe('applyCliOverrides', () => {
  it('selects built-in and configured custom rules', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    delete config.rules!['code-snippet'];
    config.rules!.custom = { enabled: false };
    const validator = {
      async validateBatch() {
        return [];
      },
    };
    config.customValidators!.custom = validator;
    config.customValidators!.validatorOnly = validator;

    applyCliOverrides(config, { only: 'file-path,custom,validatorOnly' });

    for (const rule of BUILT_IN_RULE_TYPES) {
      expect(config.rules?.[rule]?.enabled).toBe(rule === 'file-path');
    }
    expect(config.rules!.custom!.enabled).toBe(true);
    expect(config.rules!.validatorOnly!.enabled).toBe(true);
  });

  it('rejects stale configured rule keys without changing rule selection', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.rules!.filepath = { enabled: true };
    const initialRules = structuredClone(config.rules);

    expect(() => applyCliOverrides(config, { only: 'filepath' })).toThrow(
      `Unknown rule type: filepath. Valid rule types: ${BUILT_IN_RULE_TYPES.join(', ')}`
    );
    expect(config.rules).toEqual(initialRules);
  });

  it.each([
    ['file-path,', ['file-path']],
    ['file-path,,version', ['file-path', 'version']],
    ['file-path, version', ['file-path', 'version']],
    [' file-path ', ['file-path']],
  ])('normalizes --only value %j', (only, enabledRules) => {
    const config = structuredClone(DEFAULT_CONFIG);

    applyCliOverrides(config, { only });

    for (const rule of BUILT_IN_RULE_TYPES) {
      expect(config.rules?.[rule]?.enabled).toBe(enabledRules.includes(rule));
    }
  });

  it.each(['', ', ,'])('rejects empty --only selection %j without changing rule selection', (only) => {
    const config = structuredClone(DEFAULT_CONFIG);
    const initialRules = structuredClone(config.rules);

    expect(() => applyCliOverrides(config, { only })).toThrow(
      `At least one rule type is required. Valid rule types: ${BUILT_IN_RULE_TYPES.join(', ')}`
    );
    expect(config.rules).toEqual(initialRules);
  });

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
  it('does not override the configured reporter when options omit reporter', async () => {
    const loadConfigMock = vi.fn().mockResolvedValue({ ...makeConfig(), reporters: ['json'] });
    const runMock = vi.fn().mockResolvedValue(makeResults(0));
    const logErrorMock = vi.fn();

    const exitCode = await runCli(
      { config: 'doc-freshness.config.ts' },
      {
        loadConfig: loadConfigMock,
        run: runMock,
        logError: logErrorMock,
      }
    );

    expect(exitCode).toBe(0);
    expect(loadConfigMock).toHaveBeenCalledWith('doc-freshness.config.ts');
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ reporters: ['json'] }));
    expect(logErrorMock).not.toHaveBeenCalled();
  });

  it('returns 1 when validation reports errors', async () => {
    const exitCode = await runCli(
      {},
      {
        loadConfig: vi.fn().mockResolvedValue(makeConfig()),
        run: vi.fn().mockResolvedValue(makeResults(2)),
        logError: vi.fn(),
      }
    );

    expect(exitCode).toBe(1);
  });

  it('returns 1 without running validation for an unknown rule type', async () => {
    const runMock = vi.fn();
    const logErrorMock = vi.fn();

    const exitCode = await runCli(
      { only: 'filepath' },
      {
        loadConfig: vi.fn().mockResolvedValue(makeConfig()),
        run: runMock,
        logError: logErrorMock,
      }
    );

    expect(exitCode).toBe(1);
    expect(runMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith('Error:', `Unknown rule type: filepath. Valid rule types: ${BUILT_IN_RULE_TYPES.join(', ')}`);
  });

  it('returns 0 when validation reports only info findings', async () => {
    const exitCode = await runCli(
      {},
      {
        loadConfig: vi.fn().mockResolvedValue(makeConfig()),
        run: vi.fn().mockResolvedValue(makeResults(0, 2)),
        logError: vi.fn(),
      }
    );

    expect(exitCode).toBe(0);
  });

  it('returns 1 and logs error details on exception', async () => {
    const logErrorMock = vi.fn();
    const thrown = new Error('boom');

    const exitCode = await runCli(
      { verbose: true },
      {
        loadConfig: vi.fn().mockRejectedValue(thrown),
        run: vi.fn(),
        logError: logErrorMock,
      }
    );

    expect(exitCode).toBe(1);
    expect(logErrorMock).toHaveBeenCalledWith('Error:', 'boom');
    expect(logErrorMock).toHaveBeenCalledWith(thrown.stack);
  });

  it('returns 1 when the runtime fails', async () => {
    const logErrorMock = vi.fn();

    const exitCode = await runCli(
      {},
      {
        loadConfig: vi.fn().mockResolvedValue(makeConfig()),
        run: vi.fn().mockRejectedValue(new Error('validator crashed')),
        logError: logErrorMock,
      }
    );

    expect(exitCode).toBe(1);
    expect(logErrorMock).toHaveBeenCalledWith('Error:', 'validator crashed');
  });
});

describe('main', () => {
  it('preserves the configured reporter when the CLI flag is absent', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResults(0));
    const deps = {
      loadConfig: vi.fn().mockResolvedValue({ ...makeConfig(), reporters: ['json'] }),
      run: runMock,
      logError: vi.fn(),
    };

    const exitCode = await main(['node', 'doc-freshness', '--config', 'doc-freshness.config.ts'], deps);

    expect(exitCode).toBe(0);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith(expect.objectContaining({ reporters: ['json'] }));
  });

  it('parses argv and applies options before running', async () => {
    const runMock = vi.fn().mockResolvedValue(makeResults(0));
    const deps = {
      loadConfig: vi.fn().mockResolvedValue(makeConfig()),
      run: runMock,
      logError: vi.fn(),
    };

    const exitCode = await main(['node', 'doc-freshness', '--reporter', 'json', '--no-cache'], deps);

    expect(exitCode).toBe(0);
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reporters: ['json'],
        cache: { enabled: false },
      })
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

describe('isDirectCliInvocation', () => {
  const cliPath = fileURLToPath(new URL('./cli.ts', import.meta.url));

  it('returns true when argv entry points directly to cli file', () => {
    expect(isDirectCliInvocation(['node', cliPath])).toBe(true);
  });

  it('returns true when argv entry is a symlink to cli file', async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), 'doc-freshness-cli-'));
    const linkPath = path.join(tempDir, 'doc-freshness');

    await symlink(cliPath, linkPath);

    try {
      expect(isDirectCliInvocation(['node', linkPath])).toBe(true);
    }
    finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns false when argv entry points elsewhere', () => {
    expect(isDirectCliInvocation(['node', '/tmp/not-cli.js'])).toBe(false);
  });
});
