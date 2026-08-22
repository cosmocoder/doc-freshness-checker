import fs from 'fs';
import os from 'os';
import path from 'path';
import { IncrementalChecker } from '../index.js';
import type { IncrementalInput } from '../validators/incrementalInputs.js';
import type { DocFreshnessConfig, Document } from '../types.js';

describe('IncrementalChecker', () => {
  let rootDir: string;
  let stateDir: string;
  let docPath: string;
  let document: Document;
  let config: DocFreshnessConfig;

  beforeEach(async () => {
    rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'incremental-'));
    stateDir = path.join(rootDir, '.cache');
    docPath = path.join(rootDir, 'guide.md');
    await fs.promises.writeFile(docPath, 'content');
    document = {
      path: 'guide.md',
      absolutePath: docPath,
      content: 'content',
      format: 'markdown',
      lines: ['content'],
      references: [],
    };
    config = { rootDir, sourcePatterns: [], manifestFiles: [] };
  });

  const saveCleanBaseline = async (
    documents: Document[] = [document],
    currentConfig: DocFreshnessConfig = config,
    currentStateDir: string = stateDir,
    incrementalInputs: IncrementalInput[] | null = []
  ): Promise<void> => {
    const checker = new IncrementalChecker(currentStateDir);
    await checker.filterChanged(documents, currentConfig, incrementalInputs);
    await checker.saveState(true);
  };

  const filterWithCapturedInputs = (
    checker: IncrementalChecker,
    documents: Document[] = [document],
    currentConfig: DocFreshnessConfig = config,
    incrementalInputs: IncrementalInput[] | null = []
  ): Promise<Document[]> => checker.filterChanged(documents, currentConfig, incrementalInputs);

  afterEach(async () => {
    await fs.promises.rm(rootDir, { recursive: true, force: true });
  });

  it.each([
    { total: 10, changed: 3, skipped: 7, pct: 70 },
    { total: 0, changed: 0, skipped: 0, pct: 0 },
    { total: 5, changed: 5, skipped: 0, pct: 0 },
  ])('computes stats for total=$total changed=$changed', ({ total, changed, skipped, pct }) => {
    expect(new IncrementalChecker(stateDir).getStats(total, changed)).toEqual({
      total,
      changed,
      skipped,
      percentSkipped: pct,
    });
  });

  it('skips an unchanged document after a clean compatible run', async () => {
    const first = new IncrementalChecker(stateDir);
    expect(await filterWithCapturedInputs(first)).toEqual([document]);
    await first.saveState(true);

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir))).toEqual([]);
  });

  it('full-validates configured calls when captured inputs are omitted', async () => {
    await saveCleanBaseline();

    expect(await new IncrementalChecker(stateDir).filterChanged([document], config)).toEqual([document]);
  });

  it('retains public no-config calls but always full-validates', async () => {
    const first = new IncrementalChecker(stateDir);
    expect(await first.filterChanged([document])).toEqual([document]);
    await first.saveState();

    expect(await new IncrementalChecker(stateDir).filterChanged([document])).toEqual([document]);
  });

  it('treats legacy flat hash JSON as incompatible state', async () => {
    await fs.promises.mkdir(stateDir);
    const hash = await new IncrementalChecker(stateDir).getHash(docPath);
    await fs.promises.writeFile(path.join(stateDir, 'file-hashes.json'), JSON.stringify({ [docPath]: hash }));

    expect(await new IncrementalChecker(stateDir).filterChanged([document])).toEqual([document]);
    expect(await new IncrementalChecker(stateDir).filterChanged([document], config)).toEqual([document]);
  });

  it('rejects a state with an unexpected version while preserving other fields', async () => {
    await saveCleanBaseline();
    const statePath = path.join(stateDir, 'file-hashes.json');
    const state = JSON.parse(await fs.promises.readFile(statePath, 'utf-8'));
    state.version = 1;
    await fs.promises.writeFile(statePath, JSON.stringify(state));

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config)).toEqual([document]);
  });

  it.each([
    { field: 'documentHashes', value: null, message: 'saved document hashes are invalid' },
    { field: 'documentHashes', value: [], message: 'saved document hashes are invalid' },
    { field: 'clean', value: 'true', message: 'saved clean status is invalid' },
    { field: 'configFingerprint', value: 42, message: 'saved config fingerprint is invalid' },
    { field: 'inputFingerprint', value: false, message: 'saved input fingerprint is invalid' },
  ])('rejects invalid $field state fields', async ({ field, value, message }) => {
    await saveCleanBaseline();
    const statePath = path.join(stateDir, 'file-hashes.json');
    const state = JSON.parse(await fs.promises.readFile(statePath, 'utf-8')) as Record<string, unknown>;
    state[field] = value;
    await fs.promises.writeFile(statePath, JSON.stringify(state));

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], { ...config, verbose: true })).toEqual([
        document,
      ]);
      expect(log).toHaveBeenCalledWith(`Incremental full validation: ${message}.`);
    }
    finally {
      log.mockRestore();
    }
  });

  it('keeps exported shouldCheck fail-closed for legacy state and source renames', async () => {
    const sourcePath = path.join(rootDir, 'source.ts');
    const renamedPath = path.join(rootDir, 'renamed.ts');
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    await fs.promises.mkdir(stateDir);
    const sourceHash = await new IncrementalChecker(stateDir).getHash(sourcePath);
    await fs.promises.writeFile(path.join(stateDir, 'file-hashes.json'), JSON.stringify({ [sourcePath]: sourceHash }));

    const checker = new IncrementalChecker(stateDir);
    await checker.loadState();
    expect(await checker.shouldCheck(sourcePath)).toBe(true);
    await fs.promises.rename(sourcePath, renamedPath);
    expect(await checker.shouldCheck(sourcePath)).toBe(true);
    expect(await checker.shouldCheck(renamedPath)).toBe(true);
    await checker.saveState();

    const savedState = JSON.parse(await fs.promises.readFile(path.join(stateDir, 'file-hashes.json'), 'utf-8'));
    expect(savedState.documentHashes[renamedPath]).toBeTypeOf('string');
  });

  it('full-validates after a captured source file is renamed', async () => {
    const sourcePath = path.join(rootDir, 'source.ts');
    const renamedPath = path.join(rootDir, 'renamed.ts');
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    const initialInputs = [{ path: sourcePath, content: 'export const source = true;' }];
    await saveCleanBaseline([document], config, stateDir, initialInputs);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, initialInputs)).toEqual([]);

    await fs.promises.rename(sourcePath, renamedPath);
    expect(
      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, [
        { path: renamedPath, content: 'export const source = true;' },
      ])
    ).toEqual([document]);
  });

  it('full-validates after a run with findings', async () => {
    const first = new IncrementalChecker(stateDir);
    await first.filterChanged([document], config);
    await first.saveState(false);

    expect(await new IncrementalChecker(stateDir).filterChanged([document], config)).toEqual([document]);
  });

  it.each(['missing', 'corrupt'])('full-validates with %s state', async (stateKind) => {
    if (stateKind === 'corrupt') {
      await fs.promises.mkdir(stateDir, { recursive: true });
      await fs.promises.writeFile(path.join(stateDir, 'file-hashes.json'), '{');
    }

    expect(await new IncrementalChecker(stateDir).filterChanged([document], config)).toEqual([document]);
  });

  it('full-validates when effective config changes', async () => {
    await saveCleanBaseline();

    const changedConfig = { ...config, rules: { 'file-path': { enabled: false } } };
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], changedConfig)).toEqual([document]);
  });

  it('full-validates when any project file changes, including dist and build', async () => {
    const sourceDir = path.join(rootDir, 'src');
    const sourcePath = path.join(sourceDir, 'server.ts');
    const manifestPath = path.join(rootDir, 'package.json');
    const distDir = path.join(rootDir, 'dist');
    const distPath = path.join(distDir, 'generated.js');
    const emptyBuildDir = path.join(rootDir, 'build', 'empty');
    await fs.promises.mkdir(sourceDir);
    await fs.promises.mkdir(distDir);
    await fs.promises.mkdir(emptyBuildDir, { recursive: true });
    await fs.promises.writeFile(sourcePath, 'export const server = true;');
    await fs.promises.writeFile(manifestPath, '{}');
    await fs.promises.writeFile(distPath, 'generated');
    config = { ...config, sourcePatterns: ['src/**/*.ts'], manifestFiles: ['package.json'] };

    await saveCleanBaseline();
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir))).toEqual([]);

    await fs.promises.rm(distPath);
    const afterDistChange = new IncrementalChecker(stateDir);
    expect(await filterWithCapturedInputs(afterDistChange)).toEqual([document]);
    await afterDistChange.saveState(true);

    const newEmptyDir = path.join(emptyBuildDir, 'new-empty');
    await fs.promises.mkdir(newEmptyDir);
    const afterDirectoryCreation = new IncrementalChecker(stateDir);
    expect(await filterWithCapturedInputs(afterDirectoryCreation)).toEqual([document]);
    await afterDirectoryCreation.saveState(true);

    await fs.promises.rmdir(newEmptyDir);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir))).toEqual([document]);
  });

  it('fingerprints explicit references inside node_modules', async () => {
    const dependencyDir = path.join(rootDir, 'node_modules', 'pkg');
    const dependencyPath = path.join(dependencyDir, 'runtime.js');
    await fs.promises.mkdir(dependencyDir, { recursive: true });
    await fs.promises.writeFile(dependencyPath, 'export const runtime = true;');
    document.references = [{ type: 'file-path', value: 'node_modules/pkg/runtime.js', lineNumber: 1, raw: '', sourceFile: document.path }];

    const inputs = [{ path: dependencyPath }];
    await saveCleanBaseline([document], config, stateDir, inputs);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([]);

    await fs.promises.rm(dependencyPath);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([document]);
  });

  it('fingerprints configured manifests inside excluded directories', async () => {
    const manifestDir = path.join(rootDir, 'node_modules', 'pkg');
    const manifestPath = path.join(manifestDir, 'package.json');
    await fs.promises.mkdir(manifestDir, { recursive: true });
    await fs.promises.writeFile(manifestPath, '{}');
    config = { ...config, manifestFiles: ['node_modules/pkg/package.json'] };

    const inputs = [{ path: manifestPath }];
    await saveCleanBaseline([document], config, stateDir, inputs);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([]);

    await fs.promises.writeFile(manifestPath, '{"dependencies":{"pkg":"1.0.0"}}');
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([document]);
  });

  it('fingerprints provided source inputs excluded from the generic inventory', async () => {
    const sourceDir = path.join(rootDir, '.git');
    const sourcePath = path.join(sourceDir, 'source.ts');
    await fs.promises.mkdir(sourceDir);
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    const initialInputs = [{ path: sourcePath, content: 'export const source = true;' }];
    await saveCleanBaseline([document], config, stateDir, initialInputs);

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, initialInputs)).toEqual([]);
    await fs.promises.writeFile(sourcePath, 'export const source = false;');
    expect(
      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, [
        { path: sourcePath, content: 'export const source = false;' },
      ])
    ).toEqual([document]);
  });

  it.each(['.git', 'node_modules'])('excludes generic inventory entries under %s', async (excludedDirectory) => {
    const excludedPath = path.join(rootDir, excludedDirectory, 'generated.ts');
    await fs.promises.mkdir(path.dirname(excludedPath), { recursive: true });
    await fs.promises.writeFile(excludedPath, 'export const generated = true;');
    await saveCleanBaseline();

    await fs.promises.writeFile(excludedPath, 'export const generated = false;');
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config)).toEqual([]);
  });

  it('full-validates when a provided source input is outside the project', async () => {
    const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'incremental-outside-'));
    try {
      const outsidePath = path.join(outsideDir, 'source.ts');
      await fs.promises.writeFile(outsidePath, 'export const source = true;');
      const inputs = [{ path: outsidePath, content: 'export const source = true;' }];
      await saveCleanBaseline([document], config, stateDir, inputs);

      expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([document]);
    }
    finally {
      await fs.promises.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('full-validates when captured inputs are unavailable', async () => {
    await saveCleanBaseline([document], config, stateDir, null);

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, null)).toEqual([document]);
  });

  it('explains verbose full-validation fallbacks', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], { ...config, verbose: true }, null);

      expect(log).toHaveBeenCalledWith('Incremental full validation: no saved state exists.');
      expect(log).toHaveBeenCalledWith('Incremental full validation: validation inputs could not be captured.');
    }
    finally {
      log.mockRestore();
    }
  });

  it.each([
    ['configFingerprint', 'Incremental full validation: the saved config fingerprint is unavailable.'],
    ['inputFingerprint', 'Incremental full validation: the saved input fingerprint is unavailable.'],
  ])('reports an unavailable saved %s without claiming a change', async (field, message) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const verboseConfig = { ...config, verbose: true };
      await saveCleanBaseline([document], verboseConfig);
      const statePath = path.join(stateDir, 'file-hashes.json');
      const state = JSON.parse(await fs.promises.readFile(statePath, 'utf-8')) as Record<string, unknown>;
      state[field] = null;
      await fs.promises.writeFile(statePath, JSON.stringify(state));
      log.mockClear();

      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], verboseConfig);

      expect(log).toHaveBeenCalledWith(message);
      expect(log).not.toHaveBeenCalledWith('Incremental full validation: configuration changed.');
      expect(log).not.toHaveBeenCalledWith('Incremental full validation: validation inputs changed.');
    }
    finally {
      log.mockRestore();
    }
  });

  it('does not duplicate the custom extractor diagnostic', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await filterWithCapturedInputs(
        new IncrementalChecker(stateDir),
        [document],
        {
          ...config,
          verbose: true,
          customExtractors: [{} as NonNullable<DocFreshnessConfig['customExtractors']>[number]],
        },
        []
      );

      expect(log.mock.calls.flat()).toEqual(
        expect.arrayContaining(['Incremental full validation: custom extractors cannot be fingerprinted.'])
      );
      expect(
        log.mock.calls.flat().filter((entry) => entry === 'Incremental full validation: custom extractors cannot be fingerprinted.')
      ).toHaveLength(1);
    }
    finally {
      log.mockRestore();
    }
  });

  it('fingerprints source matches inside cache.dir', async () => {
    const sourcePath = path.join(stateDir, 'source.ts');
    await fs.promises.mkdir(stateDir);
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    const initialInputs = [{ path: sourcePath, content: 'export const source = true;' }];
    await saveCleanBaseline([document], config, stateDir, initialInputs);

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, initialInputs)).toEqual([]);
    await fs.promises.writeFile(sourcePath, 'export const source = false;');
    expect(
      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, [
        { path: sourcePath, content: 'export const source = false;' },
      ])
    ).toEqual([document]);
  });

  it('fingerprints source matches through a symlinked cache directory', async () => {
    const realStateDir = path.join(rootDir, '.real-cache');
    const sourcePath = path.join(realStateDir, 'source.ts');
    await fs.promises.mkdir(realStateDir);
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    await fs.promises.symlink('.real-cache', stateDir, 'dir');
    const sourceInputPath = path.join(stateDir, 'source.ts');
    const initialInputs = [{ path: sourceInputPath, content: 'export const source = true;' }];
    await saveCleanBaseline([document], config, stateDir, initialInputs);

    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, initialInputs)).toEqual([]);
    await fs.promises.writeFile(sourcePath, 'export const source = false;');
    expect(
      await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, [
        { path: sourceInputPath, content: 'export const source = false;' },
      ])
    ).toEqual([document]);
  });

  it('fingerprints source matches inside graph.cacheDir', async () => {
    const graphStateDir = path.join(rootDir, '.graph-cache');
    const sourcePath = path.join(graphStateDir, 'source.ts');
    await fs.promises.mkdir(graphStateDir);
    await fs.promises.writeFile(sourcePath, 'export const source = true;');
    config = {
      ...config,
      graph: { cacheDir: '.graph-cache' },
      sourcePatterns: ['.graph-cache/**/*.ts'],
    };
    const initialInputs = [{ path: sourcePath, content: 'export const source = true;' }];
    await saveCleanBaseline([document], config, graphStateDir, initialInputs);

    expect(await filterWithCapturedInputs(new IncrementalChecker(graphStateDir), [document], config, initialInputs)).toEqual([]);
    await fs.promises.writeFile(sourcePath, 'export const source = false;');
    expect(
      await filterWithCapturedInputs(new IncrementalChecker(graphStateDir), [document], config, [
        { path: sourcePath, content: 'export const source = false;' },
      ])
    ).toEqual([document]);
  });

  it('fingerprints explicit symlink target content', async () => {
    const dependencyDir = path.join(rootDir, 'node_modules', 'pkg');
    const targetPath = path.join(dependencyDir, 'target.js');
    const linkPath = path.join(dependencyDir, 'runtime.js');
    await fs.promises.mkdir(dependencyDir, { recursive: true });
    await fs.promises.writeFile(targetPath, 'export const runtime = true;');
    await fs.promises.symlink('target.js', linkPath);
    document.references = [{ type: 'file-path', value: 'node_modules/pkg/runtime.js', lineNumber: 1, raw: '', sourceFile: document.path }];

    const inputs = [{ path: linkPath }];
    await saveCleanBaseline([document], config, stateDir, inputs);
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([]);

    await fs.promises.writeFile(targetPath, 'export const runtime = false;');
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, inputs)).toEqual([document]);
  });

  it('fingerprints directory symlink content under node_modules', async () => {
    const dependencyDir = path.join(rootDir, 'node_modules', 'pkg');
    const targetPath = path.join(dependencyDir, 'source.ts');
    await fs.promises.mkdir(dependencyDir, { recursive: true });
    await fs.promises.writeFile(targetPath, 'export const source = true;');
    await fs.promises.symlink('node_modules/pkg', path.join(rootDir, 'linked'), 'dir');

    await saveCleanBaseline();
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir))).toEqual([]);

    await fs.promises.writeFile(targetPath, 'export const source = false;');
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir))).toEqual([document]);
  });

  it('keeps captured-input and directory fingerprints deterministic across ordering', async () => {
    const firstInputPath = path.join(rootDir, 'first.ts');
    const secondInputPath = path.join(rootDir, 'second.ts');
    await fs.promises.writeFile(firstInputPath, 'export const first = true;');
    await fs.promises.writeFile(secondInputPath, 'export const second = true;');
    const inputs = [
      { path: firstInputPath, content: 'export const first = true;' },
      { path: secondInputPath, content: 'export const second = true;' },
    ];
    await saveCleanBaseline([document], config, stateDir, inputs);

    const rootEntries = await fs.promises.readdir(rootDir, { withFileTypes: true });
    const readdir = vi.spyOn(fs.promises, 'readdir').mockResolvedValueOnce([...rootEntries].reverse() as never);
    try {
      expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document], config, [...inputs].reverse())).toEqual([]);
    }
    finally {
      readdir.mockRestore();
    }
  });

  it('full-validates all docs when a document also changes the project inventory', async () => {
    const secondPath = path.join(rootDir, 'second.md');
    await fs.promises.writeFile(secondPath, 'second');
    const second = { ...document, path: 'second.md', absolutePath: secondPath, content: 'second', lines: ['second'] };
    await saveCleanBaseline([document, second]);

    await fs.promises.writeFile(docPath, 'changed');
    document = { ...document, content: 'changed', lines: ['changed'] };
    expect(await filterWithCapturedInputs(new IncrementalChecker(stateDir), [document, second])).toEqual([document, second]);
  });

  it('persists a versioned state for completed runs', async () => {
    const checker = new IncrementalChecker(stateDir);
    await filterWithCapturedInputs(checker);
    await checker.saveState(false);

    const state = JSON.parse(await fs.promises.readFile(path.join(stateDir, 'file-hashes.json'), 'utf-8'));
    expect(state).toMatchObject({ version: 2, clean: false });
    expect(state.documentHashes[docPath]).toBeTypeOf('string');
    expect(state.configFingerprint).toBeTypeOf('string');
    expect(state.inputFingerprint).toBeTypeOf('string');
  });
});
