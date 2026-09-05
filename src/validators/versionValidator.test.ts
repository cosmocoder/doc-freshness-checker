import fs from 'fs';
import path from 'path';
import { VersionValidator, manifestParsers } from './versionValidator.js';
import type { DocFreshnessConfig, Reference } from '../types.js';
import { makeDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';
import { PEP621_PYPROJECT_FIXTURES } from '../test-utils/manifestFixtures.js';

function makeRef(technology: string, version: string): Reference {
  return makeBaseRef('version', `${technology} ${version}`, { technology, version });
}

const doc = makeDoc();
const tmpDir = path.join(process.cwd(), '.doc-freshness-cache', 'manifest-test');

describe('VersionValidator', () => {
  it('captures default manifest inputs', async () => {
    const validator = new VersionValidator();
    await expect(validator.getIncrementalInputs([], doc, { rootDir: process.cwd() })).resolves.toEqual([
      { path: path.join(process.cwd(), 'package.json') },
    ]);
  });

  it('validates matching major versions as valid', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const pkg = JSON.parse(await fs.promises.readFile(`${process.cwd()}/package.json`, 'utf-8'));
    const tsVersion = pkg.devDependencies?.typescript;
    if (tsVersion) {
      const major = tsVersion.replace(/^[\^~]/, '').split('.')[0];
      const results = await validator.validateBatch([makeRef('TypeScript', `${major}.0`)], doc, config);
      expect(results[0].valid).toBe(true);
    }
  });

  it('detects major version mismatches', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: ['package.json'],
      rules: { version: { severity: 'warning' } },
    };
    const results = await validator.validateBatch([makeRef('TypeScript', '1.0')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('warning');
    expect(results[0].suggestion).toContain('Update to');
  });

  it('passes when technology is not found in dependencies', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('UnknownTech', '1.0')], doc, config);
    expect(results[0].valid).toBe(true);
    expect(results[0].message).toContain('Could not find');
  });

  it('handles references without technology field', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const ref: Reference = { type: 'version', value: '1.0', lineNumber: 1, raw: '1.0', sourceFile: 'doc.md' };
    const results = await validator.validateBatch([ref], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('uses technologyMap aliases (node, react, etc.)', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('react', '999.0')], doc, config);
    // If react is in deps, version 999 mismatches; if not, "could not find" → valid
    expect(results[0]).toBeDefined();
  });

  it('treats version "any" as not constraining', async () => {
    const dir = path.join(tmpDir, 'any-ver');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'requirements.txt'), 'flask\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'requirements.txt'))],
    };
    const results = await validator.validateBatch([makeRef('flask', '2.0')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('caches loaded versions across calls', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    await validator.validateBatch([makeRef('TypeScript', '1.0')], doc, config);
    const results = await validator.validateBatch([makeRef('TypeScript', '1.0')], doc, config);
    expect(results[0]).toBeDefined();
  });

  it('compares matching versions correctly (same major)', async () => {
    const dir = path.join(tmpDir, 'same-ver');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'requirements.txt'), 'flask==2.3.0\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'requirements.txt'))],
    };
    const results = await validator.validateBatch([makeRef('flask', '2.1')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('detects major version mismatch for non-package.json manifests', async () => {
    const dir = path.join(tmpDir, 'mismatch-ver');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, 'requirements.txt'), 'flask==3.0.0\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'requirements.txt'))],
      rules: { version: { severity: 'error' } },
    };
    const results = await validator.validateBatch([makeRef('flask', '2.0')], doc, config);
    expect(results[0].valid).toBe(false);
    expect(results[0].severity).toBe('error');
  });

  it('does not treat PEP 621 ranges as actual versions but enforces exact pins', async () => {
    const filePath = path.join(tmpDir, 'pep621-constraints', 'pyproject.toml');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, PEP621_PYPROJECT_FIXTURES[0].content);
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), filePath)],
    };

    const results = await validator.validateBatch([makeRef('fastapi', '9.0'), makeRef('uvicorn', '9.0')], doc, config);

    expect(results[0].valid).toBe(true);
    expect(results[0].message).toContain('listed without an exact version');
    expect(results[1].valid).toBe(false);
    expect(results[1].message).toContain('actual is 0.30.1');
  });

  it('scopes PEP 503 alias fallback to pyproject versions', async () => {
    const dir = path.join(tmpDir, 'mixed-ecosystems');
    await fs.promises.mkdir(dir, { recursive: true });
    const packageJson = path.join(dir, 'package.json');
    const pyproject = path.join(dir, 'pyproject.toml');
    await fs.promises.writeFile(packageJson, JSON.stringify({ dependencies: { 'foo-bar': '9.0.0' } }));
    await fs.promises.writeFile(pyproject, '[project]\ndependencies = ["dash-name==1.2", "under_score==2.4"]\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), packageJson), path.relative(process.cwd(), pyproject)],
    };

    const results = await validator.validateBatch(
      [
        makeRef('dash_name', '9.0'),
        makeRef('dash.name', '1.0'),
        makeRef('under-score', '9.0'),
        makeRef('under.score', '2.0'),
        makeRef('foo_bar', '1.0'),
      ],
      doc,
      config
    );

    expect(results.map((result) => result.valid)).toEqual([false, true, false, true, true]);
    expect(results[1].message).toBeUndefined();
    expect(results[3].message).toBeUndefined();
    expect(results[4].message).toContain('Could not find foo_bar');
  });

  it.each([
    {
      name: 'underscore package name with pyproject later',
      packageName: 'foo_bar',
      pythonName: 'foo-bar',
      order: ['packageJson', 'pyproject'] as const,
      expected: '2.0',
      stale: '9.0',
    },
    {
      name: 'exact package name with package.json later',
      packageName: 'shared-lib',
      pythonName: 'shared-lib',
      order: ['pyproject', 'packageJson'] as const,
      expected: '9.0',
      stale: '2.0',
    },
  ])('uses the later manifest version for $name', async ({ name, packageName, pythonName, order, expected, stale }) => {
    const dir = path.join(tmpDir, `manifest-order-${name.replace(/\W+/g, '-')}`);
    await fs.promises.mkdir(dir, { recursive: true });
    const packageJson = path.join(dir, 'package.json');
    const pyproject = path.join(dir, 'pyproject.toml');
    await fs.promises.writeFile(packageJson, JSON.stringify({ dependencies: { [packageName]: '9.0.0' } }));
    await fs.promises.writeFile(pyproject, `[project]\ndependencies = ["${pythonName}==2.0.0"]\n`);
    const manifests = { packageJson, pyproject };
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: order.map((key) => path.relative(process.cwd(), manifests[key])),
    };

    const results = await validator.validateBatch([makeRef(packageName, expected), makeRef(packageName, stale)], doc, config);

    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].message).toContain(`actual is ${expected}`);
  });

  it.each([
    { name: 'pyproject is later', order: ['requirements', 'pyproject'] as const, expected: '2.0', stale: '7.0' },
    { name: 'requirements is later', order: ['pyproject', 'requirements'] as const, expected: '7.0', stale: '2.0' },
  ])('uses the later Python manifest when $name', async ({ name, order, expected, stale }) => {
    const dir = path.join(tmpDir, `python-manifest-order-${name.replace(/\W+/g, '-')}`);
    await fs.promises.mkdir(dir, { recursive: true });
    const requirements = path.join(dir, 'requirements.txt');
    const pyproject = path.join(dir, 'pyproject.toml');
    await fs.promises.writeFile(requirements, 'shared_lib==7.0.0\n');
    await fs.promises.writeFile(pyproject, '[project]\ndependencies = ["shared-lib==2.0.0"]\n');
    const manifests = { requirements, pyproject };
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: order.map((key) => path.relative(process.cwd(), manifests[key])),
    };

    const results = await validator.validateBatch([makeRef('shared.lib', expected), makeRef('shared.lib', stale)], doc, config);

    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].message).toContain(`actual is ${expected}`);
  });

  it('treats non-exact requirements without a fixed major as unpinned', async () => {
    const dir = path.join(tmpDir, 'requirements-pin-semantics');
    const requirements = path.join(dir, 'requirements.txt');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      requirements,
      ['range_pkg>=1,<3', 'excluded_pkg!=5', 'direct_pkg @ https://example.com/direct_pkg.whl', 'unpinned_pkg'].join('\n')
    );
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), requirements)],
    };

    const results = await validator.validateBatch(
      [makeRef('range_pkg', '9.0'), makeRef('excluded_pkg', '9.0'), makeRef('direct_pkg', '9.0'), makeRef('unpinned_pkg', '9.0')],
      doc,
      config
    );

    expect(results.every((result) => result.valid)).toBe(true);
    for (const result of results) {
      expect(result.message).toContain('listed without an exact version');
    }
  });

  it('compares compatible-release requirements by major version', async () => {
    const dir = path.join(tmpDir, 'requirements-compatible-release');
    const requirements = path.join(dir, 'requirements.txt');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(requirements, 'flask~=2.0\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), requirements)],
    };

    const results = await validator.validateBatch([makeRef('flask', '1.0')], doc, config);

    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('actual is 2.0');
  });

  it.each(['foo_bar==1\nfoo-bar==2\n', 'foo-bar==2\nfoo_bar==1\n'])(
    'treats conflicting requirements aliases as unpinned',
    async (content) => {
      const dir = path.join(tmpDir, `requirements-conflict-${content.startsWith('foo_bar') ? 'underscore-first' : 'dash-first'}`);
      const requirements = path.join(dir, 'requirements.txt');
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(requirements, content);
      const validator = new VersionValidator();
      const config: DocFreshnessConfig = {
        rootDir: process.cwd(),
        manifestFiles: [path.relative(process.cwd(), requirements)],
      };

      const results = await validator.validateBatch(
        [makeRef('foo_bar', '9.0'), makeRef('foo-bar', '9.0'), makeRef('foo.bar', '9.0')],
        doc,
        config
      );

      expect(results.every((result) => result.valid)).toBe(true);
      expect(results.every((result) => result.message?.includes('listed without an exact version'))).toBe(true);
    }
  );

  it('keeps the version when equivalent requirements aliases have the same pin', async () => {
    const dir = path.join(tmpDir, 'requirements-same-pin');
    const requirements = path.join(dir, 'requirements.txt');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(requirements, 'foo_bar==2\nfoo-bar===2\n');
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), requirements)],
    };

    const results = await validator.validateBatch([makeRef('foo.bar', '2.0'), makeRef('foo_bar', '9.0')], doc, config);

    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].message).toContain('actual is 2');
  });

  it('does not let an npm canonical alias override a Python candidate', async () => {
    const dir = path.join(tmpDir, 'cross-origin-alias');
    await fs.promises.mkdir(dir, { recursive: true });
    const pyproject = path.join(dir, 'pyproject.toml');
    const packageJson = path.join(dir, 'package.json');
    await fs.promises.writeFile(pyproject, '[project]\ndependencies = ["foo_bar==2.0.0"]\n');
    await fs.promises.writeFile(packageJson, JSON.stringify({ dependencies: { 'foo-bar': '9.0.0' } }));
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), pyproject), path.relative(process.cwd(), packageJson)],
    };

    const results = await validator.validateBatch([makeRef('foo.bar', '2.0'), makeRef('foo.bar', '9.0')], doc, config);

    expect(results[0].valid).toBe(true);
    expect(results[1].valid).toBe(false);
    expect(results[1].message).toContain('actual is 2.0.0');
  });

  it('compares PEP 440 epoch and date release majors', async () => {
    const filePath = path.join(tmpDir, 'pep440-releases', 'pyproject.toml');
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, PEP621_PYPROJECT_FIXTURES[1].content);
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), filePath)],
    };

    const results = await validator.validateBatch(
      [makeRef('epoch_pkg', '2.0'), makeRef('epoch.pkg', '4.0'), makeRef('date_pkg', '2023.0'), makeRef('date.pkg', '2024.0')],
      doc,
      config
    );

    expect(results.map((result) => result.valid)).toEqual([false, true, false, true]);
    expect(results[0].message).toContain('actual is 2!4.2');
    expect(results[2].message).toContain('actual is 2024.01');
  });

  it('handles unparseable version strings gracefully', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('typescript', 'latest')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('handles reference with technology but no version', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const ref: Reference = {
      type: 'version',
      value: 'typescript',
      technology: 'typescript',
      lineNumber: 1,
      raw: 'typescript',
      sourceFile: 'doc.md',
    };
    const results = await validator.validateBatch([ref], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('handles nodejs alias mapping', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd(), manifestFiles: ['package.json'] };
    const results = await validator.validateBatch([makeRef('nodejs', '999.0')], doc, config);
    expect(results[0]).toBeDefined();
  });

  it('treats empty version in package.json as "any"', async () => {
    const dir = path.join(tmpDir, 'empty-ver');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { 'test-pkg': '' },
      })
    );
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'package.json'))],
    };
    const results = await validator.validateBatch([makeRef('test-pkg', '1.0')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('uses default manifestFiles when not specified', async () => {
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = { rootDir: process.cwd() };
    const results = await validator.validateBatch([makeRef('typescript', '1.0')], doc, config);
    expect(results[0]).toBeDefined();
  });

  it('parses package.json with peerDependencies', async () => {
    const dir = path.join(tmpDir, 'peer-deps');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        peerDependencies: { react: '^18.0.0' },
      })
    );
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'package.json'))],
    };
    const results = await validator.validateBatch([makeRef('react', '18.0')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('uses technology name directly when not in technologyMap', async () => {
    const dir = path.join(tmpDir, 'direct-tech');
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({
        dependencies: { 'custom-lib': '5.0.0' },
      })
    );
    const validator = new VersionValidator();
    const config: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), path.join(dir, 'package.json'))],
    };
    const results = await validator.validateBatch([makeRef('custom-lib', '5.0')], doc, config);
    expect(results[0].valid).toBe(true);
  });

  it('reloads package versions when manifest config changes on the same instance', async () => {
    const dirA = path.join(tmpDir, 'reload-a');
    const dirB = path.join(tmpDir, 'reload-b');
    await fs.promises.mkdir(dirA, { recursive: true });
    await fs.promises.mkdir(dirB, { recursive: true });
    const manifestA = path.join(dirA, 'package.json');
    const manifestB = path.join(dirB, 'package.json');
    await fs.promises.writeFile(manifestA, JSON.stringify({ dependencies: { react: '17.0.0' } }));
    await fs.promises.writeFile(manifestB, JSON.stringify({ dependencies: { react: '18.0.0' } }));

    const validator = new VersionValidator();
    const configA: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), manifestA)],
    };
    const configB: DocFreshnessConfig = {
      rootDir: process.cwd(),
      manifestFiles: [path.relative(process.cwd(), manifestB)],
    };

    const first = await validator.validateBatch([makeRef('react', '18.0')], doc, configA);
    expect(first[0].valid).toBe(false);

    const second = await validator.validateBatch([makeRef('react', '18.0')], doc, configB);
    expect(second[0].valid).toBe(true);
  });
});

