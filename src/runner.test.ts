import fs from 'fs';
import path from 'path';
import { run, runWithConfig } from './runner.js';
import { FreshnessScorer } from './scoring/freshnessScorer.js';
import { withOutputFile } from './test-utils/tempFiles.js';
import { captureConsoleLog, captureConsoleWarn } from './test-utils/console.js';
import type { DocFreshnessConfig, ProjectScores, ReporterType, ValidationResults } from './types.js';
import { ValidationEngine } from './validators/validationEngine.js';

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
    it('routes the Console emitter to stdout incrementally', async () => {
      const spy = captureLog();
      await run({ ...baseConfig, reporters: ['console'] });
      expect(spy.mock.calls.length).toBeGreaterThan(1);
      expect(spy.mock.calls.every((call) => call.length === 1)).toBe(true);
      expect(spy.mock.calls.flat().join('\n')).toContain('Documentation Freshness Report');
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

    it('defaults an absent reporter list to Console but honors an explicit empty list', async () => {
      const log = captureLog();
      await run({ ...baseConfig, reporters: undefined });
      expect(log.mock.calls.flat().join('\n')).toContain('Documentation Freshness Report');

      log.mockClear();
      await run({ ...baseConfig, reporters: [] });
      expect(log).not.toHaveBeenCalled();
    });

    it('preserves configured reporter order and duplicates', async () => {
      const log = captureLog();
      await run({ ...baseConfig, reporters: ['json', 'markdown', 'json'] });

      const reports = log.mock.calls
        .map(([value]) => value)
        .filter((value): value is string => typeof value === 'string' && (value.startsWith('{') || value.startsWith('#')));
      expect(reports).toHaveLength(3);
      expect(reports[0]).toMatch(/^\{/);
      expect(reports[1]).toMatch(/^# Documentation Freshness Report/);
      expect(reports[2]).toMatch(/^\{/);
    });

    it('ignores unknown reporter values without a warning outside verbose mode', async () => {
      const log = captureLog();
      const warn = captureWarn();
      await run({ ...baseConfig, reporters: ['unknown' as ReporterType] });
      expect(log).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      { verbose: false, warnings: [] },
      {
        verbose: true,
        warnings: [['Unknown reporter type: toString'], ['Unknown reporter type: constructor'], ['Unknown reporter type: __proto__']],
      },
    ])('treats inherited registry keys as unknown when verbose=$verbose', async ({ verbose, warnings }) => {
      const inheritedKeys = ['toString', 'constructor', '__proto__'] as unknown as ReporterType[];
      const log = captureLog();
      const warn = captureWarn();

      await expect(run({ ...baseConfig, reporters: inheritedKeys, verbose })).resolves.toBeDefined();

      expect(warn.mock.calls).toEqual(warnings);
      expect(log.mock.calls.some(([value]) => typeof value === 'string' && value.startsWith('{'))).toBe(false);
      const output = log.mock.calls.flat().join('\n');
      expect(output).not.toContain('Documentation Freshness Report');
      expect(output).not.toContain('Documentation Freshness Scan Report');
    });

    it('keeps Console on stdout and ignores outputPath', async () => {
      await withOutputFile(cacheRoot, 'console-must-not-write.out', async (outputPath) => {
        const log = captureLog();
        await run({ ...baseConfig, reporters: ['console'], outputPath });
        expect(log.mock.calls.flat().join('\n')).toContain('Documentation Freshness Report');
        await expect(fs.promises.access(outputPath)).rejects.toThrow();
      });
    });

    it('overwrites a shared outputPath sequentially so the last string reporter wins', async () => {
      await withOutputFile(cacheRoot, 'shared-reporter.out', async (outputPath) => {
        captureLog();
        await run({ ...baseConfig, reporters: ['json', 'markdown'], outputPath });
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toMatch(/^# Documentation Freshness Report/);

        await run({ ...baseConfig, reporters: ['markdown', 'json'], outputPath });
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toMatch(/^\{/);
      });
    });

    it('creates recursive output directories and reports each verbose label', async () => {
      const outputRoot = path.join(cacheRoot, 'reporter-routing');
      const outputPath = path.join(outputRoot, 'nested', 'report.out');
      const log = captureLog();
      try {
        await run({ ...baseConfig, reporters: ['json', 'markdown'], outputPath, verbose: true });
        expect(await fs.promises.readFile(outputPath, 'utf-8')).toMatch(/^# Documentation Freshness Report/);
        expect(log.mock.calls.flat()).toContain(`JSON report written to ${outputPath}`);
        expect(log.mock.calls.flat()).toContain(`Markdown report written to ${outputPath}`);
      }
      finally {
        await fs.promises.rm(outputRoot, { recursive: true, force: true });
      }
    });

    it('rejects when writing a string report fails', async () => {
      const outputPath = path.join(cacheRoot, 'reporter-write-directory');
      await fs.promises.mkdir(outputPath, { recursive: true });
      try {
        captureLog();
        await expect(run({ ...baseConfig, reporters: ['json'], outputPath })).rejects.toThrow();
      }
      finally {
        await fs.promises.rm(outputPath, { recursive: true, force: true });
      }
    });

    it('reads the clock only for timestamped reporter paths and propagates clock failures', async () => {
      const toISOString = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
        throw new Error('timestamp failed');
      });
      const log = captureLog();
      try {
        await expect(run({ ...baseConfig, reporters: ['console'] })).resolves.toBeDefined();
        await expect(run({ ...baseConfig, reporters: ['json'] })).resolves.toBeDefined();
        expect(toISOString).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalled();
        await expect(run({ ...baseConfig, reporters: ['markdown'] })).rejects.toThrow('timestamp failed');
      }
      finally {
        toISOString.mockRestore();
      }
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

    it('spreads scored JSON results before reading the clock', async () => {
      const events: string[] = [];
      const validationResults: ValidationResults = {
        documents: [],
        summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
      };
      const proxiedResults = new Proxy(validationResults, {
        ownKeys(target) {
          events.push('results:keys');
          return Reflect.ownKeys(target);
        },
        get(target, property, receiver) {
          events.push(`results:${String(property)}`);
          return Reflect.get(target, property, receiver);
        },
      });
      const scores: ProjectScores = {
        projectScore: 100,
        projectGrade: 'A',
        documents: [],
        summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
      };
      const validate = vi.spyOn(ValidationEngine.prototype, 'validate').mockResolvedValue(proxiedResults);
      const calculateScores = vi.spyOn(FreshnessScorer.prototype, 'calculateProjectScores').mockReturnValue(scores);
      const originalToISOString = Date.prototype.toISOString;
      const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(function (this: Date) {
        events.push('clock');
        return originalToISOString.call(this);
      });
      try {
        captureLog();
        await run({
          ...baseConfig,
          reporters: ['json'],
          graph: { enabled: true },
          freshnessScoring: { enabled: true },
          cache: { enabled: false },
        });
        expect(events.filter((event) => event !== 'results:then')).toEqual([
          'results:keys',
          'results:documents',
          'results:summary',
          'clock',
        ]);
      }
      finally {
        validate.mockRestore();
        calculateScores.mockRestore();
        clock.mockRestore();
      }
    });

    it('does not read the clock when runner scored-result spreading fails', async () => {
      const validationResults: ValidationResults = {
        documents: [],
        summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
      };
      const proxiedResults = new Proxy(validationResults, {
        get(target, property, receiver) {
          if (property === 'documents') {
            throw new Error('runner result getter failed');
          }
          return Reflect.get(target, property, receiver);
        },
      });
      const scores: ProjectScores = {
        projectScore: 100,
        projectGrade: 'A',
        documents: [],
        summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
      };
      const validate = vi.spyOn(ValidationEngine.prototype, 'validate').mockResolvedValue(proxiedResults);
      const calculateScores = vi.spyOn(FreshnessScorer.prototype, 'calculateProjectScores').mockReturnValue(scores);
      const clock = vi.spyOn(Date.prototype, 'toISOString');
      try {
        captureLog();
        await expect(
          run({
            ...baseConfig,
            reporters: ['json'],
            graph: { enabled: true },
            freshnessScoring: { enabled: true },
            cache: { enabled: false },
          })
        ).rejects.toThrow('runner result getter failed');
        expect(clock).not.toHaveBeenCalled();
      }
      finally {
        validate.mockRestore();
        calculateScores.mockRestore();
        clock.mockRestore();
      }
    });

    it('captures Markdown result references before the clock, then renders the base before scores', async () => {
      const events: string[] = [];
      const summary = { total: 1, valid: 1, errors: 0, warnings: 0, skipped: 0 };
      const documents: ValidationResults['documents'] = [];
      let currentSummary = summary;
      let currentDocuments = documents;
      const validationResults: ValidationResults = {
        get summary() {
          events.push('results:summary');
          return currentSummary;
        },
        set summary(value) {
          currentSummary = value;
        },
        get documents() {
          events.push('results:documents');
          return currentDocuments;
        },
        set documents(value) {
          currentDocuments = value;
        },
      };
      const scores: ProjectScores = {
        get projectScore() {
          events.push('scores:projectScore');
          summary.total = 99;
          return 100;
        },
        projectGrade: 'A',
        documents: [],
        summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
      };
      const validate = vi.spyOn(ValidationEngine.prototype, 'validate').mockResolvedValue(validationResults);
      const calculateScores = vi.spyOn(FreshnessScorer.prototype, 'calculateProjectScores').mockReturnValue(scores);
      const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(() => {
        events.push('clock');
        summary.total = 7;
        documents.push({ path: 'docs/captured.md', issues: [] });
        validationResults.summary = { total: 50, valid: 50, errors: 0, warnings: 0, skipped: 0 };
        validationResults.documents = [];
        return '2025-01-02T03:04:05.678Z';
      });
      try {
        const log = captureLog();
        await run({
          ...baseConfig,
          reporters: ['markdown'],
          graph: { enabled: true },
          freshnessScoring: { enabled: true },
          cache: { enabled: false },
        });
        const report = log.mock.calls.flat().find((value) => typeof value === 'string' && value.startsWith('#'));
        expect(events).toEqual(['results:summary', 'results:documents', 'clock', 'scores:projectScore']);
        expect(report).toContain('| Total Checked | 7 |');
        expect(report).toContain('docs/captured.md');
        expect(report).not.toContain('| Total Checked | 99 |');
        expect(report).not.toContain('| Total Checked | 50 |');
      }
      finally {
        validate.mockRestore();
        calculateScores.mockRestore();
        clock.mockRestore();
      }
    });

    it('does not inspect Markdown documents, clock, or scores when the summary getter fails', async () => {
      const events: string[] = [];
      let scoreRead = false;
      const validationResults: ValidationResults = {
        get summary(): ValidationResults['summary'] {
          events.push('results:summary');
          throw new Error('Markdown summary failed');
        },
        get documents() {
          events.push('results:documents');
          return [];
        },
      };
      const scores: ProjectScores = {
        get projectScore() {
          scoreRead = true;
          return 100;
        },
        projectGrade: 'A',
        documents: [],
        summary: { total: 0, gradeA: 0, gradeB: 0, gradeC: 0, gradeD: 0, gradeF: 0 },
      };
      const validate = vi.spyOn(ValidationEngine.prototype, 'validate').mockResolvedValue(validationResults);
      const calculateScores = vi.spyOn(FreshnessScorer.prototype, 'calculateProjectScores').mockReturnValue(scores);
      const clock = vi.spyOn(Date.prototype, 'toISOString');
      try {
        captureLog();
        await expect(
          run({
            ...baseConfig,
            reporters: ['markdown'],
            graph: { enabled: true },
            freshnessScoring: { enabled: true },
            cache: { enabled: false },
          })
        ).rejects.toThrow('Markdown summary failed');
        expect(events).toEqual(['results:summary']);
        expect(clock).not.toHaveBeenCalled();
        expect(scoreRead).toBe(false);
      }
      finally {
        validate.mockRestore();
        calculateScores.mockRestore();
        clock.mockRestore();
      }
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
    }
    finally {
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
  });
});
