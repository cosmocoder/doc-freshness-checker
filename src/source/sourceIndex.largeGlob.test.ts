import fs from 'fs';
import os from 'os';
import path from 'path';
import { glob } from 'node:fs/promises';
import { SourceIndex } from './sourceIndex.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, glob: vi.fn(original.glob) };
});

async function* globResults<T>(entries: T[]): AsyncGenerator<T> {
  yield* entries;
}

describe('SourceIndex large glob results', () => {
  it('deduplicates reads across a large match set', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-large-glob-'));
    const file = path.join(rootDir, 'large.ts');
    await fs.promises.writeFile(file, 'class LargeResult {}', 'utf-8');
    const [entry] = await fs.promises.readdir(rootDir, { withFileTypes: true });
    vi.mocked(glob).mockReturnValue(globResults(new Array(500_000).fill(entry)));
    const readFile = vi.spyOn(fs.promises, 'readFile');

    try {
      const snapshot = await new SourceIndex().load({ rootDir, sourcePatterns: ['large'] }, 'pattern');
      const locations = snapshot.symbols.get('LargeResult');
      expect(locations).toHaveLength(500_000);
      expect(locations?.[0].filePath).toBe('large.ts');
      expect(locations?.at(-1)?.filePath).toBe('large.ts');
      expect(readFile).toHaveBeenCalledOnce();
    }
    finally {
      readFile.mockRestore();
      vi.mocked(glob).mockReset();
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });
});
