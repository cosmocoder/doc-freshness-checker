import fs from 'fs';
import os from 'os';
import path from 'path';
import { SourceIndex } from './sourceIndex.js';

const glob = vi.hoisted(() => vi.fn());

vi.mock('glob', () => ({ glob }));

describe('SourceIndex large glob results', () => {
  it('preserves every match without a variadic append overflow', async () => {
    const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'doc-freshness-large-glob-'));
    const file = path.join(rootDir, 'large.ts');
    await fs.promises.writeFile(file, 'class LargeResult {}', 'utf-8');
    glob.mockResolvedValue(new Array<string>(200_000).fill(file));
    const readFile = vi.spyOn(fs.promises, 'readFile');

    try {
      const snapshot = await new SourceIndex().load({ rootDir, sourcePatterns: ['large'] }, 'pattern');
      const locations = snapshot.symbols.get('LargeResult');
      expect(locations).toHaveLength(200_000);
      expect(locations?.[0].filePath).toBe('large.ts');
      expect(locations?.at(-1)?.filePath).toBe('large.ts');
      expect(readFile).toHaveBeenCalledOnce();
    }
    finally {
      readFile.mockRestore();
      glob.mockReset();
      await fs.promises.rm(rootDir, { recursive: true, force: true });
    }
  });
});
