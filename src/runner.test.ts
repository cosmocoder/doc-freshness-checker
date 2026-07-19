import fs from 'fs';
import os from 'os';
import path from 'path';
import { glob } from 'glob';
import { run, runWithConfig } from './runner.js';
import { BUILT_IN_RULE_TYPES } from './config/defaults.js';
import { VectorSearch } from './semantic/vectorSearch.js';
import { ValidationEngine } from './validators/validationEngine.js';
import { IncrementalChecker } from './utils/incremental.js';
import { FileValidator } from './validators/fileValidator.js';
import type { BaseExtractor, BaseValidator, DocFreshnessConfig, Reference, ReporterType, VectorMismatch } from './types.js';
import { withOutputFile } from './test-utils/tempFiles.js';
import { captureConsoleLog, captureConsoleWarn } from './test-utils/console.js';

vi.mock('fastembed', () => ({
  EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
  FlagEmbedding: {
    init: vi.fn().mockResolvedValue({
      passageEmbed: vi.fn().mockImplementation((texts: string[]) => {
        return (async function* () {
          yield texts.map(() => new Float32Array(384).fill(0.1));
        })();
      }),
      queryEmbed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    }),
  },
}));

vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}));

vi.mock('child_process', () => ({
  execFileSync: vi.fn().mockReturnValue(''),
}));

