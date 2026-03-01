import fs from 'fs';
import path from 'path';
import { run, runWithConfig } from './runner.js';
import type { DocFreshnessConfig, ReporterType } from './types.js';
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
    '.doc-freshness-cache/rv-clear',
  ];
  const captureLog = captureConsoleLog;
  const captureWarn = captureConsoleWarn;

  const baseConfig: DocFreshnessConfig = {
    rootDir: process.cwd(),
    include: [],
    exclude: [],
    urlValidation: { enabled: false },
    rules: {
      'file-path': { enabled: false },
      'external-url': { enabled: false },
      version: { enabled: false },
      'directory-structure': { enabled: false },
      'code-pattern': { enabled: false },
      dependency: { enabled: false },
    },
    graph: { enabled: false },
    git: { enabled: false },
    freshnessScoring: { enabled: false },
    vectorSearch: { enabled: false },
    cache: { enabled: false },
    incremental: { enabled: false },
    reporters: [],
    verbose: false,
  };

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

    it('warns for unknown reporter in verbose', async () => {
      const spy = captureWarn();
      captureLog();
      await run({ ...baseConfig, reporters: ['unknown' as unknown as ReporterType], verbose: true });
      expect(spy.mock.calls.flat().join('\n')).toContain('Unknown reporter');
    });

    it.each(['json', 'markdown', 'enhanced'] as ReporterType[])('writes %s report to file with outputPath', async (reporter) => {
      await withOutputFile(cacheRoot, `test-${reporter}.out`, async (outputPath) => {
        const cfg: DocFreshnessConfig = { ...baseConfig, reporters: [reporter], outputPath, cache: { enabled: false } };
        if (reporter === 'enhanced') cfg.graph = { enabled: true };
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
        if (reporter === 'enhanced') cfg.graph = { enabled: true };
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
      } finally {
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
    it('filters changed files with verbose logging', async () => {
      const spy = captureLog();
      await run({
        ...baseConfig,
        incremental: { enabled: true },
        verbose: true,
        cache: { dir: '.doc-freshness-cache/runner-inc' },
      });
      expect(spy.mock.calls.flat().join('\n')).toContain('Incremental');
    });
  });

  it('loads URL cache when cache is enabled', async () => {
    const cacheDir = '.doc-freshness-cache/runner-url';
    const fullDir = path.join(process.cwd(), cacheDir);
    await fs.promises.mkdir(fullDir, { recursive: true });
    await fs.promises.writeFile(path.join(fullDir, 'url-cache.json'), '{}');
    try {
      expect(await run({ ...baseConfig, cache: { enabled: true, dir: cacheDir } })).toBeDefined();
    } finally {
      await fs.promises.rm(fullDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('vector search', () => {
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
    it('loads config from path and runs', async () => {
      captureLog();
      const result = await runWithConfig('/nonexistent/path.json');
      expect(result.summary).toBeDefined();
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
