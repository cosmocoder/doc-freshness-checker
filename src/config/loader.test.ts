import fs from 'fs';
import { execFile } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import { pathToFileURL } from 'url';
import { loadConfig, DEFAULT_CONFIG } from './loader.js';
import { BUILT_IN_RULE_TYPES } from './defaults.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const execFileAsync = promisify(execFile);

describe('DEFAULT_CONFIG', () => {
  it('has sensible default values', () => {
    expect(DEFAULT_CONFIG.include).toEqual(['docs/**/*.md', 'README.md']);
    expect(DEFAULT_CONFIG.exclude).toContain('**/node_modules/**');
    expect(DEFAULT_CONFIG.urlValidation?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.urlValidation?.timeout).toBe(10000);
    expect(DEFAULT_CONFIG.rules?.['file-path']?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.rules?.dependency).toMatchObject({ enabled: true, severity: 'info' });
    expect(DEFAULT_CONFIG.rules?.['code-snippet']).toEqual({ enabled: true, severity: 'warning' });
    expect(Object.keys(DEFAULT_CONFIG.rules!).sort()).toEqual([...BUILT_IN_RULE_TYPES].sort());
    expect(DEFAULT_CONFIG.reporters).toEqual(['console']);
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});

describe('loadConfig', () => {
  let tmpDir: string;
  const unlinkIfExists = async (filePath: string) => {
    await fs.promises.unlink(filePath).catch(() => {});
  };

  async function withTempConfig(
    fileName: string,
    content: string | Record<string, unknown>,
    assertConfig: (configPath: string) => Promise<void>
  ) {
    const configPath = path.join(tmpDir, fileName);
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    await fs.promises.writeFile(configPath, serialized);
    try {
      await assertConfig(configPath);
    }
    finally {
      await unlinkIfExists(configPath);
    }
  }

  beforeAll(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'doc-freshness-config-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('uses defaults only when no explicit or discovered config exists', async () => {
    const emptyProject = path.join(tmpDir, 'no-config-project');
    await fs.promises.mkdir(emptyProject, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(emptyProject);
    const defaultSnapshot = structuredClone(DEFAULT_CONFIG);

    try {
      const first = await loadConfig();
      first.include!.push('mutated/**/*.md');
      first.rules!.dependency!.enabled = false;

      const second = await loadConfig();
      expect(second.include).toEqual(defaultSnapshot.include);
      expect(second.rules?.dependency?.enabled).toBe(defaultSnapshot.rules?.dependency?.enabled);
      expect(second._noConfigFile).toBe(true);
      expect(DEFAULT_CONFIG).toEqual(defaultSnapshot);
    }
    finally {
      Object.assign(DEFAULT_CONFIG, structuredClone(defaultSnapshot));
    }
  });

  it('rejects a discovered config with a missing dependency', async () => {
    await withTempConfig('.doc-freshness.config.js', `import './missing-auto-dependency.mjs'; export default {};`, async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
      await expect(loadConfig()).rejects.toThrow('missing-auto-dependency.mjs');
    });
  });

  it.each(['missing.json', 'missing.cjs'])('rejects an explicitly requested missing %s config', async (fileName) => {
    await expect(loadConfig(path.join(tmpDir, fileName))).rejects.toThrow(fileName);
  });

  it('loads JSON config file and merges with defaults', async () => {
    await withTempConfig('test-config.json', { verbose: true, include: ['**/*.md'] }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
      expect(config.include).toEqual(['**/*.md']);
      expect(config.urlValidation?.enabled).toBe(true);
      expect(config._configFile).toBeDefined();
    });
  });

  it('deep-merges nested config objects', async () => {
    await withTempConfig(
      'merge-config.json',
      {
        urlValidation: { timeout: 5000 },
      },
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.urlValidation?.timeout).toBe(5000);
        expect(config.urlValidation?.enabled).toBe(true);
      }
    );
  });

  it('isolates sequential loads and the default config from mutations', async () => {
    const defaultSnapshot = structuredClone(DEFAULT_CONFIG);

    try {
      await withTempConfig('isolated-config.json', {}, async (tmpConfig) => {
        const first = await loadConfig(tmpConfig);

        first.include!.push('mutated/**/*.md');
        first.reporters!.push('json');
        first.urlValidation!.skipDomains!.push('mutated.example');
        first.rules!['file-path']!.illustrativePatterns!.push('mutated-pattern');
        first.rules!.dependency!.enabled = false;
        first.freshnessScoring!.weights!.referenceValidity = 0;
        first.cache!.enabled = false;

        const second = await loadConfig(tmpConfig);

        expect(second.include).toEqual(defaultSnapshot.include);
        expect(second.reporters).toEqual(defaultSnapshot.reporters);
        expect(second.urlValidation?.skipDomains).toEqual(defaultSnapshot.urlValidation?.skipDomains);
        expect(second.rules?.['file-path']?.illustrativePatterns).toEqual(defaultSnapshot.rules?.['file-path']?.illustrativePatterns);
        expect(second.rules?.dependency?.enabled).toBe(defaultSnapshot.rules?.dependency?.enabled);
        expect(second.freshnessScoring?.weights?.referenceValidity).toBe(defaultSnapshot.freshnessScoring?.weights?.referenceValidity);
        expect(second.cache?.enabled).toBe(defaultSnapshot.cache?.enabled);
        expect(second.rules).not.toBe(first.rules);
        expect(second.rules?.['file-path']).not.toBe(first.rules?.['file-path']);
        expect(DEFAULT_CONFIG).toEqual(defaultSnapshot);
      });
    }
    finally {
      Object.assign(DEFAULT_CONFIG, structuredClone(defaultSnapshot));
    }
  });

  it('preserves functions in custom extractors and validators', async () => {
    await withTempConfig(
      'custom-functions.cjs',
      `module.exports = {
        customExtractors: [{
          type: 'custom',
          supportedFormats: ['markdown'],
          supportsFormat() { return true; },
          extract() { return []; },
          findLineNumber() { return 1; },
          getContext() { return ''; }
        }],
        customValidators: { custom: { async validateBatch() { return []; } } }
      };`,
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.customExtractors?.[0].supportsFormat('markdown')).toBe(true);
        await expect(config.customValidators?.custom.validateBatch([], {} as never, config)).resolves.toEqual([]);
      }
    );
  });

  it('preserves custom extractor class instances', async () => {
    await withTempConfig(
      'custom-extractor-class.cjs',
      `class CustomExtractor {
        constructor() {
          this.type = 'custom';
          this.supportedFormats = ['markdown'];
        }
        supportsFormat(format) { return format === 'markdown'; }
        extract() { return []; }
        findLineNumber() { return 1; }
        getContext() { return ''; }
      }
      module.exports = { customExtractors: [new CustomExtractor()] };`,
      async (tmpConfig) => {
        const extractor = (await loadConfig(tmpConfig)).customExtractors?.[0];
        expect(extractor?.constructor.name).toBe('CustomExtractor');
        expect(extractor?.supportsFormat('markdown')).toBe(true);
      }
    );
  });

  it('isolates arrays and plain objects exported by config dependencies', async () => {
    const sharedValuesPath = path.join(tmpDir, 'shared-values.cjs');
    await fs.promises.writeFile(sharedValuesPath, `module.exports = { include: ['docs/**/*.md'], customValidators: {} };`);

    try {
      await withTempConfig('shared-config.cjs', `module.exports = require('./shared-values.cjs');`, async (tmpConfig) => {
        const first = await loadConfig(tmpConfig);
        first.include!.push('mutated/**/*.md');
        first.customValidators!.mutated = {
          async validateBatch() {
            return [];
          },
        };

        const second = await loadConfig(tmpConfig);
        expect(second.include).toEqual(['docs/**/*.md']);
        expect(second.customValidators).toEqual({});
      });
    }
    finally {
      await unlinkIfExists(sharedValuesPath);
    }
  });

  it('auto-detects manifest files', async () => {
    const config = await loadConfig();
    expect(config.manifestFiles).toBeDefined();
    expect(Array.isArray(config.manifestFiles)).toBe(true);
    if (fs.existsSync(path.join(process.cwd(), 'package.json'))) {
      expect(config.manifestFiles).toContain('package.json');
    }
  });

  it('auto-detects source patterns', async () => {
    const config = await loadConfig();
    expect(config.sourcePatterns).toBeDefined();
    expect(Array.isArray(config.sourcePatterns)).toBe(true);
    expect(config.sourcePatterns!.length).toBeGreaterThan(0);
  });

  it('preserves user-provided manifestFiles and sourcePatterns', async () => {
    await withTempConfig(
      'custom-patterns.json',
      {
        manifestFiles: ['custom-manifest.json'],
        sourcePatterns: ['custom/**/*.ts'],
      },
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.manifestFiles).toEqual(['custom-manifest.json']);
        expect(config.sourcePatterns).toEqual(['custom/**/*.ts']);
      }
    );
  });

  it('loads .cjs config file', async () => {
    await withTempConfig('test-config.cjs', 'module.exports = { verbose: true, include: ["**/*.md"] };', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('handles config file with ESM syntax (export default)', async () => {
    await withTempConfig('test-esm.js', 'export default { verbose: true, include: ["**/*.md"] };', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('loads cache-busted ESM .js configs from CommonJS projects without a local package', async () => {
    const projectDir = await fs.promises.mkdtemp(path.join(tmpdir(), 'doc-freshness-commonjs-'));
    const configPath = path.join(projectDir, 'doc-freshness.config.js');
    const concurrentConfigPath = path.join(projectDir, 'concurrent.config.js');
    await fs.promises.writeFile(path.join(projectDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    await fs.promises.writeFile(path.join(projectDir, 'config-value.mjs'), `export const include = ['from-sibling/**/*.md'];`);
    await fs.promises.writeFile(path.join(projectDir, 'config-value.txt'), 'from-asset');
    await fs.promises.writeFile(
      configPath,
      [
        `import { defineConfig } from 'doc-freshness-checker';`,
        `import { include } from './config-value.mjs';`,
        `import { readFileSync } from 'node:fs';`,
        `export default defineConfig({ include, outputDir: readFileSync(new URL('./config-value.txt', import.meta.url), 'utf8'), outputPath: import.meta.filename });`,
      ].join('\n')
    );
    await fs.promises.writeFile(
      concurrentConfigPath,
      `import { defineConfig } from 'doc-freshness-checker';\nexport default defineConfig({ outputDir: 'concurrent' });`
    );

    try {
      expect(fs.existsSync(path.join(projectDir, 'node_modules'))).toBe(false);
      const loaderUrl = pathToFileURL(path.join(process.cwd(), 'src/config/esm-loader.ts')).href;
      const reloadedSource = `import { defineConfig } from 'doc-freshness-checker';\nexport default defineConfig({ outputDir: 'reloaded' });`;
      const script = `
        import { readFile, writeFile } from 'node:fs/promises';
        import { loadESMConfig } from ${JSON.stringify(loaderUrl)};
        const [configPath, concurrentConfigPath, reloadedSource] = process.argv.slice(1);
        const load = async filePath => loadESMConfig(await readFile(filePath, 'utf8'), filePath);
        const [config, concurrentConfig] = await Promise.all([load(configPath), load(concurrentConfigPath)]);
        await writeFile(configPath, "throw new Error('config failed');");
        let errorMessage;
        try { await load(configPath); } catch (error) { errorMessage = error.message; }
        await writeFile(configPath, reloadedSource);
        const reloadedConfig = await load(configPath);
        process.stdout.write(JSON.stringify({ config, concurrentConfig, errorMessage, reloadedConfig }));
      `;
      const { stdout } = await execFileAsync(process.execPath, [
        '--input-type=module',
        '--eval',
        script,
        configPath,
        concurrentConfigPath,
        reloadedSource,
      ]);
      const result = JSON.parse(stdout);

      expect(result.config.include).toEqual(['from-sibling/**/*.md']);
      expect(result.config.outputDir).toBe('from-asset');
      expect(result.config.outputPath).toBe(configPath);
      expect(result.concurrentConfig.outputDir).toBe('concurrent');
      expect(result.errorMessage).toBe('config failed');
      expect(result.reloadedConfig.outputDir).toBe('reloaded');
    }
    finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
    }
  });

  it('loads a discovered ESM config from its original directory', async () => {
    const siblingModule = path.join(tmpDir, 'discovered-value.mjs');
    await fs.promises.writeFile(siblingModule, `export const outputDir = 'discovered-sibling';`);

    try {
      await withTempConfig(
        '.doc-freshness.config.js',
        [`import { outputDir } from './discovered-value.mjs';`, `export default { outputDir, outputPath: import.meta.filename };`].join(
          '\n'
        ),
        async (configPath) => {
          const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
          try {
            const config = await loadConfig();
            expect(config.outputDir).toBe('discovered-sibling');
            expect(config.outputPath).toBe(configPath);
          }
          finally {
            cwdSpy.mockRestore();
          }
        }
      );
    }
    finally {
      await unlinkIfExists(siblingModule);
    }
  });

  it('loads an ESM config with a relative import', async () => {
    const dependencyPath = path.join(tmpDir, 'shared-config-value.mjs');
    await fs.promises.writeFile(dependencyPath, 'export const verbose = true;');

    try {
      await withTempConfig(
        'relative-import-config.mjs',
        `import { verbose } from './shared-config-value.mjs'; export default { verbose };`,
        async (tmpConfig) => {
          expect((await loadConfig(tmpConfig)).verbose).toBe(true);
          expect((await fs.promises.readdir(tmpDir)).some((name) => name.startsWith('.doc-freshness-temp-config-'))).toBe(false);
        }
      );
    }
    finally {
      await unlinkIfExists(dependencyPath);
    }
  });

  it.each([
    ['CJS', 'missing-dependency.cjs', `require('./missing-dependency.cjs'); module.exports = {};`],
    ['ESM', 'missing-dependency.mjs', `import './missing-dependency.mjs'; export default {};`],
  ])('rejects an existing %s config with a missing dependency', async (moduleType, missingDependency, content) => {
    await withTempConfig(`missing-dependency-config.${moduleType === 'CJS' ? 'cjs' : 'mjs'}`, content, async (tmpConfig) => {
      await expect(loadConfig(tmpConfig)).rejects.toThrow(missingDependency);
    });
  });

  it('rejects an invalid JSON config', async () => {
    await withTempConfig('bad-config.json', 'not valid json!!!', async (tmpConfig) => {
      await expect(loadConfig(tmpConfig)).rejects.toThrow();
    });
  });

  it('loads .mjs config as ESM', async () => {
    await withTempConfig('test.mjs', 'export default { verbose: true };', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('detects ESM from export const pattern', async () => {
    await withTempConfig('esm-export-const.js', 'export const config = { verbose: true };\nexport default config;', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('detects ESM from import ... from pattern', async () => {
    await withTempConfig('esm-import.js', 'import path from "path";\nexport default { verbose: true };', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('detects ESM from export { ... } pattern', async () => {
    await withTempConfig(
      'esm-export-named.js',
      'const config = { verbose: true };\nexport { config };\nexport default config;',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      }
    );
  });

  it('detects .cjs extension and loads CJS config directly', async () => {
    await withTempConfig('direct-cjs.cjs', 'module.exports = { verbose: true, include: ["**/*.md"] };', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('merges arrays from user config (overrides, not deep merge)', async () => {
    await withTempConfig(
      'array-merge.json',
      {
        include: ['custom/**/*.md'],
        exclude: ['draft/**'],
      },
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.include).toEqual(['custom/**/*.md']);
        expect(config.exclude).toEqual(['draft/**']);
      }
    );
  });

  it('skips undefined user config values during merge', async () => {
    await withTempConfig('undefined-vals.json', { verbose: true }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
      expect(config.include).toEqual(DEFAULT_CONFIG.include);
    });
  });

  it('loads config without explicit path, using auto-detection', async () => {
    const config = await loadConfig();
    expect(config).toBeDefined();
    expect(config.rootDir).toBeDefined();
  });

  it('auto-detects source patterns with src subdirectory', async () => {
    const config = await loadConfig();
    expect(config.sourcePatterns).toBeDefined();
    expect(config.sourcePatterns!.some((p) => p.includes('src'))).toBe(true);
  });

  it('handles ESM config that exports module instead of default', async () => {
    await withTempConfig('esm-module-export.mjs', 'const config = { verbose: true };\nexport default config;', async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
  });

  it('sets rootDir to process.cwd when not specified', async () => {
    await withTempConfig('no-root.json', { verbose: true }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.rootDir).toBe(process.cwd());
    });
  });

  it('deep-merges nested objects but overwrites null with object values', async () => {
    await withTempConfig(
      'deep-null.json',
      {
        rules: { 'file-path': { severity: 'error' } },
        urlValidation: null,
      },
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.rules?.['file-path']?.severity).toBe('error');
      }
    );
  });

  it('falls back to broad source pattern when rootDir has no source dirs', async () => {
    const emptyDir = path.join(tmpDir, 'empty-root');
    await fs.promises.mkdir(emptyDir, { recursive: true });
    await withTempConfig('empty-root-config.json', { rootDir: emptyDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns).toBeDefined();
      expect(config.sourcePatterns!.length).toBeGreaterThan(0);
    });
  });

  it('returns empty manifest list when rootDir has no manifests', async () => {
    const emptyDir = path.join(tmpDir, 'no-manifests');
    await fs.promises.mkdir(emptyDir, { recursive: true });
    await withTempConfig('no-manifests-config.json', { rootDir: emptyDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.manifestFiles).toEqual([]);
    });
  });

  it('detects source files in subdirectories', async () => {
    const testDir = path.join(tmpDir, 'with-source');
    const subDir = path.join(testDir, 'mylib');
    await fs.promises.mkdir(subDir, { recursive: true });
    await fs.promises.writeFile(path.join(subDir, 'index.ts'), 'export const x = 1;');
    await withTempConfig('with-source-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns!.some((p) => p.includes('mylib'))).toBe(true);
    });
  });

  it('detects source files in nested src subdirectory', async () => {
    const testDir = path.join(tmpDir, 'with-nested-src');
    const srcDir = path.join(testDir, 'app', 'src');
    await fs.promises.mkdir(srcDir, { recursive: true });
    await fs.promises.writeFile(path.join(srcDir, 'main.ts'), 'console.log("hi");');
    await withTempConfig('nested-src-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns!.some((p) => p.includes('app/src/'))).toBe(true);
    });
  });

  it('skips hidden and node_modules directories during source detection', async () => {
    const testDir = path.join(tmpDir, 'skip-dirs');
    await fs.promises.mkdir(path.join(testDir, '.hidden'), { recursive: true });
    await fs.promises.mkdir(path.join(testDir, 'node_modules'), { recursive: true });
    await fs.promises.writeFile(path.join(testDir, '.hidden', 'test.ts'), 'const x = 1;');
    await fs.promises.writeFile(path.join(testDir, 'node_modules', 'test.ts'), 'const x = 1;');
    await withTempConfig('skip-dirs-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns!.every((p) => !p.includes('.hidden') && !p.includes('node_modules'))).toBe(true);
    });
  });

  it('skips dirs with only non-source files (containsSourceFiles returns false)', async () => {
    const testDir = path.join(tmpDir, 'no-source-files');
    const dataDir = path.join(testDir, 'data');
    await fs.promises.mkdir(dataDir, { recursive: true });
    await fs.promises.writeFile(path.join(dataDir, 'readme.txt'), 'not a source file');
    await fs.promises.writeFile(path.join(dataDir, 'config.yml'), 'key: value');
    await withTempConfig('no-source-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns!.every((p) => !p.includes('data/'))).toBe(true);
    });
  });

  it('detects source files one level deep in subdirectory', async () => {
    const testDir = path.join(tmpDir, 'deep-source');
    const libDir = path.join(testDir, 'lib');
    const innerDir = path.join(libDir, 'inner');
    await fs.promises.mkdir(innerDir, { recursive: true });
    await fs.promises.writeFile(path.join(innerDir, 'utils.js'), 'module.exports = {};');
    await withTempConfig('deep-source-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns!.some((p) => p.includes('lib'))).toBe(true);
    });
  });

  it('handles mixed ESM+CJS content by checking package.json type', async () => {
    await withTempConfig(
      'mixed-module.js',
      ['// Legacy: module.exports = config;', 'export default { verbose: true };'].join('\n'),
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      }
    );
  });

  it('skips non-directory entries during source detection', async () => {
    const testDir = path.join(tmpDir, 'files-only');
    await fs.promises.mkdir(testDir, { recursive: true });
    await fs.promises.writeFile(path.join(testDir, 'standalone.ts'), 'const x = 1;');
    await fs.promises.writeFile(path.join(testDir, 'other.txt'), 'text');
    await withTempConfig('files-only-config.json', { rootDir: testDir }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.sourcePatterns).toBeDefined();
    });
  });
});
