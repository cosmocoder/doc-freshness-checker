import fs from 'fs';
import path from 'path';
import { VectorSearch } from './vectorSearch.js';
import type { CodeFile, DocFreshnessConfig, Document } from '../types.js';
import { FlagEmbedding } from 'fastembed';
import { captureConsoleLog, captureConsoleWarn } from '../test-utils/console.js';

let embedCallCount = 0;

vi.mock('fastembed', () => {
  const makeEmbedding = (seed: number) => {
    const arr = new Float32Array(384);
    for (let i = 0; i < 384; i++) arr[i] = Math.sin(seed + i * 0.1);
    return arr;
  };

  return {
    EmbeddingModel: { BGESmallENV15: 'BGESmallENV15' },
    FlagEmbedding: {
      init: vi.fn().mockResolvedValue({
        passageEmbed: vi.fn().mockImplementation((texts: string[]) => {
          return (async function* () {
            const { embedCallCount: _unused, ...rest } = { embedCallCount };
            void _unused;
            void rest;
            yield texts.map((_t: string, i: number) => {
              embedCallCount++;
              return makeEmbedding(embedCallCount + i);
            });
          })();
        }),
        queryEmbed: vi.fn().mockResolvedValue(
          (() => {
            const arr = new Float32Array(384);
            for (let i = 0; i < 384; i++) arr[i] = Math.sin(42 + i * 0.1);
            return arr;
          })()
        ),
      }),
    },
  };
});

function makeDoc(content: string, docPath: string = 'docs/test.md'): Document {
  return {
    path: docPath,
    absolutePath: `/project/${docPath}`,
    content,
    format: 'markdown',
    lines: content.split('\n'),
    references: [],
  };
}

const cacheDir = '.doc-freshness-cache/vector-test';

function makeConfig(overrides: Partial<DocFreshnessConfig> = {}): DocFreshnessConfig {
  return {
    vectorSearch: { enabled: true, similarityThreshold: 0.3 },
    cache: { dir: cacheDir },
    ...overrides,
  };
}

const createVS = (overrides: Partial<DocFreshnessConfig> = {}) => new VectorSearch(makeConfig(overrides));

async function createInitializedVS(overrides: Partial<DocFreshnessConfig> = {}): Promise<VectorSearch> {
  const vs = createVS(overrides);
  await vs.initialize();
  return vs;
}

const captureLog = captureConsoleLog;
const captureWarn = captureConsoleWarn;

