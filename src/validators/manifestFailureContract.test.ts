import fs from 'fs';
import path from 'path';
import { DependencyValidator } from './dependencyValidator.js';
import { VersionValidator } from './versionValidator.js';
import type { BaseValidator, DocFreshnessConfig, Reference, ValidationResult } from '../types.js';
import { makeDoc, makeRef } from '../test-utils/factories.js';

interface ValidatorContract {
  name: string;
  create: () => BaseValidator;
  reference: (name: string) => Reference;
  isFound: (result: ValidationResult) => boolean;
}

const contracts: ValidatorContract[] = [
  {
    name: 'DependencyValidator',
    create: () => new DependencyValidator(),
    reference: (name) => makeRef('dependency', name, { ecosystem: 'npm' }),
    isFound: (result) => result.valid,
  },
  {
    name: 'VersionValidator',
    create: () => new VersionValidator(),
    reference: (name) => makeRef('version', `${name} 1.0`, { technology: name, version: '1.0' }),
    isFound: (result) => result.message === undefined,
  },
];

const doc = makeDoc();
const tmpRoot = path.join(process.cwd(), '.doc-freshness-cache', 'manifest-failure-contract');

function configFor(...manifestPaths: string[]): DocFreshnessConfig {
  return {
    rootDir: process.cwd(),
    manifestFiles: manifestPaths.map((manifestPath) => path.relative(process.cwd(), manifestPath)),
  };
}

function packageManifest(name: string): string {
  return JSON.stringify({ dependencies: { [name]: '1.0.0' } });
}

async function rejectedError(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  }
  catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected operation to reject');
}

describe.each(contracts)('$name manifest failure contract', ({ name, create, reference, isFound }) => {
  const contractRoot = path.join(tmpRoot, name);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await fs.promises.rm(contractRoot, { recursive: true, force: true });
  });

  it('rejects a missing supported manifest with its path and cause', async () => {
    const manifest = path.join(contractRoot, 'missing', 'package.json');
    const error = await rejectedError(create().validateBatch([reference('anything')], doc, configFor(manifest)));

    expect(error.message).toContain(manifest);
    expect(error.cause).toBeInstanceOf(Error);
    expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('resolves relative roots while preserving absolute manifest paths', async () => {
    const relativeRoot = path.relative(process.cwd(), path.join(contractRoot, 'relative-root'));
    const absoluteManifest = path.join(contractRoot, 'absolute', 'package.json');

    for (const manifestPath of ['nested/package.json', absoluteManifest]) {
      const expectedPath = path.resolve(relativeRoot, manifestPath);
      const config: DocFreshnessConfig = { rootDir: relativeRoot, manifestFiles: [manifestPath] };
      const error = await rejectedError(create().validateBatch([reference('anything')], doc, config));

      expect(error.message).toContain(expectedPath);
      expect((error.cause as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
  });

  it('rejects an unreadable supported manifest', async () => {
    const manifest = path.join(contractRoot, 'unreadable', 'package.json');
    await fs.promises.mkdir(manifest, { recursive: true });

    const error = await rejectedError(create().validateBatch([reference('anything')], doc, configFor(manifest)));

    expect(error.message).toContain(manifest);
    expect((error.cause as NodeJS.ErrnoException).code).toBe('EISDIR');
  });

  it('preserves the original read failure as the exact cause', async () => {
    const manifest = path.join(contractRoot, 'mocked-read', 'package.json');
    const originalCause = new Error('deterministic read failure');
    vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(originalCause);

    const error = await rejectedError(create().validateBatch([reference('anything')], doc, configFor(manifest)));

    expect(error.message).toContain(manifest);
    expect(error.message).toContain(originalCause.message);
    expect(error.cause).toBe(originalCause);
  });

  it('retries every manifest after a partial parse failure is repaired', async () => {
    const validManifest = path.join(contractRoot, 'partial', 'valid', 'package.json');
    const brokenManifest = path.join(contractRoot, 'partial', 'broken', 'package.json');
    await fs.promises.mkdir(path.dirname(validManifest), { recursive: true });
    await fs.promises.mkdir(path.dirname(brokenManifest), { recursive: true });
    await fs.promises.writeFile(validManifest, packageManifest('pkg-a'));
    await fs.promises.writeFile(brokenManifest, '{ invalid json');
    const validator = create();
    const config = configFor(validManifest, brokenManifest);

    const error = await rejectedError(validator.validateBatch([reference('pkg-a')], doc, config));
    expect(error.message).toContain(brokenManifest);
    expect(error.cause).toBeInstanceOf(SyntaxError);

    await fs.promises.writeFile(brokenManifest, packageManifest('pkg-b'));
    const results = await validator.validateBatch([reference('pkg-a'), reference('pkg-b')], doc, config);
    expect(results.map(isFound)).toEqual([true, true]);
  });

  it('does not reuse a successful prior config after a different config fails', async () => {
    const manifestA = path.join(contractRoot, 'config-change', 'a', 'package.json');
    const manifestB = path.join(contractRoot, 'config-change', 'b', 'package.json');
    await fs.promises.mkdir(path.dirname(manifestA), { recursive: true });
    await fs.promises.mkdir(path.dirname(manifestB), { recursive: true });
    await fs.promises.writeFile(manifestA, packageManifest('pkg-a'));
    await fs.promises.writeFile(manifestB, '{ invalid json');
    const validator = create();

    const first = await validator.validateBatch([reference('pkg-a')], doc, configFor(manifestA));
    expect(isFound(first[0])).toBe(true);
    await expect(validator.validateBatch([reference('pkg-b')], doc, configFor(manifestB))).rejects.toThrow();

    await fs.promises.writeFile(manifestB, packageManifest('pkg-b'));
    const repaired = await validator.validateBatch([reference('pkg-a'), reference('pkg-b')], doc, configFor(manifestB));
    expect(repaired.map(isFound)).toEqual([false, true]);
  });

  it('accepts an empty manifest list without reading files', async () => {
    const readFile = vi.spyOn(fs.promises, 'readFile');

    const results = await create().validateBatch([reference('anything')], doc, configFor());

    expect(results).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('preserves behavior when a valid manifest path is duplicated', async () => {
    const manifest = path.join(contractRoot, 'duplicate', 'package.json');
    await fs.promises.mkdir(path.dirname(manifest), { recursive: true });
    await fs.promises.writeFile(manifest, packageManifest('pkg-a'));

    const results = await create().validateBatch([reference('pkg-a')], doc, configFor(manifest, manifest));

    expect(isFound(results[0])).toBe(true);
  });

  it('ignores an unknown basename without reading it', async () => {
    const manifest = path.join(contractRoot, 'unknown', 'manifest.lock');
    const readFile = vi.spyOn(fs.promises, 'readFile');

    const results = await create().validateBatch([reference('anything')], doc, configFor(manifest));

    expect(results).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalled();
  });
});
