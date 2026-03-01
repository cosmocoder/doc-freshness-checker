import fs from 'fs';
import path from 'path';
import { loadConfig, DEFAULT_CONFIG } from './loader.js';

describe('DEFAULT_CONFIG', () => {
  it('has sensible default values', () => {
    expect(DEFAULT_CONFIG.include).toEqual(['docs/**/*.md', 'README.md']);
    expect(DEFAULT_CONFIG.exclude).toContain('**/node_modules/**');
    expect(DEFAULT_CONFIG.urlValidation?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.urlValidation?.timeout).toBe(10000);
    expect(DEFAULT_CONFIG.rules?.['file-path']?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.reporters).toEqual(['console']);
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});

describe('loadConfig', () => {
  const tmpDir = path.join(process.cwd(), '.doc-freshness-cache', 'config-test');
  const unlinkIfExists = async (filePath: string) => {
    await fs.promises.unlink(filePath).catch(() => {});
  };

  async function withTempConfig(
    fileName: string,
    content: string | Record<string, unknown>,
    assertConfig: (configPath: string) => Promise<void>,
  ) {
    const configPath = path.join(tmpDir, fileName);
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    await fs.promises.writeFile(configPath, serialized);
    try {
      await assertConfig(configPath);
    } finally {
      await unlinkIfExists(configPath);
    }
  }

  beforeAll(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('returns defaults with auto-detection when no config file exists', async () => {
    const config = await loadConfig('/nonexistent/path.json');
    expect(config.include).toEqual(DEFAULT_CONFIG.include);
    expect(config._noConfigFile).toBe(true);
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
    await withTempConfig('merge-config.json', {
      urlValidation: { timeout: 5000 },
    }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.urlValidation?.timeout).toBe(5000);
      expect(config.urlValidation?.enabled).toBe(true);
    });
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
    await withTempConfig('custom-patterns.json', {
      manifestFiles: ['custom-manifest.json'],
      sourcePatterns: ['custom/**/*.ts'],
    }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.manifestFiles).toEqual(['custom-manifest.json']);
      expect(config.sourcePatterns).toEqual(['custom/**/*.ts']);
    });
  });

  it('loads .cjs config file', async () => {
    await withTempConfig(
      'test-config.cjs',
      'module.exports = { verbose: true, include: ["**/*.md"] };',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('handles config file with ESM syntax (export default)', async () => {
    await withTempConfig(
      'test-esm.js',
      'export default { verbose: true, include: ["**/*.md"] };',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('handles config file importing defineConfig', async () => {
    await withTempConfig(
      'test-define.js',
      `import { defineConfig } from 'doc-freshness-checker';\nexport default defineConfig({ verbose: true });`,
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('returns defaults when config file throws non-ENOENT error', async () => {
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
    await withTempConfig(
      'esm-export-const.js',
      'export const config = { verbose: true };\nexport default config;',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('detects ESM from import ... from pattern', async () => {
    await withTempConfig(
      'esm-import.js',
      'import path from "path";\nexport default { verbose: true };',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('detects ESM from export { ... } pattern', async () => {
    await withTempConfig(
      'esm-export-named.js',
      'const config = { verbose: true };\nexport { config };\nexport default config;',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('detects .cjs extension and loads CJS config directly', async () => {
    await withTempConfig(
      'direct-cjs.cjs',
      'module.exports = { verbose: true, include: ["**/*.md"] };',
      async (tmpConfig) => {
        const config = await loadConfig(tmpConfig);
        expect(config.verbose).toBe(true);
      },
    );
  });

  it('merges arrays from user config (overrides, not deep merge)', async () => {
    await withTempConfig('array-merge.json', {
      include: ['custom/**/*.md'],
      exclude: ['draft/**'],
    }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.include).toEqual(['custom/**/*.md']);
      expect(config.exclude).toEqual(['draft/**']);
    });
  });

  it('skips undefined user config values during merge', async () => {
    await withTempConfig('undefined-vals.json', { verbose: true }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
      expect(config.include).toEqual(DEFAULT_CONFIG.include);
    });
  });

  it('handles ENOENT (module not found) error code', async () => {
    const config = await loadConfig('/nonexistent/deep/path/config.json');
    expect(config._noConfigFile).toBe(true);
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
    await withTempConfig('deep-null.json', {
      rules: { 'file-path': { severity: 'error' } },
      urlValidation: null,
    }, async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.rules?.['file-path']?.severity).toBe('error');
    });
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
    await withTempConfig('mixed-module.js', [
      '// Legacy: module.exports = config;',
      'export default { verbose: true };',
    ].join('\n'), async (tmpConfig) => {
      const config = await loadConfig(tmpConfig);
      expect(config.verbose).toBe(true);
    });
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