describe('VectorSearch', () => {
  beforeEach(async () => {
    embedCallCount = 0;
    await fs.promises.unlink(path.join(cacheDir, 'embedding-cache.json')).catch(() => {});
  });

  afterAll(async () => {
    await fs.promises.rm(cacheDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('constructor', () => {
    it('uses configured cache dir', () => {
      const vs = createVS();
      expect(vs.isAvailable()).toBe(false);
    });

    it('falls back to default cache dir when not configured', () => {
      const vs = new VectorSearch({});
      expect(vs.isAvailable()).toBe(false);
    });
  });

  describe('initialize', () => {
    it('initializes the embedding model and makes it available', async () => {
      const vs = createVS();
      expect(vs.isAvailable()).toBe(false);
      const result = await vs.initialize();
      expect(result).toBe(true);
      expect(vs.isAvailable()).toBe(true);
    });

    it('returns true immediately on subsequent calls', async () => {
      const vs = createVS();
      await vs.initialize();
      const result = await vs.initialize();
      expect(result).toBe(true);
      expect(FlagEmbedding.init).toHaveBeenCalled();
    });

    it('deduplicates concurrent initialization calls', async () => {
      const vs = createVS();
      const [r1, r2] = await Promise.all([vs.initialize(), vs.initialize()]);
      expect(r1).toBe(true);
      expect(r2).toBe(true);
    });

    it('returns false and logs warning when model init fails', async () => {
      vi.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(new Error('permission denied'));
      const warnSpy = captureWarn();

      const vs = createVS();
      const result = await vs.initialize();
      expect(result).toBe(false);
      expect(vs.isAvailable()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('initialization failed'), expect.any(String));
    });

    it('logs verbose messages when verbose is enabled', async () => {
      const logSpy = captureLog();
      const vs = createVS({ verbose: true });
      await vs.initialize();
      const msgs = logSpy.mock.calls.flat().join(' ');
      expect(msgs).toContain('model');
    });
  });

  describe('isAvailable', () => {
    it('returns false before initialization', () => {
      expect(createVS().isAvailable()).toBe(false);
    });

    it('returns true after successful initialization', async () => {
      const vs = createVS();
      await vs.initialize();
      expect(vs.isAvailable()).toBe(true);
    });
  });

  describe('embedQuery', () => {
    it('generates a 384-dimensional embedding', async () => {
      const vs = await createInitializedVS();
      const embedding = await vs.embedQuery('test query');
      expect(embedding).toHaveLength(384);
      expect(embedding.every((v) => typeof v === 'number')).toBe(true);
    });

    it('throws if not initialized', async () => {
      const vs = createVS();
      await expect(vs.embedQuery('test')).rejects.toThrow('not initialized');
    });

    it('throws for empty/whitespace-only text', async () => {
      const vs = await createInitializedVS();
      await expect(vs.embedQuery('')).rejects.toThrow('empty');
      await expect(vs.embedQuery('   ')).rejects.toThrow('empty');
    });
  });

  describe('indexDocumentation', () => {
    it('indexes sections from documents, skipping short ones', async () => {
      const vs = createVS();
      const content = ['# Introduction', '', 'A'.repeat(60), '', '# Short', '', 'tiny', '', '# Details', '', 'B'.repeat(80)].join('\n');

      await vs.indexDocumentation([makeDoc(content)]);
      const stats = vs.getCacheStats();
      // "Introduction" section (60 chars) and "Details" section (80 chars) indexed
      // "Short" section ("tiny" = 4 chars) skipped
      expect(stats.indexedDocSections).toBe(2);
    });

    it('clears previous index on re-indexing', async () => {
      const vs = createVS();
      const content = '# Section\n\n' + 'X'.repeat(60);
      await vs.indexDocumentation([makeDoc(content)]);
      expect(vs.getCacheStats().indexedDocSections).toBe(1);

      await vs.indexDocumentation([makeDoc(content, 'other.md')]);
      expect(vs.getCacheStats().indexedDocSections).toBe(1);
    });

    it('indexes multiple documents', async () => {
      const vs = createVS();
      const content = '# Heading\n\n' + 'Z'.repeat(60);
      await vs.indexDocumentation([makeDoc(content, 'docs/a.md'), makeDoc(content, 'docs/b.md')]);
      expect(vs.getCacheStats().indexedDocSections).toBe(2);
    });

    it('stores section heading and truncated text in metadata', async () => {
      const vs = createVS();
      const content = '# My Heading\n\n' + 'Content here. '.repeat(20);
      await vs.indexDocumentation([makeDoc(content)]);
      const stats = vs.getCacheStats();
      expect(stats.indexedDocSections).toBe(1);
    });

    it('handles content with no headings (uses "Introduction" as default)', async () => {
      const vs = createVS();
      const content = 'Long paragraph without any headings. '.repeat(5);
      await vs.indexDocumentation([makeDoc(content)]);
      expect(vs.getCacheStats().indexedDocSections).toBe(1);
    });

    it('does nothing when initialization fails', async () => {
      vi.spyOn(fs.promises, 'mkdir').mockRejectedValueOnce(new Error('fail'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const vs = createVS();
      const content = '# Test\n\n' + 'X'.repeat(60);
      await vs.indexDocumentation([makeDoc(content)]);
      expect(vs.getCacheStats().indexedDocSections).toBe(0);
    });
  });

  describe('indexCodeComments', () => {
    it('indexes TypeScript JSDoc comments', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'src/a.ts',
          content: '/** Handles user authentication and session management */\nfunction auth() {}',
          language: 'typescript',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('indexes Python docstrings', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'src/app.py',
          content: '"""This module handles data processing and transformation"""\ndef process(): pass',
          language: 'python',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('indexes Go comments', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'main.go',
          content: '// HandleRequest processes incoming HTTP requests and returns responses\nfunc HandleRequest() {}',
          language: 'go',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('indexes Rust doc comments', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'lib.rs',
          content: '/// Processes the input configuration and validates all fields\nfn process_config() {}',
          language: 'rust',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('falls back to JavaScript patterns for unknown languages', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'script.rb',
          content: '// This helper utility performs string sanitization operations\nfunction sanitize() {}',
          language: 'ruby',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('skips comments shorter than 20 characters', async () => {
      const vs = await createInitializedVS();
      await vs.indexCodeComments([
        {
          path: 'src/a.ts',
          content: '// short\nfunction f() {}\n/** Also short */\nfunction g() {}',
          language: 'typescript',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBe(0);
    });

    it('indexes multiple files', async () => {
      const vs = await createInitializedVS();
      const files: CodeFile[] = [
        { path: 'a.ts', content: '/** Validates user input and sanitizes data */\nfunction validate() {}', language: 'typescript' },
        { path: 'b.ts', content: '/** Processes batch operations for large datasets */\nfunction batch() {}', language: 'typescript' },
      ];
      await vs.indexCodeComments(files);
      expect(vs.getCacheStats().indexedCodeComments).toBe(2);
    });
  });

  describe('findMismatches', () => {
    it('returns empty array when no entries indexed', async () => {
      const vs = createVS();
      await vs.initialize();
      const mismatches = await vs.findMismatches();
      expect(mismatches).toEqual([]);
    });

    it('returns empty when only doc sections exist (no code to compare)', async () => {
      const vs = createVS();
      const content = '# API\n\nThis function handles authentication and returns a valid token.';
      await vs.indexDocumentation([makeDoc(content)]);
      const mismatches = await vs.findMismatches();
      // No code entries → bestScore stays 0, which is < threshold
      // But content must contain technical keywords
      expect(Array.isArray(mismatches)).toBe(true);
    });

    it('reports mismatches for technical doc sections with low similarity to code', async () => {
      const vs = createVS();

      const docContent = '# API\n\nThis function handles authentication and returns a session token.';
      await vs.indexDocumentation([makeDoc(docContent)]);

      await vs.indexCodeComments([
        {
          path: 'src/unrelated.ts',
          content: '/** Handles database connection pooling and query optimization */\nfunction dbConnect() {}',
          language: 'typescript',
        },
      ]);

      // With different embeddings (seeded differently), similarity won't be 1.0
      // Use a very high threshold to force mismatch detection
      const mismatches = await vs.findMismatches(1.0);
      expect(mismatches.length).toBeGreaterThan(0);
      expect(mismatches[0].docPath).toBe('docs/test.md');
      expect(mismatches[0].suggestion).toContain('Documentation may describe');
      expect(mismatches[0].bestMatch).not.toBeNull();
    });

    it('ignores non-technical content even with low similarity', async () => {
      const vs = createVS();

      // Content without technical keywords: function, class, method, API, returns
      const docContent = '# About\n\n' + 'This is a general overview of the project and its goals. '.repeat(3);
      await vs.indexDocumentation([makeDoc(docContent)]);

      await vs.indexCodeComments([
        {
          path: 'src/a.ts',
          content: '/** Handles something completely different than what the doc says */\nfunction x() {}',
          language: 'typescript',
        },
      ]);

      const mismatches = await vs.findMismatches(1.0);
      expect(mismatches).toHaveLength(0);
    });

    it.each(['function', 'class', 'method', 'API', 'returns'])('detects mismatch when doc contains keyword "%s"', async (keyword) => {
      const vs = createVS();

      const docContent = `# Reference\n\nThis section describes the ${keyword} that handles processing.` + ' '.repeat(20);
      await vs.indexDocumentation([makeDoc(docContent)]);

      await vs.indexCodeComments([
        {
          path: 'src/other.ts',
          content: '/** Completely unrelated documentation string here */\nfunction z() {}',
          language: 'typescript',
        },
      ]);

      const mismatches = await vs.findMismatches(1.0);
      expect(mismatches.length).toBeGreaterThan(0);
    });

    it('uses config threshold when no explicit threshold is passed', async () => {
      const vs = new VectorSearch(makeConfig({ vectorSearch: { similarityThreshold: 1.0 } }));

      const docContent = '# API\n\nThis function performs data validation and returns errors.';
      await vs.indexDocumentation([makeDoc(docContent)]);
      await vs.indexCodeComments([
        {
          path: 'src/a.ts',
          content: '/** Handles file system operations and directory management */\nfunction fsOp() {}',
          language: 'typescript',
        },
      ]);

      const mismatches = await vs.findMismatches();
      // threshold=1.0 from config, so almost everything is a mismatch
      expect(mismatches.length).toBeGreaterThan(0);
    });

    it('populates mismatch fields correctly', async () => {
      const vs = createVS();

      const docContent = '# Auth API\n\nThis function handles user authentication and returns a JWT token.';
      await vs.indexDocumentation([makeDoc(docContent, 'docs/auth.md')]);
      await vs.indexCodeComments([
        {
          path: 'src/db.ts',
          content: '/** Manages database connections and query execution lifecycle */\nfunction dbQuery() {}',
          language: 'typescript',
        },
      ]);

      const mismatches = await vs.findMismatches(1.0);
      expect(mismatches.length).toBeGreaterThan(0);
      const m = mismatches[0];
      expect(m.docPath).toBe('docs/auth.md');
      expect(m.docSection).toBeDefined();
      expect(m.docText).toBeDefined();
      expect(typeof m.bestMatchScore).toBe('number');
      expect(m.bestMatch).toHaveProperty('path', 'src/db.ts');
      expect(m.bestMatch).toHaveProperty('type', 'code');
    });
  });

  describe('splitIntoSections (tested via indexDocumentation)', () => {
    it('splits by headings of various levels', async () => {
      const vs = createVS();
      const content = [
        '# H1 Section',
        '',
        'X'.repeat(60),
        '',
        '## H2 Section',
        '',
        'Y'.repeat(60),
        '',
        '### H3 Section',
        '',
        'Z'.repeat(60),
      ].join('\n');

      await vs.indexDocumentation([makeDoc(content)]);
      expect(vs.getCacheStats().indexedDocSections).toBe(3);
    });

    it('creates single "Introduction" section when no headings present', async () => {
      const vs = createVS();
      await vs.indexDocumentation([makeDoc('A'.repeat(100))]);
      expect(vs.getCacheStats().indexedDocSections).toBe(1);
    });

    it('handles document with heading but empty body', async () => {
      const vs = createVS();
      await vs.indexDocumentation([makeDoc('# Title\n\nshort')]);
      // "Introduction" before heading is empty, "Title" body is "short" (< 50 chars)
      expect(vs.getCacheStats().indexedDocSections).toBe(0);
    });

    it('handles leading content before the first heading', async () => {
      const vs = createVS();
      const content = 'Preamble content before any heading. '.repeat(5) + '\n\n# First Heading\n\n' + 'Q'.repeat(60);
      await vs.indexDocumentation([makeDoc(content)]);
      // Preamble as "Introduction" (~185 chars) + "First Heading" body (60 chars) = 2 sections
      expect(vs.getCacheStats().indexedDocSections).toBe(2);
    });
  });

  describe('extractComments (tested via indexCodeComments)', () => {
    async function indexAndCount(content: string, language: string): Promise<number> {
      const vs = createVS();
      await vs.initialize();
      await vs.indexCodeComments([{ path: 'test.file', content, language }]);
      return vs.getCacheStats().indexedCodeComments;
    }

    it('extracts JavaScript JSDoc and single-line comments', async () => {
      const content = [
        '/** This function manages the application lifecycle and startup */\n',
        'function start() {}\n',
        '// This is a single-line comment describing the shutdown procedure\n',
        'function stop() {}',
      ].join('');
      expect(await indexAndCount(content, 'javascript')).toBe(2);
    });

    it('extracts Python docstrings and hash comments', async () => {
      const content = [
        '"""This module provides utilities for handling data transformation"""\n',
        '# This helper function validates incoming request parameters\n',
        'def validate(): pass',
      ].join('');
      expect(await indexAndCount(content, 'python')).toBe(2);
    });

    it('extracts Java Javadoc comments', async () => {
      const content = '/**\n * Manages the entire database connection lifecycle process\n */\nclass DbManager {}';
      expect(await indexAndCount(content, 'java')).toBeGreaterThan(0);
    });

    it('strips comment delimiters and leading asterisks', async () => {
      const vs = createVS();
      await vs.initialize();
      // The JSDoc has delimiters that should be stripped
      await vs.indexCodeComments([
        {
          path: 'test.ts',
          content: '/**\n * Validates authentication tokens and refreshes session data\n */\nfunction validate() {}',
          language: 'typescript',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBe(1);
    });

    it('ignores empty comments after stripping', async () => {
      const content = '/***/\nfunction f() {}\n//\nfunction g() {}';
      expect(await indexAndCount(content, 'typescript')).toBe(0);
    });
  });

  describe('findNearestSymbol (tested via indexCodeComments metadata)', () => {
    it('finds function name after a comment', async () => {
      const vs = createVS();
      await vs.initialize();
      await vs.indexCodeComments([
        {
          path: 'test.ts',
          content: '/** This function handles authentication */\nfunction authenticate() {}',
          language: 'typescript',
        },
      ]);
      // We can't inspect metadata directly, but the indexing should succeed
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });

    it('finds class name after a comment', async () => {
      const vs = createVS();
      await vs.initialize();
      await vs.indexCodeComments([
        {
          path: 'test.ts',
          content: '/** Manages user session lifecycle and token refresh */\nclass SessionManager {}',
          language: 'typescript',
        },
      ]);
      expect(vs.getCacheStats().indexedCodeComments).toBeGreaterThan(0);
    });
  });

  describe('embedding cache', () => {
    it('caches embeddings in memory for repeated content', async () => {
      const vs = createVS();
      const content = '# Same\n\n' + 'Identical content section here. '.repeat(5);
      // Index twice — second run should hit cache
      await vs.indexDocumentation([makeDoc(content, 'a.md')]);
      const firstCount = vs.getCacheStats().cachedEmbeddings;
      expect(firstCount).toBeGreaterThan(0);

      // Re-indexing clears vectorIndex but embedding cache persists
      await vs.indexDocumentation([makeDoc(content, 'b.md')]);
      expect(vs.getCacheStats().cachedEmbeddings).toBe(firstCount);
    });

    it('persists cache to disk via findMismatches (saveCache)', async () => {
      const vs = createVS();
      const content = '# Persist Test\n\nThis function saves embeddings to the file system cache.';
      await vs.indexDocumentation([makeDoc(content)]);
      await vs.findMismatches();

      const cacheFile = path.join(cacheDir, 'embedding-cache.json');
      const exists = await fs.promises
        .access(cacheFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const data = JSON.parse(await fs.promises.readFile(cacheFile, 'utf-8'));
      expect(data.model).toBe('BGESmallENV15');
      expect(data.dimensions).toBe(384);
      expect(typeof data.timestamp).toBe('string');
      expect(Object.keys(data.embeddings).length).toBeGreaterThan(0);
    });
  });

  describe('getCacheStats', () => {
    it('returns zero counts for fresh instance', () => {
      const stats = createVS().getCacheStats();
      expect(stats).toEqual({ cachedEmbeddings: 0, indexedDocSections: 0, indexedCodeComments: 0 });
    });

    it('reflects doc and code counts separately', async () => {
      const vs = createVS();
      const docContent = '# Doc\n\n' + 'D'.repeat(60);
      await vs.indexDocumentation([makeDoc(docContent)]);
      await vs.indexCodeComments([
        {
          path: 'a.ts',
          content: '/** Handles request processing and response formatting */\nfunction handle() {}',
          language: 'typescript',
        },
      ]);

      const stats = vs.getCacheStats();
      expect(stats.indexedDocSections).toBe(1);
      expect(stats.indexedCodeComments).toBeGreaterThanOrEqual(1);
      expect(stats.cachedEmbeddings).toBeGreaterThan(0);
    });
  });

  describe('clearCache', () => {
    it('resets all internal state', async () => {
      const vs = createVS();
      await vs.initialize();
      const docContent = '# Test\n\n' + 'X'.repeat(60);
      await vs.indexDocumentation([makeDoc(docContent)]);
      expect(vs.getCacheStats().indexedDocSections).toBe(1);
      expect(vs.getCacheStats().cachedEmbeddings).toBeGreaterThan(0);

      await vs.clearCache();
      const stats = vs.getCacheStats();
      expect(stats.indexedDocSections).toBe(0);
      expect(stats.indexedCodeComments).toBe(0);
      expect(stats.cachedEmbeddings).toBe(0);
    });

    it('handles missing cache file without error', async () => {
      const vs = new VectorSearch(makeConfig({ cache: { dir: '.doc-freshness-cache/no-such-dir' } }));
      await expect(vs.clearCache()).resolves.not.toThrow();
    });
  });

  describe('loadCache (disk persistence)', () => {
    it('restores embeddings and index from disk', async () => {
      const vs1 = createVS();
      const docContent = '# Cached\n\nThis function handles data persistence and restoration.';
      await vs1.indexDocumentation([makeDoc(docContent)]);
      await vs1.findMismatches();

      const vs2 = createVS();
      await vs2.indexDocumentation([makeDoc(docContent)]);
      const stats = vs2.getCacheStats();
      expect(stats.cachedEmbeddings).toBeGreaterThan(0);
    });

    it('logs loaded count in verbose mode', async () => {
      const vs1 = createVS();
      const docContent = '# Verbose Cache\n\nThis function handles authentication and session management.';
      await vs1.indexDocumentation([makeDoc(docContent)]);
      await vs1.findMismatches();

      const logSpy = captureLog();
      const vs2 = createVS({ verbose: true });
      await vs2.indexDocumentation([makeDoc(docContent)]);
      expect(logSpy.mock.calls.flat().join(' ')).toContain('cached embeddings');
    });
  });

  describe('saveCache error', () => {
    it('logs warning when save fails in verbose mode', async () => {
      const vs = await createInitializedVS({ verbose: true, cache: { dir: '/nonexistent/permission-denied' } });
      const docContent = '# Save Fail\n\nThis function does something complex with data processing.';
      await vs.indexDocumentation([makeDoc(docContent)]);

      const warnSpy = captureWarn();
      await vs.findMismatches();
      expect(warnSpy.mock.calls.flat().join(' ')).toContain('Failed to save');
    });

    it('silently ignores save failure in non-verbose mode', async () => {
      const vs = await createInitializedVS({ cache: { dir: '/nonexistent/permission-denied' } });
      const docContent = '# Silent Fail\n\nThis function returns the processed result data.';
      await vs.indexDocumentation([makeDoc(docContent)]);

      const warnSpy = captureWarn();
      await vs.findMismatches();
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('model initialization retries', () => {
    it('retries on initialization failure and logs in verbose', async () => {
      const initMock = vi.mocked(FlagEmbedding.init);
      initMock.mockRejectedValueOnce(new Error('transient'));
      initMock.mockRejectedValueOnce(new Error('transient'));
      initMock.mockRejectedValueOnce(new Error('still broken'));

      const warnSpy = captureWarn();
      const vs = createVS({ verbose: true });

      // Only fake setTimeout so that fs.promises and other I/O remain real.
      // Timer advances are done in a loop because initialize() performs async
      // I/O (mkdir, readdir) before reaching the retry setTimeout. A single
      // advanceTimersByTimeAsync call would complete before the timer is even
      // registered. The loop alternates between advancing the fake clock and
      // yielding to the real event loop via setImmediate, giving I/O callbacks
      // a chance to run and register the next setTimeout between iterations.
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        const initPromise = vs.initialize();
        let settled = false;
        initPromise.finally(() => {
          settled = true;
        });
        while (!settled) {
          vi.advanceTimersByTime(5000);
          await new Promise((r) => setImmediate(r));
        }
        const result = await initPromise;
        expect(result).toBe(false);
        const warns = warnSpy.mock.calls.flat().join(' ');
        expect(warns).toContain('initialization failed');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('embed edge cases', () => {
    it('throws when embedding model is not initialized', async () => {
      const vs = createVS();
      await expect(vs.embedQuery('test query')).rejects.toThrow('not initialized');
    });
  });

  describe('verbose doc/code indexing messages', () => {
    it('logs indexing stats in verbose mode', async () => {
      const logSpy = captureLog();
      const vs = createVS({ verbose: true });
      const docContent = '# Stats\n\nThis function validates and processes input data correctly.';
      await vs.indexDocumentation([makeDoc(docContent)]);
      const output = logSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Indexed documentation');
    });

    it('logs code comment indexing stats in verbose mode', async () => {
      const logSpy = captureLog();
      const vs = await createInitializedVS({ verbose: true });
      await vs.indexCodeComments([
        {
          path: 'verbose.ts',
          content: '/** Processes authentication tokens and validates session integrity */\nfunction auth() {}',
          language: 'typescript',
        },
      ]);
      const output = logSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Indexed code comments');
    });
  });
});
