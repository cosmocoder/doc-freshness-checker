import fs from 'fs';
import path from 'path';
import { DependencyValidator } from './dependencyValidator.js';
import { DependencyExtractor } from '../parsers/extractors/dependencyExtractor.js';
import type { DocFreshnessConfig } from '../types.js';
import { makeDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';
import { PEP621_PYPROJECT_FIXTURES } from '../test-utils/manifestFixtures.js';
import { GO_MOD_REQUIRE_FIXTURE } from '../test-utils/goModFixture.js';
import { CARGO_DEPENDENCY_FIXTURE } from '../test-utils/cargoFixture.js';

function makeRef(value: string) {
  return makeBaseRef('dependency', value, { ecosystem: 'npm' });
}

const doc = makeDoc();
const tmpBase = path.join(process.cwd(), '.doc-freshness-cache', 'dep-test');

async function writeManifestAndValidate(dirName: string, fileName: string, content: string, pkgNames: string[]): Promise<boolean[]> {
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

  it('captures configured manifest inputs', async () => {
    const validator = new DependencyValidator();
    await expect(validator.getIncrementalInputs([], doc, { rootDir: process.cwd(), manifestFiles: ['custom.json'] })).resolves.toEqual([
      { path: path.join(process.cwd(), 'custom.json') },
    ]);
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
      rootDir: process.cwd(),
      manifestFiles: ['package.json'],
      rules: { dependency: { severity: 'error' } },
    };
    const results = await validator.validateBatch([makeRef('nonexistent-pkg')], doc, config);
    expect(results[0].severity).toBe('error');
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
      const results = await writeAndValidate('requirements.txt', 'flask>=2.0\nrequests\n# comment\ndjango==4.0', [
        'flask',
        'requests',
        'django',
      ]);
      expect(results).toEqual([true, true, true]);
    });

    it('parses dotted requirements names and validates their Python aliases', async () => {
      const dir = path.join(tmpBase, 'requirements-dotted-name');
      const filePath = path.join(dir, 'requirements.txt');
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(filePath, 'foo.bar==7\n');
      const validator = new DependencyValidator();
      const config: DocFreshnessConfig = {
        rootDir: process.cwd(),
        manifestFiles: [path.relative(process.cwd(), filePath)],
      };
      const references = ['foo.bar', 'foo_bar', 'foo-bar'].map((value) => makeBaseRef('dependency', value, { ecosystem: 'pypi' }));

      const results = await validator.validateBatch(references, doc, config);

      expect(results.map((result) => result.valid)).toEqual([true, true, true]);
    });

    it('parses PEP 621 core and optional dependencies', async () => {
      const results = await writeAndValidate('pyproject.toml', PEP621_PYPROJECT_FIXTURES[0].content, ['fastapi', 'pytest']);
      expect(results).toEqual([true, true]);
    });

    it('parses go.mod', async () => {
      const results = await writeAndValidate('go.mod', GO_MOD_REQUIRE_FIXTURE, [
        'github.com/google/uuid',
        'github.com/google/go-cmp',
        'github.com/gin-gonic/gin',
        'golang.org/x/text',
        'example.com/commented',
      ]);
      expect(results).toEqual([true, true, true, true, false]);
    });

    it('parses Cargo.toml', async () => {
      const results = await writeAndValidate('Cargo.toml', CARGO_DEPENDENCY_FIXTURE, [
        'serde',
        'shared',
        'workspace-unresolved',
        'regex',
        'cc',
        'duplicate',
        'commented',
        'target-only',
      ]);
      expect(results).toEqual([true, true, true, true, true, true, false, false]);
    });

    it('parses pom.xml', async () => {
      const results = await writeAndValidate(
        'pom.xml',
        '<project><dependencies><dependency><artifactId>spring-boot</artifactId></dependency></dependencies></project>',
        ['spring-boot']
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

  it('validates extracted PyPI aliases without treating npm names as equivalent', async () => {
    const dir = path.join(tmpBase, 'mixed-ecosystems');
    await fs.promises.mkdir(dir, { recursive: true });
    const packageJson = path.join(dir, 'package.json');
    const pyproject = path.join(dir, 'pyproject.toml');
    await fs.promises.writeFile(packageJson, JSON.stringify({ dependencies: { foo_bar: '1.0.0', 'foo.bar': '1.0.0' } }));
    await fs.promises.writeFile(pyproject, '[project]\ndependencies = ["python-name==1.0"]\n');
    const validator = new DependencyValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), packageJson), path.relative(process.cwd(), pyproject)],
    };
    const content = 'Use `python_name`, `python.name`, `foo_bar`, and `foo.bar`';
    const integrationDoc = makeDoc({ content, lines: [content] });
    const references = new DependencyExtractor({ ecosystems: ['pypi'] }).extract(integrationDoc);
    integrationDoc.references = references;

    const results = await validator.validateBatch(references, integrationDoc, config);

    expect(references.map(({ value, ecosystem }) => ({ value, ecosystem }))).toEqual([
      { value: 'python_name', ecosystem: 'pypi' },
      { value: 'python.name', ecosystem: 'pypi' },
      { value: 'foo_bar', ecosystem: 'pypi' },
      { value: 'foo.bar', ecosystem: 'pypi' },
    ]);
    expect(results.map((result) => result.valid)).toEqual([true, true, false, false]);
  });

  describe('manifest edge cases', () => {
    async function writeAndValidate(fileName: string, content: string, pkgNames: string[]): Promise<boolean[]> {
      const dirName = `edge-${fileName.replace(/\./g, '-')}`;
      return writeManifestAndValidate(dirName, fileName, content, pkgNames);
    }

    it('handles go.mod without require block', async () => {
      const results = await writeAndValidate('go.mod', 'module example.com/app\n\ngo 1.22\n', ['example.com/app']);
      expect(results).toEqual([false]);
    });

    it('handles pyproject.toml without project.dependencies section', async () => {
      const results = await writeAndValidate('pyproject.toml', '[project]\nname = "myapp"\nversion = "1.0"\n', ['myapp']);
      expect(results).toEqual([false]);
    });

    it('handles Cargo.toml without dependencies section', async () => {
      const results = await writeAndValidate('Cargo.toml', '[package]\nname = "myapp"\nversion = "0.1.0"\n', ['myapp']);
      expect(results).toEqual([false]);
    });

    it('handles requirements.txt with blank lines and comments only', async () => {
      const results = await writeAndValidate('requirements.txt', '# this is a comment\n\n# another comment\n', ['flask']);
      expect(results).toEqual([false]);
    });

    it('handles pom.xml with no artifactId', async () => {
      const results = await writeAndValidate('pom.xml', '<project><groupId>com.example</groupId></project>', ['anything']);
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
        ['dep-a', 'dev-b', 'peer-c', 'opt-d']
      );
      expect(results).toEqual([true, true, true, true]);
    });

    it('parses package.json with only dependencies (no devDependencies)', async () => {
      const results = await writeAndValidate('package.json', JSON.stringify({ dependencies: { 'only-dep': '1.0' } }), ['only-dep']);
      expect(results).toEqual([true]);
    });

    it('parses requirements.txt with pip editable installs (non-matching lines)', async () => {
      const results = await writeAndValidate(
        'requirements.txt',
        '-e git+https://github.com/org/repo.git#egg=mypackage\nflask>=2.0\n-r other-requirements.txt',
        ['flask']
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
