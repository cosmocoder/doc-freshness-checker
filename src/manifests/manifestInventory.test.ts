import fs from 'fs';
import os from 'os';
import path from 'path';
import { ManifestInventory } from './manifestInventory.js';
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

describe('ManifestInventory', () => {
  it('keeps package dependency and version sections and collisions distinct', async () => {
    await withManifests(
      {
        'package.json': JSON.stringify({
          engines: { node: '>=18.0.0', npm: '^9.0.0' },
          dependencies: { Node: '^20.0.0', Shared: '1.0.0' },
          devDependencies: { shared: '2.0.0', DevOnly: '3.0.0' },
          peerDependencies: { PeerOnly: '4.0.0' },
          optionalDependencies: { OptionalOnly: '5.0.0' },
        }),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['package.json'] };
        const [names, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);
        expect(names).toEqual(new Set(['node', 'shared', 'devonly', 'peeronly', 'optionalonly']));
        expect(versions).toEqual(
          new Map([
            ['node', '20.0.0'],
            ['nodejs', '18.0.0'],
            ['npm', '9.0.0'],
            ['shared', '2.0.0'],
            ['devonly', '3.0.0'],
          ])
        );
      }
    );
  });

  it('preserves requirements names, options, extras, and raw remainder versions', async () => {
    await withManifests(
      { 'requirements.txt': '# comment\n-e git+https://repo\n-r other.txt\nRequests[security]==2.31\nplain\n' },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['requirements.txt'] };
        const names = await inventory.dependencyNames(config);
        const versions = await inventory.packageVersions(config);
        expect(names).toEqual(new Set(['-e', '-r', 'requests', 'plain']));
        expect(versions).toEqual(
          new Map([
            ['-e', ' git+https://repo'],
            ['-r', ' other.txt'],
            ['requests', '[security]==2.31'],
            ['plain', 'any'],
          ])
        );
      }
    );
  });

  it('preserves nonstandard pyproject parsing including phantom quoted whitespace', async () => {
    await withManifests(
      {
        'legacy/pyproject.toml': '[project.dependencies]\n"FastAPI>=0.100"\n"uvicorn"\n',
        'pep/pyproject.toml': '[project]\ndependencies = ["requests>=2"]\n',
      },
      async (rootDir) => {
        const legacy = new ManifestInventory();
        const legacyConfig = { rootDir, manifestFiles: ['legacy/pyproject.toml'] };
        expect(await legacy.dependencyNames(legacyConfig)).toEqual(new Set(['fastapi', '\n', 'uvicorn']));
        expect(await legacy.packageVersions(legacyConfig)).toEqual(
          new Map([
            ['fastapi', '0.100'],
            ['uvicorn', 'any'],
          ])
        );

        const pep = new ManifestInventory();
        const pepConfig = { rootDir, manifestFiles: ['pep/pyproject.toml'] };
        expect(await pep.dependencyNames(pepConfig)).toEqual(new Set());
        expect(await pep.packageVersions(pepConfig)).toEqual(new Map());
      }
    );
  });

  it('preserves go block, comment-token, directive, and single-line quirks', async () => {
    await withManifests(
      {
        'go.mod': [
          'module example.test/app',
          'go 1.22',
          'require example.test/single v9.0.0',
          'require (',
          '  Example.test/Upper v1.2.3',
          '  // indirect marker',
          ')',
        ].join('\n'),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['go.mod'] };
        expect(await inventory.dependencyNames(config)).toEqual(new Set(['example.test/upper', '//']));
        expect(await inventory.packageVersions(config)).toEqual(
          new Map([
            ['go', '1.22'],
            ['golang', '1.22'],
            ['Example.test/Upper', '1.2.3'],
            ['//', 'indirect'],
          ])
        );
      }
    );
  });

  it('preserves Cargo section, indentation, inline-table, and later-section quirks', async () => {
    await withManifests(
      {
        'Cargo.toml': [
          '[dependencies]',
          'serde = "1.0"',
          '  indented = "2.0"',
          'inline = { version = "3.0" }',
          '[dev-dependencies]',
          'dev = "4.0"',
          '[build-dependencies]',
          'build = "5.0"',
          '[workspace.dependencies]',
          'workspace = "6.0"',
        ].join('\n'),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['Cargo.toml'] };
        expect(await inventory.dependencyNames(config)).toEqual(new Set(['serde', 'inline']));
        expect(await inventory.packageVersions(config)).toEqual(
          new Map([
            ['serde', '1.0'],
            ['inline', '{ version = '],
          ])
        );
      }
    );
  });

  it('preserves pom dependency-name breadth and version association behavior', async () => {
    await withManifests(
      {
        'pom.xml': [
          '<project><artifactId>project-id</artifactId><java.version>21</java.version>',
          '<plugin><artifactId>plugin-id</artifactId></plugin>',
          '<dependency><artifactId>first</artifactId></dependency>',
          '<dependency><artifactId>second</artifactId><version>2.0</version></dependency>',
          '</project>',
        ].join(''),
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const config = { rootDir, manifestFiles: ['pom.xml'] };
        expect(await inventory.dependencyNames(config)).toEqual(new Set(['project-id', 'plugin-id', 'first', 'second']));
        expect(await inventory.packageVersions(config)).toEqual(
          new Map([
            ['java', '21'],
            ['first', '2.0'],
          ])
        );
      }
    );
  });

  it('shares successful and failed reads while keeping projections isolated', async () => {
    await withManifests(
      {
        'package.json': JSON.stringify({ dependencies: { validName: { unsupported: true } } }),
        'invalid/package.json': '{',
        'later/package.json': JSON.stringify({ dependencies: { later: '7.0.0' } }),
        'build.gradle': 'implementation "example:artifact:1.0"',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const readFile = vi.spyOn(fs.promises, 'readFile');
        try {
          const config = {
            rootDir,
            manifestFiles: [
              'package.json',
              'package.json',
              'build.gradle',
              'missing/package.json',
              'invalid/package.json',
              'later/package.json',
            ],
          };
          const [names, versions] = await Promise.all([inventory.dependencyNames(config), inventory.packageVersions(config)]);
          expect(names).toEqual(new Set(['validname', 'later']));
          expect(versions).toEqual(new Map([['later', '7.0.0']]));
          expect(readFile).toHaveBeenCalledTimes(5);
        }
        finally {
          readFile.mockRestore();
        }
      }
    );
  });

  it('preserves manifest order, config-key reloads, same-key staleness, and fallback semantics', async () => {
    await withManifests(
      {
        'package.json': JSON.stringify({ dependencies: { fallback: '1.0.0' } }),
        'a/package.json': JSON.stringify({ dependencies: { shared: '1.0.0' } }),
        'b/package.json': JSON.stringify({ dependencies: { shared: '2.0.0', later: '3.0.0' } }),
      },
      async (rootDir) => {
        expect(await new ManifestInventory().dependencyNames({ rootDir, manifestFiles: [] })).toEqual(new Set());
        expect(await new ManifestInventory().dependencyNames({ rootDir, manifestFiles: null })).toEqual(new Set(['fallback']));
        expect(await new ManifestInventory().dependencyNames({ rootDir })).toEqual(new Set(['fallback']));

        const inventory = new ManifestInventory();
        const configA: DocFreshnessConfig = { rootDir, manifestFiles: ['a/package.json'] };
        const first = await inventory.packageVersions(configA);
        await fs.promises.writeFile(path.join(rootDir, 'a/package.json'), JSON.stringify({ dependencies: { shared: '9.0.0' } }));
        expect(await inventory.packageVersions(configA)).toBe(first);
        expect(first.get('shared')).toBe('1.0.0');

        const merged = await inventory.packageVersions({ rootDir, manifestFiles: ['a/package.json', 'b/package.json', 'b/package.json'] });
        expect(merged).toEqual(
          new Map([
            ['shared', '2.0.0'],
            ['later', '3.0.0'],
          ])
        );
        expect(await inventory.packageVersions({ rootDir: path.join(rootDir, 'b'), manifestFiles: ['package.json'] })).toEqual(merged);
      }
    );
  });

  it('rereads a shared path after the active manifest config key changes', async () => {
    await withManifests(
      {
        'shared/package.json': JSON.stringify({ dependencies: { original: '1.0.0' } }),
        'ignored.txt': 'ignored',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();
        const readFile = vi.spyOn(fs.promises, 'readFile');
        try {
          const firstConfig = { rootDir, manifestFiles: ['shared/package.json'] };
          const [firstNames, firstVersions] = await Promise.all([
            inventory.dependencyNames(firstConfig),
            inventory.packageVersions(firstConfig),
          ]);
          expect(firstNames).toEqual(new Set(['original']));
          expect(firstVersions.get('original')).toBe('1.0.0');

          await fs.promises.writeFile(path.join(rootDir, 'shared/package.json'), JSON.stringify({ dependencies: { refreshed: '2.0.0' } }));
          const changedConfig = { rootDir, manifestFiles: ['ignored.txt', 'shared/package.json'] };
          const [changedNames, changedVersions] = await Promise.all([
            inventory.dependencyNames(changedConfig),
            inventory.packageVersions(changedConfig),
          ]);
          expect(changedNames).toEqual(new Set(['refreshed']));
          expect(changedVersions).toEqual(new Map([['refreshed', '2.0.0']]));

          await fs.promises.writeFile(path.join(rootDir, 'shared/package.json'), JSON.stringify({ dependencies: { returned: '3.0.0' } }));
          expect(await inventory.packageVersions(firstConfig)).toEqual(new Map([['returned', '3.0.0']]));
          expect(await inventory.dependencyNames(firstConfig)).toEqual(new Set(['returned']));
          expect(readFile).toHaveBeenCalledTimes(4);
        }
        finally {
          readFile.mockRestore();
        }
      }
    );
  });

  it('keeps manifest configurations distinct when their path lists contain delimiters', async () => {
    await withManifests(
      {
        'package.json': JSON.stringify({ dependencies: { firstConfigOnly: '1.0.0' } }),
        'unknown|x': 'first unknown format',
        unknown: 'second unknown format',
        'x|package.json': 'second unknown format',
      },
      async (rootDir) => {
        const inventory = new ManifestInventory();

        expect(await inventory.dependencyNames({ rootDir, manifestFiles: ['unknown|x', 'package.json'] })).toEqual(
          new Set(['firstconfigonly'])
        );
        expect(await inventory.dependencyNames({ rootDir, manifestFiles: ['unknown', 'x|package.json'] })).toEqual(new Set());
      }
    );
  });
});