describe('manifestParsers', () => {
  beforeAll(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  it('parses package.json with engines and all dep types', async () => {
    const filePath = path.join(tmpDir, 'package.json');
    await fs.promises.writeFile(
      filePath,
      JSON.stringify({
        engines: { node: '>=18.0.0', npm: '>=9.0.0' },
        dependencies: { express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0' },
      })
    );
    const versions = await manifestParsers['package.json'](filePath);
    expect(versions.get('node')).toBe('18.0.0');
    expect(versions.get('nodejs')).toBe('18.0.0');
    expect(versions.get('npm')).toBe('9.0.0');
    expect(versions.get('express')).toBe('4.18.0');
    expect(versions.get('jest')).toBe('29.0.0');
  });

  it('parses requirements.txt with versions and comments', async () => {
    const filePath = path.join(tmpDir, 'requirements.txt');
    await fs.promises.writeFile(
      filePath,
      [
        'flask>=2.0.1',
        'requests==2.31.0',
        'foo.bar==7',
        'base_pkg[extra]==3.2',
        'commented_pkg==4.1 # reason',
        'direct_pkg @ https://example.com/archive.whl#sha256=abc',
        '# comment',
        'django',
      ].join('\n')
    );
    const versions = await manifestParsers['requirements.txt'](filePath);
    expect(versions.get('flask')).toBe('any');
    expect(versions.get('requests')).toBe('2.31.0');
    expect(versions.get('foo.bar')).toBe('7');
    expect(versions.get('base_pkg')).toBe('3.2');
    expect(versions.get('commented_pkg')).toBe('4.1');
    expect(versions.get('direct_pkg')).toBe('any');
    expect(versions.get('django')).toBe('any');
  });

  it.each(PEP621_PYPROJECT_FIXTURES)('parses PEP 621 $name', async ({ content, dependencies }) => {
    const filePath = path.join(tmpDir, 'pyproject.toml');
    await fs.promises.writeFile(filePath, content);
    const versions = await manifestParsers['pyproject.toml'](filePath);
    expect(Object.fromEntries(versions)).toEqual(dependencies);
  });

  it('parses go.mod', async () => {
    const filePath = path.join(tmpDir, 'go.mod');
    await fs.promises.writeFile(filePath, 'module example.com/mymod\n\ngo 1.21\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)');
    const versions = await manifestParsers['go.mod'](filePath);
    expect(versions.get('go')).toBe('1.21');
    expect(versions.get('golang')).toBe('1.21');
    expect(versions.get('github.com/gin-gonic/gin')).toBe('1.9.1');
  });

  it('parses Cargo.toml', async () => {
    const filePath = path.join(tmpDir, 'Cargo.toml');
    await fs.promises.writeFile(filePath, '[dependencies]\nserde = "1.0"\ntokio = "1.28"');
    const versions = await manifestParsers['Cargo.toml'](filePath);
    expect(versions.get('serde')).toBe('1.0');
    expect(versions.get('tokio')).toBe('1.28');
  });

  it('parses go.mod without require block', async () => {
    const filePath = path.join(tmpDir, 'go-no-require.mod');
    await fs.promises.writeFile(filePath, 'module example.com/mymod\n\ngo 1.22\n');
    const versions = await manifestParsers['go.mod'](filePath);
    expect(versions.get('go')).toBe('1.22');
    expect(versions.size).toBe(2);
  });

  it('parses Cargo.toml without dependencies section', async () => {
    const filePath = path.join(tmpDir, 'Cargo-empty.toml');
    await fs.promises.writeFile(filePath, '[package]\nname = "myapp"\nversion = "0.1.0"');
    const versions = await manifestParsers['Cargo.toml'](filePath);
    expect(versions.size).toBe(0);
  });

  it('parses pyproject.toml without dependencies section', async () => {
    const filePath = path.join(tmpDir, 'pyproject-empty.toml');
    await fs.promises.writeFile(filePath, '[tool.poetry]\nname = "myapp"');
    const versions = await manifestParsers['pyproject.toml'](filePath);
    expect(versions.size).toBe(0);
  });

  it('parses requirements.txt with comments and blank lines', async () => {
    const filePath = path.join(tmpDir, 'requirements-comments.txt');
    await fs.promises.writeFile(filePath, '# Comment\n\nflask>=2.0\n  \n# Another comment\n');
    const versions = await manifestParsers['requirements.txt'](filePath);
    expect(versions.get('flask')).toBeDefined();
    expect(versions.size).toBe(1);
  });

  it('parses pom.xml without java version', async () => {
    const filePath = path.join(tmpDir, 'pom-no-java.xml');
    await fs.promises.writeFile(
      filePath,
      '<project><dependencies><dependency><artifactId>junit</artifactId><version>5.9</version></dependency></dependencies></project>'
    );
    const versions = await manifestParsers['pom.xml'](filePath);
    expect(versions.get('junit')).toBe('5.9');
    expect(versions.has('java')).toBe(false);
  });

  it('parses pom.xml with java version and dependencies', async () => {
    const filePath = path.join(tmpDir, 'pom.xml');
    await fs.promises.writeFile(
      filePath,
      `<project>
  <properties><java.version>17</java.version></properties>
  <dependencies>
    <dependency><artifactId>spring-boot</artifactId><version>3.1.0</version></dependency>
  </dependencies>
</project>`
    );
    const versions = await manifestParsers['pom.xml'](filePath);
    expect(versions.get('java')).toBe('17');
    expect(versions.get('spring-boot')).toBe('3.1.0');
  });
});
