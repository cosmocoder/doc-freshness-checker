import fs from 'fs';
import path from 'path';
import { DependencyValidator } from './dependencyValidator.js';
import type { DocFreshnessConfig } from '../types.js';
import { makeDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';

function makeRef(value: string) {
  return makeBaseRef('dependency', value, { ecosystem: 'npm' });
}

const doc = makeDoc();
const tmpBase = path.join(process.cwd(), '.doc-freshness-cache', 'dep-test');

async function writeManifestAndValidate(
  dirName: string,
  fileName: string,
  content: string,
  pkgNames: string[],
): Promise<boolean[]> {
  const dir = path.join(tmpBase, dirName);
  const filePath = path.join(dir, fileName);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, content);

  const validator = new DependencyValidator();
  const config: DocFreshnessConfig = {
    rootDir: process.cwd(),
    manifestFiles: [path.relative(process.cwd(), filePath)],
  };
  const results = await validator.validateBatch(pkgNames.map(makeRef), doc, config);
  return results.map((r) => r.valid);
}

describe('DependencyValidator', () => {
  afterAll(async () => {
    await fs.promises.rm(tmpBase, { recursive: true, force: true }).catch(() => {});
  });

  it('validates dependencies found in package.json', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('vitest')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('marks unknown dependencies as invalid with default severity', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('nonexistent-pkg-xyz')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('info');
    expect(results[0].message).toContain('nonexistent-pkg-xyz');
  });

  it('respects custom severity from config', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(), manifestFiles: ['package.json'],
      rules: { dependency: { severity: 'error' } },
    };
    const results = await validator.validateBatch([makeRef('nonexistent-pkg')], doc, config);
    expect(results[0].severity).toBe('error');
  });

  it('handles missing manifest files gracefully', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['nonexistent.json'] };
    const results = await validator.validateBatch([makeRef('anything')], doc, config);
    expect(results[0].valid).toBe(false);
  });

  it('uses default manifestFiles when not specified', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd() };
    const results = await validator.validateBatch([makeRef('vitest')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  describe('manifest format parsing', () => {
    async function writeAndValidate(fileName: string, content: string, pkgNames: string[]): Promise<boolean[]> {
      const dirName = fileName.replace(/\./g, '-');
      return writeManifestAndValidate(dirName, fileName, content, pkgNames);
    }

    it('parses requirements.txt', async () => {
      const results = await writeAndValidate(
        'requirements.txt',
        'flask>=2.0\nrequests\n# comment\ndjango==4.0',
        ['flask', 'requests', 'django'],
      );
      expect(results).toEqual([true, true, true]);
    });

    it('parses pyproject.toml', async () => {
      const results = await writeAndValidate(
        'pyproject.toml',
        '[project.dependencies]\n"fastapi>=0.100"\n"uvicorn"',
        ['fastapi', 'uvicorn'],
      );
      expect(results).toEqual([true, true]);
    });

    it('parses go.mod', async () => {
      const results = await writeAndValidate(
        'go.mod',
        'module example.com/app\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n\tgolang.org/x/text v0.14.0\n)',
        ['github.com/gin-gonic/gin', 'golang.org/x/text'],
      );
      expect(results).toEqual([true, true]);
    });

    it('parses Cargo.toml', async () => {
      const results = await writeAndValidate(
        'Cargo.toml',
        '[dependencies]\nserde = "1.0"\ntokio = "1.28"',
        ['serde', 'tokio'],
      );
      expect(results).toEqual([true, true]);
    });

    it('parses pom.xml', async () => {
      const results = await writeAndValidate(
        'pom.xml',
        '<project><dependencies><dependency><artifactId>spring-boot</artifactId></dependency></dependencies></project>',
        ['spring-boot'],
      );
      expect(results).toEqual([true]);
    });
  });

  it('is case-insensitive for dependency names', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('Vitest'), makeRef('VITEST')], doc, config);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  describe('manifest edge cases', () => {
    async function writeAndValidate(fileName: string, content: string, pkgNames: string[]): Promise<boolean[]> {
      const dirName = `edge-${fileName.replace(/\./g, '-')}`;
      return writeManifestAndValidate(dirName, fileName, content, pkgNames);
    }

    it('handles go.mod without require block', async () => {
      const results = await writeAndValidate(
        'go.mod', 'module example.com/app\n\ngo 1.22\n', ['example.com/app'],
      );
      expect(results).toEqual([false]);
    });

    it('handles pyproject.toml without project.dependencies section', async () => {
      const results = await writeAndValidate(
        'pyproject.toml', '[project]\nname = "myapp"\nversion = "1.0"\n', ['myapp'],
      );
      expect(results).toEqual([false]);
    });

    it('handles Cargo.toml without dependencies section', async () => {
      const results = await writeAndValidate(
        'Cargo.toml', '[package]\nname = "myapp"\nversion = "0.1.0"\n', ['myapp'],
      );
      expect(results).toEqual([false]);
    });

    it('handles unknown manifest format gracefully', async () => {
      const results = await writeAndValidate(
        'build.gradle', 'implementation "org.something:artifact:1.0"\n', ['org.something'],
      );
      expect(results).toEqual([false]);
    });

    it('handles requirements.txt with blank lines and comments only', async () => {
      const results = await writeAndValidate(
        'requirements.txt', '# this is a comment\n\n# another comment\n', ['flask'],
      );
      expect(results).toEqual([false]);
    });

    it('handles pom.xml with no artifactId', async () => {
      const results = await writeAndValidate(
        'pom.xml', '<project><groupId>com.example</groupId></project>', ['anything'],
      );
      expect(results).toEqual([false]);
    });

    it('parses package.json with peerDependencies and optionalDependencies', async () => {
      const results = await writeAndValidate(
        'package.json',
        JSON.stringify({
          dependencies: { 'dep-a': '1.0' },
          devDependencies: { 'dev-b': '2.0' },
          peerDependencies: { 'peer-c': '>=3.0' },
          optionalDependencies: { 'opt-d': '4.0' },
        }),
        ['dep-a', 'dev-b', 'peer-c', 'opt-d'],
      );
      expect(results).toEqual([true, true, true, true]);
    });

    it('parses package.json with only dependencies (no devDependencies)', async () => {
      const results = await writeAndValidate(
        'package.json',
        JSON.stringify({ dependencies: { 'only-dep': '1.0' } }),
        ['only-dep'],
      );
      expect(results).toEqual([true]);
    });

    it('parses requirements.txt with pip editable installs (non-matching lines)', async () => {
      const results = await writeAndValidate(
        'requirements.txt',
        '-e git+https://github.com/org/repo.git#egg=mypackage\nflask>=2.0\n-r other-requirements.txt',
        ['flask'],
      );
      expect(results).toEqual([true]);
    });
  });

  it('uses process.cwd when rootDir is not specified', async () => {
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = { manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('vitest')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('reloads dependencies when manifest config changes on the same instance', async () => {
    const validator = new DependencyValidator();
    const dirA = path.join(tmpBase, 'reload-a');
    const dirB = path.join(tmpBase, 'reload-b');
    await fs.promises.mkdir(dirA, { recursive: true });
    await fs.promises.mkdir(dirB, { recursive: true });

    const manifestA = path.join(dirA, 'package.json');
    const manifestB = path.join(dirB, 'package.json');
    await fs.promises.writeFile(manifestA, JSON.stringify({ dependencies: { 'pkg-a': '1.0.0' } }));
    await fs.promises.writeFile(manifestB, JSON.stringify({ dependencies: { 'pkg-b': '1.0.0' } }));

    const configA: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), manifestA)],
    };
    const configB: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), manifestB)],
    };

    const first = await validator.validateBatch([makeRef('pkg-a')], doc, configA);
    expect(first[0].valid).toBe(true);

    const second = await validator.validateBatch([makeRef('pkg-b')], doc, configB);
    expect(second[0].valid).toBe(true);
  });
});