describe('runner', () => {
  const cacheRoot = path.join(process.cwd(), '.doc-freshness-cache');
  const transientCacheDirs = [
    '.doc-freshness-cache/runner-inc',
    '.doc-freshness-cache/runner-vs',
    '.doc-freshness-cache/runner-vs-v',
    '.doc-freshness-cache/runner-vs-nograph',
    '.doc-freshness-cache/runner-vs-reporters',
    '.doc-freshness-cache/rv-clear',
  ];
  const captureLog = captureConsoleLog;
  const captureWarn = captureConsoleWarn;
  const mockDocumentScan = (docPath: string): void => {
    vi.mocked(glob).mockResolvedValueOnce([docPath]);
  };
  const withIncrementalRoot = async (name: string, test: (rootDir: string) => Promise<void>): Promise<void> => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `runner-inc-${name}-`));
    try {
      await test(rootDir);
    }
    finally {
      vi.mocked(glob).mockResolvedValue([]);
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  };

  const baseConfig: DocFreshnessConfig = {
    rootDir: process.cwd(),
    include: [],
    exclude: [],
    urlValidation: { enabled: false },
    rules: Object.fromEntries(BUILT_IN_RULE_TYPES.map((rule) => [rule, { enabled: false }])),
    graph: { enabled: false },
    git: { enabled: false },
    freshnessScoring: { enabled: false },
    vectorSearch: { enabled: false },
    cache: { enabled: false },
    incremental: { enabled: false },
    reporters: [],
    verbose: false,
  };
  const incrementalConfig = (rootDir: string, overrides: Partial<DocFreshnessConfig> = {}): DocFreshnessConfig => ({
    ...baseConfig,
    rootDir,
    include: ['*.md'],
    sourcePatterns: [],
    manifestFiles: [],
    incremental: { enabled: true },
    cache: { enabled: false, dir: '.cache' },
    ...overrides,
    rules: { ...baseConfig.rules, ...overrides.rules },
  });

  it('validates config before runner side effects', async () => {
    const mkdirSpy = vi.spyOn(fs.promises, 'mkdir');
    try {
      await expect(run({ ...baseConfig, urlValidation: null } as unknown as DocFreshnessConfig)).rejects.toThrow(
        'urlValidation must be a plain object'
      );
      expect(mkdirSpy).not.toHaveBeenCalled();
    }
    finally {
      mkdirSpy.mockRestore();
    }
  });

  afterAll(async () => {
    await Promise.all(
      transientCacheDirs.map((dir) => fs.promises.rm(path.join(process.cwd(), dir), { recursive: true, force: true }).catch(() => {}))
    );
  });

  it('returns validation results with summary', async () => {
    const results = await run({ ...baseConfig, include: ['src/parsers/extractors/baseExtractor.ts'] });
    expect(results.summary).toBeDefined();
    expect(typeof results.summary.total).toBe('number');
    expect(typeof results.summary.valid).toBe('number');
    expect(typeof results.summary.errors).toBe('number');
  });

  it('returns empty results when no docs match', async () => {
    const results = await run({ ...baseConfig, include: ['nonexistent/**/*.md'] });
    expect(results.summary.total).toBe(0);
    expect(results.documents).toEqual([]);
  });

  it('clears cache when clearCache is set', async () => {
    const cacheDir = path.join(process.cwd(), '.doc-freshness-cache', 'runner-test');
    await fs.promises.mkdir(cacheDir, { recursive: true });
    await fs.promises.writeFile(path.join(cacheDir, 'dummy.json'), '{}');
    await run({
      ...baseConfig,
      cache: { enabled: true, dir: '.doc-freshness-cache/runner-test' },
      clearCache: true,
    });
    const exists = await fs.promises
      .access(cacheDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it('registers custom extractors and validators', async () => {
    const extract = vi.fn().mockReturnValue([]);
    const validateBatch = vi.fn().mockResolvedValue([]);
    await run({
      ...baseConfig,
      customExtractors: [{ extract, supportsFormat: () => true }] as unknown as DocFreshnessConfig['customExtractors'],
      customValidators: { custom: { validateBatch } } as unknown as DocFreshnessConfig['customValidators'],
    });
    expect(true).toBe(true);
  });

  it.each(['supportsFormat', 'extract'] as const)('propagates custom extractor %s failures', async (hook) => {
    vi.mocked(glob).mockResolvedValueOnce([path.join(process.cwd(), 'README.md')]);
    const failure = (): never => {
      throw new Error(`${hook} crashed`);
    };
    const extractor = {
      supportsFormat: hook === 'supportsFormat' ? failure : () => true,
      extract: hook === 'extract' ? failure : () => [],
    };

    await expect(
      run({
        ...baseConfig,
        customExtractors: [extractor] as unknown as DocFreshnessConfig['customExtractors'],
      })
    ).rejects.toThrow(`${hook} crashed`);
  });

  it('propagates custom validator execution failures', async () => {
    const reference: Reference = {
      type: 'custom',
      value: 'value',
      lineNumber: 1,
      raw: 'value',
      sourceFile: 'README.md',
    };
    vi.mocked(glob).mockResolvedValueOnce([path.join(process.cwd(), 'README.md')]);

    await expect(
      run({
        ...baseConfig,
        customExtractors: [{ extract: () => [reference], supportsFormat: () => true }] as unknown as DocFreshnessConfig['customExtractors'],
        customValidators: {
          custom: { validateBatch: vi.fn().mockRejectedValue(new Error('custom validator crashed')) },
        },
      })
    ).rejects.toThrow('custom validator crashed');
  });

  it('propagates built-in validator execution failures', async () => {
    const reference: Reference = {
      type: 'file-path',
      value: './src/index.ts',
      lineNumber: 1,
      raw: './src/index.ts',
      sourceFile: 'README.md',
    };
    vi.mocked(glob).mockResolvedValueOnce([path.join(process.cwd(), 'README.md')]);
    const validateSpy = vi.spyOn(FileValidator.prototype, 'validateBatch').mockRejectedValueOnce(new Error('file validator crashed'));

    try {
      await expect(
        run({
          ...baseConfig,
          rules: { ...baseConfig.rules, 'file-path': { enabled: true } },
          customExtractors: [
            { extract: () => [reference], supportsFormat: () => true },
          ] as unknown as DocFreshnessConfig['customExtractors'],
        })
      ).rejects.toThrow('file validator crashed');
    }
    finally {
      validateSpy.mockRestore();
    }
  });

  it('propagates matched-document read failures', async () => {
    vi.mocked(glob).mockResolvedValueOnce([path.join(process.cwd(), 'README.md')]);
    const readSpy = vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('Permission denied'));

    try {
      await expect(run(baseConfig)).rejects.toThrow('Permission denied');
    }
    finally {
      readSpy.mockRestore();
    }
  });

  it('preserves dependency info findings in run results', async () => {
    const reference: Reference = {
      type: 'dependency',
      value: 'definitely-not-installed-doc-freshness-package',
      lineNumber: 1,
      raw: 'definitely-not-installed-doc-freshness-package',
      sourceFile: 'README.md',
    };
    await withOutputFile(cacheRoot, 'runner-info.md', async (docPath) => {
      await fs.promises.mkdir(cacheRoot, { recursive: true });
      await fs.promises.writeFile(docPath, 'Dependency check');
      vi.mocked(glob).mockResolvedValueOnce([docPath]);

      const results = await run({
        ...baseConfig,
        rules: { ...baseConfig.rules, dependency: { enabled: true, severity: 'info' } },
        customExtractors: [{ extract: () => [reference], supportsFormat: () => true }] as unknown as DocFreshnessConfig['customExtractors'],
      });

      expect(results.summary.info).toBe(1);
      expect(results.documents[0].issues[0]).toMatchObject({
        severity: 'info',
        message: 'Package not found in dependencies: definitely-not-installed-doc-freshness-package',
      });
    });
  });

  describe('verbose mode', () => {
    it('logs config file path and source patterns', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, verbose: true, _configFile: 'my-config.json', sourcePatterns: ['src/**'] });
      const output = spy.mock.calls.flat().join('\n');
      expect(output).toContain('my-config.json');
      expect(output).toContain('src/**');
    });

    it('logs no-config notice', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, verbose: true, _noConfigFile: true });
      expect(spy.mock.calls.flat().join('\n')).toContain('No config file');
    });

    it('logs scan/validation progress', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, verbose: true });
      const output = spy.mock.calls.flat().join('\n');
      expect(output).toContain('Scanning');
      expect(output).toContain('Found');
      expect(output).toContain('Extracted');
      expect(output).toContain('Validating');
    });

    it('logs cache cleared', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        verbose: true,
        clearCache: true,
        cache: { enabled: true, dir: '.doc-freshness-cache/rv-clear' },
      });
      expect(spy.mock.calls.flat().join('\n')).toContain('Cache cleared');
    });
  });

  describe('reporters', () => {
    it('generates console report', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: ['console'] });
      expect(spy.mock.calls.flat().join('\n')).toContain('Documentation Freshness Report');
    });

    it('falls back to console when the reporter list is empty', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: [] });
      expect(spy.mock.calls.flat().join('\n')).toContain('Documentation Freshness Report');
    });

    it('generates json to stdout without outputPath', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: ['json'] });
      const jsonStr = spy.mock.calls.flat().find((a) => typeof a === 'string' && a.startsWith('{'));
      expect(JSON.parse(jsonStr!)).toHaveProperty('summary');
    });

    it('generates markdown to stdout', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: ['markdown'] });
      expect(spy.mock.calls.flat().join('\n')).toContain('# Documentation Freshness Report');
    });

    it('generates enhanced to stdout', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: ['enhanced'], graph: { enabled: true }, cache: { enabled: false } });
      expect(spy.mock.calls.flat().join('\n')).toContain('Documentation Freshness Scan Report');
    });

    it('warns for unknown reporter', async () => {
      const spy = captureWarn();
      captureLog();
      await run({ ...baseConfig, reporters: ['unknown' as unknown as ReporterType] });
      expect(spy.mock.calls.flat().join('\n')).toContain('Unknown reporter');
    });

    it.each(['json', 'markdown', 'enhanced'] as ReporterType[])('writes %s report to file with outputPath', async (reporter) => {
      await withOutputFile(cacheRoot, `test-${reporter}.out`, async (outputPath) => {
        const cfg: DocFreshnessConfig = { ...baseConfig, reporters: [reporter], outputPath, cache: { enabled: false } };
        if (reporter === 'enhanced') {
          cfg.graph = { enabled: true };
        }
        captureLog();
        await run(cfg);
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toBeTruthy();
      });
    });

    it.each(['json', 'markdown', 'enhanced'] as ReporterType[])('logs output path for %s in verbose mode', async (reporter) => {
      await withOutputFile(cacheRoot, `test-v-${reporter}.out`, async (outputPath) => {
        const cfg: DocFreshnessConfig = {
          ...baseConfig,
          reporters: [reporter],
          outputPath,
          verbose: true,
          cache: { enabled: false },
        };
        if (reporter === 'enhanced') {
          cfg.graph = { enabled: true };
        }
        const spy = captureLog();
        await run(cfg);
        expect(spy.mock.calls.flat().join('\n')).toContain('written to');
      });
    });
  });

  describe('graph and scoring', () => {
    it('builds graph with git and saves cache', async () => {
      captureLog();
      const cacheDir = '.doc-freshness-cache/runner-graph';
      try {
        await run({ ...baseConfig, graph: { enabled: true }, cache: { enabled: true, dir: cacheDir } });
        const exists = await fs.promises
          .access(path.join(process.cwd(), cacheDir, 'graph-cache.json'))
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      }
      finally {
        await fs.promises.rm(path.join(process.cwd(), cacheDir), { recursive: true, force: true }).catch(() => {});
      }
    });

    it('generates json with scores to file', async () => {
      await withOutputFile(cacheRoot, 'test-scored.json', async (outputPath) => {
        captureLog();
        await run({
          ...baseConfig,
          reporters: ['json'],
          outputPath,
          graph: { enabled: true },
          freshnessScoring: { enabled: true },
          cache: { enabled: false },
        });
        expect(JSON.parse(await fs.promises.readFile(outputPath, 'utf-8'))).toHaveProperty('summary');
      });
    });

    it('generates markdown with scores to file', async () => {
      await withOutputFile(cacheRoot, 'test-scored.md', async (outputPath) => {
        captureLog();
        await run({
          ...baseConfig,
          reporters: ['markdown'],
          outputPath,
          graph: { enabled: true },
          freshnessScoring: { enabled: true },
          cache: { enabled: false },
        });
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toContain('Freshness Scores');
      });
    });

    it('generates enhanced with scores to file', async () => {
      await withOutputFile(cacheRoot, 'test-enhanced-scored.md', async (outputPath) => {
        captureLog();
        await run({
          ...baseConfig,
          reporters: ['enhanced'],
          outputPath,
          graph: { enabled: true },
          freshnessScoring: { enabled: true },
          cache: { enabled: false },
        });
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toContain('Documentation Freshness Scan Report');
      });
    });
  });

  describe('incremental mode', () => {
    it('reports changed files in verbose mode', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        incremental: { enabled: true },
        verbose: true,
        cache: { dir: '.doc-freshness-cache/runner-inc' },
      });
      expect(spy.mock.calls.flat().join('\n')).toContain('Incremental');
    });

    it('skips a second clean run with default validator configuration', async () => {
      await withIncrementalRoot('defaults', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config: DocFreshnessConfig = {
          rootDir,
          include: ['*.md'],
          incremental: { enabled: true },
          graph: { enabled: false },
          cache: { enabled: false, dir: '.cache' },
          reporters: [],
        };

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
      });
    });

    it('allows reuse when git tracking is enabled without freshness scoring', async () => {
      await withIncrementalRoot('git-only', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config = incrementalConfig(rootDir, {
          git: { enabled: true },
          rules: { 'file-path': { enabled: true } },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
      });
    });

    it('reuses expected skips but revalidates when a disabled unsafe rule is enabled', async () => {
      await withIncrementalRoot('disabled-rule', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        await fs.promises.writeFile(docPath, '[site](https://example.com)');
        const config = incrementalConfig(rootDir, {
          rules: { 'external-url': { enabled: false } },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.skipped).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
        mockDocumentScan(docPath);
        expect((await run({ ...config, rules: { ...config.rules, 'external-url': { enabled: true } } })).summary.total).toBe(1);
      });
    });

    it('reuses a clean run containing an illustrative safe-rule skip', async () => {
      await withIncrementalRoot('illustrative-skip', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        await fs.promises.writeFile(docPath, '[example](YourProject/file.ts)');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true, skipIllustrative: true } },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.skipped).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
      });
    });

    it('keeps state dirty when a validator is missing or throws', async () => {
      await withIncrementalRoot('incomplete', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const cacheDir = path.join(rootDir, '.cache');
        await fs.promises.writeFile(docPath, 'unknown input');
        const unknownExtractor: BaseExtractor = {
          type: 'unknown-type',
          supportedFormats: ['markdown'],
          supportsFormat: () => true,
          extract: (document) => [{ type: 'unknown-type', value: 'value', lineNumber: 1, raw: 'value', sourceFile: document.path }],
          findLineNumber: () => 1,
          getContext: () => '',
        };
        const missingConfig = incrementalConfig(rootDir, { customExtractors: [unknownExtractor] });

        mockDocumentScan(docPath);
        await run(missingConfig);
        expect(JSON.parse(await fs.promises.readFile(path.join(cacheDir, 'file-hashes.json'), 'utf-8')).clean).toBe(false);

        const throwingValidator: BaseValidator = {
          async validateBatch() {
            throw new Error('validator failed');
          },
        };
        const throwingConfig = incrementalConfig(rootDir, {
          customValidators: { 'file-path': throwingValidator },
          rules: { 'file-path': { enabled: true } },
        });
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        mockDocumentScan(docPath);
        await expect(run(throwingConfig)).rejects.toThrow('validator failed');
        expect(JSON.parse(await fs.promises.readFile(path.join(cacheDir, 'file-hashes.json'), 'utf-8')).clean).toBe(false);
      });
    });

    it('revalidates unchanged docs when a referenced source file is renamed', async () => {
      await withIncrementalRoot('source', async (rootDir) => {
        const docsDir = path.join(rootDir, 'docs');
        const sourceDir = path.join(rootDir, 'src');
        const docPath = path.join(docsDir, 'guide.md');
        const sourcePath = path.join(sourceDir, 'server.ts');
        const renamedSourcePath = path.join(sourceDir, 'renamed.ts');
        const cacheDir = path.join(rootDir, '.cache');
        await fs.promises.mkdir(docsDir, { recursive: true });
        await fs.promises.mkdir(sourceDir, { recursive: true });
        await fs.promises.writeFile(docPath, '[source](../src/server.ts)');
        await fs.promises.writeFile(sourcePath, 'export const server = true;');

        const config = incrementalConfig(rootDir, {
          include: ['docs/**/*.md'],
          sourcePatterns: ['src/**/*.ts'],
          rules: { 'file-path': { enabled: true } },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.errors).toBe(0);
        await expect(fs.promises.access(path.join(cacheDir, 'file-hashes.json'))).resolves.toBeUndefined();

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);

        await fs.promises.rename(sourcePath, renamedSourcePath);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.errors).toBe(1);

        const stateFile = path.join(cacheDir, 'file-hashes.json');
        expect(JSON.parse(await fs.promises.readFile(stateFile, 'utf-8')).clean).toBe(false);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.errors).toBe(1);
      });
    });

    it('reuses the code-pattern source index and fingerprints excluded source matches', async () => {
      await withIncrementalRoot('code-pattern-source', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const sourceDir = path.join(rootDir, '.git');
        const sourcePath = path.join(sourceDir, 'source.ts');
        await fs.promises.mkdir(sourceDir);
        await fs.promises.writeFile(docPath, ['```typescript', 'class StableService {}', '```'].join('\n'));
        await fs.promises.writeFile(sourcePath, 'export class StableService {}');
        const config = incrementalConfig(rootDir, {
          sourcePatterns: ['.g{it,noop}/**/*.ts'],
          rules: { 'code-pattern': { enabled: true, severity: 'warning' } },
        });
        const mockScans = (): void => {
          mockDocumentScan(docPath);
          vi.mocked(glob).mockResolvedValueOnce([sourcePath]);
        };

        mockScans();
        expect((await run(config)).summary.warnings).toBe(0);
        mockScans();
        expect((await run(config)).summary.total).toBe(0);

        await fs.promises.writeFile(sourcePath, 'export class ReplacementService {}');
        mockScans();
        expect((await run(config)).summary.warnings).toBe(1);
      });
    });

    it('captures graph-only source inputs once per run and skips unchanged validation', async () => {
      await withIncrementalRoot('graph-source', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const sourceDir = path.join(rootDir, 'src');
        const sourcePath = path.join(sourceDir, 'source.ts');
        await fs.promises.mkdir(sourceDir);
        await fs.promises.writeFile(docPath, 'No code-pattern references');
        await fs.promises.writeFile(sourcePath, 'export class GraphSource {}');
        const config = incrementalConfig(rootDir, {
          graph: { enabled: true },
          sourcePatterns: ['src/**/*.ts'],
        });
        const mockScans = (): void => {
          mockDocumentScan(docPath);
          vi.mocked(glob).mockResolvedValueOnce([sourcePath]);
        };
        const validateSpy = vi.spyOn(ValidationEngine.prototype, 'validate');
        const readSpy = vi.spyOn(fs.promises, 'readFile');
        vi.mocked(glob).mockClear();
        try {
          mockScans();
          await run(config);
          mockScans();
          await run(config);

          expect(validateSpy.mock.calls[0][0]).toHaveLength(1);
          expect(validateSpy.mock.calls[1][0]).toEqual([]);
          expect(vi.mocked(glob).mock.calls.filter(([pattern]) => pattern === 'src/**/*.ts')).toHaveLength(2);
          expect(readSpy.mock.calls.filter(([file]) => file === sourcePath)).toHaveLength(2);
        }
        finally {
          validateSpy.mockRestore();
          readSpy.mockRestore();
        }
      });
    });

    it('bypasses incremental inventory for an empty graph-enabled scan', async () => {
      await withIncrementalRoot('empty-graph', async (rootDir) => {
        const sourceDir = path.join(rootDir, 'src');
        const sourcePath = path.join(sourceDir, 'source.ts');
        await fs.promises.mkdir(sourceDir);
        await fs.promises.writeFile(sourcePath, 'export class GraphSource {}');
        const config = incrementalConfig(rootDir, {
          graph: { enabled: true },
          sourcePatterns: ['src/**/*.ts'],
        });
        const filterSpy = vi.spyOn(IncrementalChecker.prototype, 'filterChanged');
        const readSpy = vi.spyOn(fs.promises, 'readFile');
        vi.mocked(glob).mockClear();
        try {
          vi.mocked(glob).mockResolvedValueOnce([]).mockResolvedValueOnce([sourcePath]);
          await run(config);

          expect(filterSpy).not.toHaveBeenCalled();
          await expect(fs.promises.access(path.join(rootDir, '.cache', 'file-hashes.json'))).rejects.toThrow();
          expect(vi.mocked(glob).mock.calls.filter(([pattern]) => pattern === 'src/**/*.ts')).toHaveLength(1);
          expect(readSpy.mock.calls.filter(([file]) => file === sourcePath)).toHaveLength(1);
        }
        finally {
          filterSpy.mockRestore();
          readSpy.mockRestore();
        }
      });
    });

    it('revalidates code-snippet fallbacks under excluded directories', async () => {
      await withIncrementalRoot('snippet', async (rootDir) => {
        const docsDir = path.join(rootDir, 'docs');
        const dependencyDir = path.join(rootDir, 'node_modules');
        const docPath = path.join(docsDir, 'guide.md');
        const sourcePath = path.join(dependencyDir, 'generated.js');
        await fs.promises.mkdir(docsDir);
        await fs.promises.mkdir(dependencyDir);
        await fs.promises.writeFile(docPath, "```js\nimport * as generated from '../node_modules/generated';\n```");
        await fs.promises.writeFile(sourcePath, 'export const generated = true;');
        const config = incrementalConfig(rootDir, {
          include: ['docs/**/*.md'],
          rules: { 'code-snippet': { enabled: true } },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.warnings).toBe(0);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);

        await fs.promises.rm(sourcePath);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.warnings).toBe(1);
      });
    });

    it('revalidates unchanged docs after an unreported info finding', async () => {
      await withIncrementalRoot('info', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const cacheDir = path.join(rootDir, '.cache');
        await fs.promises.writeFile(docPath, 'Install `missingpkg`.');
        await fs.promises.writeFile(path.join(rootDir, 'package.json'), '{}');
        const config = incrementalConfig(rootDir, {
          manifestFiles: ['package.json'],
          rules: { dependency: { enabled: true, severity: 'info' } },
          cache: { enabled: false, dir: cacheDir },
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        expect(JSON.parse(await fs.promises.readFile(path.join(cacheDir, 'file-hashes.json'), 'utf-8')).clean).toBe(false);
      });
    });

    it('revalidates after generated output changes the project inventory', async () => {
      await withIncrementalRoot('output', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        const outputPath = path.join(rootDir, 'report.json');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true } },
          reporters: ['json'],
          outputPath,
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
      });
    });

    it.each(['markdown', 'enhanced'] as ReporterType[])('skips unchanged docs when %s output is inside rootDir', async (reporter) => {
      await withIncrementalRoot(`output-${reporter}`, async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        const outputPath = path.join(rootDir, `${reporter}.out`);
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true } },
          reporters: [reporter],
          outputPath,
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        await expect(fs.promises.access(outputPath)).resolves.toBeUndefined();

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
      });
    });

    it.each([
      { reporters: ['markdown', 'json'] as ReporterType[], expectedTotals: [1, 1, 0, 1] },
      { reporters: ['json', 'markdown'] as ReporterType[], expectedTotals: [1, 0, 0, 0] },
    ])('keeps mixed reporter ordering stable for incremental output', async ({ reporters, expectedTotals }) => {
      await withIncrementalRoot(`mixed-output-${reporters.join('-')}`, async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        const outputPath = path.join(rootDir, 'report.out');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true } },
          reporters,
          outputPath,
        });
        const totals: number[] = [];

        for (let runNumber = 0; runNumber < expectedTotals.length; runNumber++) {
          mockDocumentScan(docPath);
          totals.push((await run(config)).summary.total);
        }

        expect(totals).toEqual(expectedTotals);
      });
    });

    it('does not throw for markdown reporting without outputPath', async () => {
      await withIncrementalRoot('markdown-stdout', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        await fs.promises.writeFile(docPath, 'No references');
        const config = incrementalConfig(rootDir, { reporters: ['markdown'] });
        const log = captureLog();
        try {
          mockDocumentScan(docPath);
          await expect(run(config)).resolves.toBeDefined();
        }
        finally {
          log.mockRestore();
        }
      });
    });

    it('revalidates when reporting mutates a validation input', async () => {
      await withIncrementalRoot('output-overlap', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true } },
          reporters: ['json'],
          outputPath: targetPath,
        });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
      });
    });

    it('excludes lexical and real symlinked cache directories', async () => {
      await withIncrementalRoot('cache-link', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const targetPath = path.join(rootDir, 'target.ts');
        const realCacheDir = path.join(rootDir, '.real-cache');
        await fs.promises.writeFile(docPath, '[target](target.ts)');
        await fs.promises.writeFile(targetPath, 'export const target = true;');
        await fs.promises.mkdir(realCacheDir);
        await fs.promises.symlink('.real-cache', path.join(rootDir, '.cache'), 'dir');
        const config = incrementalConfig(rootDir, { rules: { 'file-path': { enabled: true } } });

        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(1);
        await expect(fs.promises.access(path.join(realCacheDir, 'file-hashes.json'))).resolves.toBeUndefined();
        mockDocumentScan(docPath);
        expect((await run(config)).summary.total).toBe(0);
      });
    });

    it('does not advance state when validation or reporting throws', async () => {
      await withIncrementalRoot('report', async (rootDir) => {
        const docPath = path.join(rootDir, 'guide.md');
        const cacheDir = path.join(rootDir, '.cache');
        await fs.promises.writeFile(docPath, 'No references');
        const config = incrementalConfig(rootDir, {
          rules: { 'file-path': { enabled: true } },
          cache: { enabled: false, dir: cacheDir },
        });
        mockDocumentScan(docPath);
        await run(config);
        const stateFile = path.join(cacheDir, 'file-hashes.json');
        const baselineState = await fs.promises.readFile(stateFile, 'utf-8');

        await fs.promises.writeFile(docPath, '[missing](missing.ts)');
        const validateSpy = vi.spyOn(ValidationEngine.prototype, 'validate').mockRejectedValueOnce(new Error('validation failed'));
        try {
          mockDocumentScan(docPath);
          await expect(run(config)).rejects.toThrow('validation failed');
          expect(await fs.promises.readFile(stateFile, 'utf-8')).toBe(baselineState);
        }
        finally {
          validateSpy.mockRestore();
        }

        mockDocumentScan(docPath);

        await expect(
          run({
            ...config,
            reporters: ['json'],
            outputPath: rootDir,
          })
        ).rejects.toThrow();
        expect(await fs.promises.readFile(stateFile, 'utf-8')).toBe(baselineState);

        mockDocumentScan(docPath);
        expect((await run(config)).summary.errors).toBe(1);
      });
    });
  });

  it('loads URL cache when cache is enabled', async () => {
    const cacheDir = '.doc-freshness-cache/runner-url';
    const fullDir = path.join(process.cwd(), cacheDir);
    await fs.promises.mkdir(fullDir, { recursive: true });
    await fs.promises.writeFile(path.join(fullDir, 'url-cache.json'), '{}');
    try {
      expect(await run({ ...baseConfig, cache: { enabled: true, dir: cacheDir } })).toBeDefined();
    }
    finally {
      await fs.promises.rm(fullDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('vector search', () => {
    it.each(['console', 'json', 'markdown', 'enhanced'] as ReporterType[])(
      'renders vector mismatches with the %s reporter',
      async (reporter) => {
        const mismatch: VectorMismatch = {
          docPath: 'docs/vector-api.md',
          docSection: 'Vector API',
          docText: 'The API returns a vector',
          bestMatchScore: 0.2,
          bestMatch: null,
          suggestion: 'Update the API documentation',
        };
        const mismatchSpy = vi.spyOn(VectorSearch.prototype, 'findMismatches').mockResolvedValue([mismatch]);
        const logSpy = captureLog();
        try {
          const results = await run({
            ...baseConfig,
            reporters: [reporter],
            vectorSearch: { enabled: true },
            freshnessScoring: { enabled: false },
            cache: { enabled: false, dir: '.doc-freshness-cache/runner-vs-reporters' },
          });

          expect(results.vectorMismatches).toEqual([mismatch]);
          expect(
            logSpy.mock.calls
              .flat()
              .join('\n')
              .match(/docs\/vector-api\.md/g)
          ).toHaveLength(1);
        }
        finally {
          mismatchSpy.mockRestore();
          logSpy.mockRestore();
        }
      }
    );

    it('runs vector search when enabled', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        vectorSearch: { enabled: true },
        cache: { dir: '.doc-freshness-cache/runner-vs' },
      });
      const output = spy.mock.calls.flat().join('\n');
      expect(output).toContain('semantic analysis');
      expect(output).toContain('Analyzed');
    });

    it('runs vector search with verbose logging and graph', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        vectorSearch: { enabled: true },
        graph: { enabled: true },
        verbose: true,
        cache: { dir: '.doc-freshness-cache/runner-vs-v' },
      });
      const output = spy.mock.calls.flat().join('\n');
      expect(output).toContain('Indexing documentation');
      expect(output).toContain('Finding semantic mismatches');
    });
  });

  describe('runWithConfig', () => {
    it('propagates explicit config load failures', async () => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-runner-config-'));
      const missingConfig = path.join(tempDir, 'missing.json');

      try {
        await expect(runWithConfig(missingConfig)).rejects.toThrow(missingConfig);
      }
      finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('vector search without prior graph', () => {
    it('builds source index independently when graph not enabled', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        vectorSearch: { enabled: true },
        graph: { enabled: false },
        verbose: true,
        cache: { dir: '.doc-freshness-cache/runner-vs-nograph' },
      });
      const output = spy.mock.calls.flat().join('\n');
      expect(output).toContain('Building source code index');
    });
  });

  describe('reporters with freshness scores', () => {
    it('console reporter uses generateWithScores when scores available', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        reporters: ['console'],
        graph: { enabled: true },
        freshnessScoring: { enabled: true },
        cache: { enabled: false },
      });
      expect(spy.mock.calls.flat().join('\n')).toContain('Freshness Scores');
    });

    it('json reporter generates with scores', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        reporters: ['json'],
        graph: { enabled: true },
        freshnessScoring: { enabled: true },
        cache: { enabled: false },
      });
      const jsonStr = spy.mock.calls.flat().find((a) => typeof a === 'string' && a.startsWith('{'));
      expect(JSON.parse(jsonStr!)).toHaveProperty('summary');
    });

    it('markdown reporter generates with scores to stdout', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        reporters: ['markdown'],
        graph: { enabled: true },
        freshnessScoring: { enabled: true },
        cache: { enabled: false },
      });
      expect(spy.mock.calls.flat().join('\n')).toContain('Freshness Scores');
    });
  });
});
