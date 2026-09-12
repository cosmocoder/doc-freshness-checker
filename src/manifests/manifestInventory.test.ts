import fs from 'fs';
import os from 'os';
import path from 'path';
import { ManifestInventory } from './manifestInventory.js';
import { PEP621_PYPROJECT_FIXTURES } from '../test-utils/manifestFixtures.js';
import type { DocFreshnessConfig } from '../types.js';

async function withManifests(files: Record<string, string>, run: (rootDir: string) => Promise<void>): Promise<void> {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-manifests-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(rootDir, relativePath);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content, 'utf-8');
    }
    await run(rootDir);
  }
  finally {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  }
}

function candidate(version: string, sourceIndex = 0) {
  return { version, sourceIndex };
}

describe('ManifestInventory', () => {
  it('projects npm names and version precedence', async () => {
    await withManifests(
      {
        'package.json': JSON.stringify({
          engines: { node: '>=20.0.0', npm: '^11.0.0' },
          dependencies: { React: '18.2.0' },
          devDependencies: { TypeScript: '5.4.5' },
          peerDependencies: { react: '^17 || ^18', typescript: '>=4.7', peerOnly: '>=16', narrowPeer: '^4.0.0', node: '14.0.0' },
          optionalDependencies: { optionalOnly: '2.3.0' },
        }),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['package.json'] };
        const [dependencies, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);

        expect(dependencies).toEqual({
          all: new Set(['react', 'typescript', 'peeronly', 'narrowpeer', 'node', 'optionalonly']),
          python: new Set(),
        });
        expect(versions.all).toEqual(
          new Map([
            ['react', candidate('18.2.0')],
            ['typescript', candidate('5.4.5')],
            ['peeronly', candidate('any')],
            ['narrowpeer', candidate('4.0.0')],
            ['node', candidate('20.0.0')],
            ['optionalonly', candidate('2.3.0')],
            ['nodejs', candidate('20.0.0')],
            ['npm', candidate('11.0.0')],
          ])
        );
      }
    );
  });

  it('uses the shared Python parsers and keeps canonical candidates separate', async () => {
    await withManifests(
      {
        'requirements.txt':
          'Requests[security]==2.31\nfoo.bar~=7.1\nDjango>=4.2,<5\ncommented_pkg==4.1 # reason\ndirect_pkg @ https://example.com/archive.whl#sha256=abc\n-r other.txt\n',
        'pyproject.toml': '[project]\ndependencies = ["requests==2.32", "python_name==3.0"]\n',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['requirements.txt', 'pyproject.toml'] };
        const [dependencies, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);

        expect(dependencies.all).toEqual(new Set(['requests', 'foo.bar', 'django', 'commented_pkg', 'direct_pkg', 'python_name']));
        expect(dependencies.python).toEqual(new Set(['requests', 'foo-bar', 'django', 'commented-pkg', 'direct-pkg', 'python-name']));
        expect(versions.all.get('requests')).toEqual(candidate('2.32', 1));
        expect(versions.all.get('foo.bar')).toEqual(candidate('7.1'));
        expect(versions.all.get('django')).toEqual(candidate('any'));
        expect(versions.all.get('commented_pkg')).toEqual(candidate('4.1'));
        expect(versions.all.get('direct_pkg')).toEqual(candidate('any'));
        expect(versions.python.get('python-name')).toEqual(candidate('3.0', 1));
      }
    );
  });

  it.each(PEP621_PYPROJECT_FIXTURES.slice(2))('projects PEP 621 $name', async ({ content, dependencies }) => {
    await withManifests({ 'pyproject.toml': content }, async (rootDir) => {
      const versions = await new ManifestInventory().packageVersions({ rootDir, manifestFiles: ['pyproject.toml'] });
      expect(Object.fromEntries(Array.from(versions.all, ([name, value]) => [name, value.version]))).toEqual(dependencies);
    });
  });

  it('uses the shared Go and Cargo parsers and aggregates Cargo candidates', async () => {
    await withManifests(
      {
        'go.mod': 'module example.test/app\ngo 1.22\nrequire example.test/single v9.0.0\nrequire (\n example.test/block v1.2.3\n)\n',
        'root/Cargo.toml': '[workspace.dependencies]\nshared = "2.0"\n[dependencies]\nserde = "1.0"\n',
        'member/Cargo.toml': '[dependencies]\nshared = { workspace = true }\nserde = { path = "../serde" }\n',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['go.mod', 'root/Cargo.toml', 'member/Cargo.toml'] };
        const [dependencies, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);

        expect(dependencies.all).toEqual(new Set(['example.test/single', 'example.test/block', 'shared', 'serde']));
        expect(versions.all).toEqual(
          new Map([
            ['go', candidate('1.22')],
            ['golang', candidate('1.22')],
            ['example.test/single', candidate('9.0.0')],
            ['example.test/block', candidate('1.2.3')],
            ['shared', candidate('2.0', 2)],
            ['serde', candidate('1.0', 1)],
          ])
        );
      }
    );
  });

  it('projects Maven artifact and Java versions', async () => {
    await withManifests(
      {
        'pom.xml':
          '<project><artifactId>app</artifactId><java.version>21</java.version><dependency><artifactId>junit</artifactId><version>5.9</version></dependency></project>',
        'no-java/pom.xml': '<project><dependency><artifactId>junit</artifactId><version>5.9</version></dependency></project>',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['pom.xml'] };
        expect((await inventory.dependencyNames(config)).all).toEqual(new Set(['app', 'junit']));
        expect((await inventory.packageVersions(config)).all).toEqual(
          new Map([
            ['java', candidate('21')],
            ['junit', candidate('5.9')],
          ])
        );
        expect((await new ManifestInventory().packageVersions({ rootDir, manifestFiles: ['no-java/pom.xml'] })).all.has('java')).toBe(
          false
        );
      }
    );
  });

  it('shares built-in reads across concurrent projections', async () => {
    await withManifests({ 'package.json': JSON.stringify({ dependencies: { shared: '1.0.0' } }) }, async (rootDir) => {
      const readFile = vi.spyOn(fs.promises, 'readFile');
      try {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['package.json'] };
        const [dependencies, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);
        expect(dependencies.all.has('shared')).toBe(true);
        expect(versions.all.get('shared')).toEqual(candidate('1.0.0'));
        expect(readFile).toHaveBeenCalledOnce();
      }
      finally {
        readFile.mockRestore();
      }
    });
  });

  it('retries failed reads and projections after a same-key manifest is repaired', async () => {
    await withManifests({}, async (rootDir) => {
      const inventory = new ManifestInventory();
      const config = { rootDir, manifestFiles: ['package.json'] };
      const filePath = path.join(rootDir, 'package.json');

      await expect(inventory.dependencyNames(config)).rejects.toMatchObject({
        message: expect.stringContaining(`Failed to load manifest: ${filePath}: ENOENT`),
        cause: expect.objectContaining({ code: 'ENOENT' }),
      });
      await fs.promises.writeFile(filePath, '{', 'utf-8');
      await expect(inventory.packageVersions(config)).rejects.toThrow(`Failed to load manifest: ${filePath}`);
      await fs.promises.writeFile(filePath, JSON.stringify({ dependencies: { repaired: '3.0.0' } }), 'utf-8');

      expect((await inventory.dependencyNames(config)).all).toEqual(new Set(['repaired']));
      expect((await inventory.packageVersions(config)).all.get('repaired')).toEqual(candidate('3.0.0'));
    });
  });

  it('reads neither unknown formats nor an explicitly empty manifest list', async () => {
    const readFile = vi.spyOn(fs.promises, 'readFile');
    try {
      const inventory = new ManifestInventory();
      await expect(inventory.dependencyNames({ rootDir: '/unused', manifestFiles: ['unknown.lock'] })).resolves.toEqual({
        all: new Set(),
        python: new Set(),
      });
      await expect(inventory.packageVersions({ rootDir: '/unused', manifestFiles: [] })).resolves.toEqual({
        all: new Map(),
        python: new Map(),
      });
      expect(readFile).not.toHaveBeenCalled();
    }
    finally {
      readFile.mockRestore();
    }
  });

  it('resets cached projections when the resolved manifest configuration changes', async () => {
    await withManifests(
      {
        'a/package.json': JSON.stringify({ dependencies: { first: '1.0.0' } }),
        'b/package.json': JSON.stringify({ dependencies: { second: '2.0.0' } }),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const firstConfig: DocFreshnessConfig = { rootDir, manifestFiles: ['a/package.json'] };
        const first = await inventory.packageVersions(firstConfig);
        expect(await inventory.packageVersions(firstConfig)).toBe(first);
        expect((await inventory.packageVersions({ rootDir, manifestFiles: ['b/package.json'] })).all.has('second')).toBe(true);
        expect((await inventory.packageVersions(firstConfig)).all.has('first')).toBe(true);
      }
    );
  });
});
