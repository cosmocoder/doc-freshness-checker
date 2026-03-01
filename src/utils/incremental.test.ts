import fs from 'fs';
import crypto from 'crypto';
import { IncrementalChecker } from './incremental.js';
import type { Document } from '../types.js';

function makeDoc(docPath: string): Document {
  return {
    path: docPath,
    absolutePath: `/project/${docPath}`,
    content: 'content',
    format: 'markdown',
    lines: ['content'],
    references: [],
  };
}

describe('IncrementalChecker', () => {
  let checker: IncrementalChecker;

  beforeEach(() => {
    checker = new IncrementalChecker('/tmp/test-cache');
  });

  describe('getStats', () => {
    it.each([
      { total: 10, changed: 3, skipped: 7, pct: 70 },
      { total: 0, changed: 0, skipped: 0, pct: 0 },
      { total: 5, changed: 5, skipped: 0, pct: 0 },
    ])('computes stats for total=$total changed=$changed', ({ total, changed, skipped, pct }) => {
      const stats = checker.getStats(total, changed);
      expect(stats).toEqual({ total, changed, skipped, percentSkipped: pct });
    });
  });

  describe('loadState', () => {
    it('loads previous hashes from disk', async () => {
      vi.spyOn(fs.promises, 'readFile').mockResolvedValue(JSON.stringify({ 'file.md': 'abc123' }));
      await checker.loadState();
    });

    it('handles missing state file gracefully', async () => {
      vi.spyOn(fs.promises, 'readFile').mockRejectedValue(new Error('ENOENT'));
      await expect(checker.loadState()).resolves.not.toThrow();
    });
  });

  describe('saveState', () => {
    it('writes current hashes to disk', async () => {
      const mkdirSpy = vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
      await checker.saveState();
      expect(mkdirSpy).toHaveBeenCalledWith('/tmp/test-cache', { recursive: true });
      expect(writeSpy).toHaveBeenCalled();
    });
  });

  describe('shouldCheck', () => {
    it('returns true for new files not in previous state', async () => {
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(JSON.stringify({})).mockResolvedValueOnce('file content');

      await checker.loadState();
      expect(await checker.shouldCheck('/project/new.md')).toBe(true);
    });

    it('returns false for unchanged files', async () => {
      const content = 'file content';
      const expectedHash = crypto.createHash('md5').update(content).digest('hex');

      vi.spyOn(fs.promises, 'readFile')
        .mockResolvedValueOnce(JSON.stringify({ '/project/same.md': expectedHash }))
        .mockResolvedValueOnce(content);

      await checker.loadState();
      expect(await checker.shouldCheck('/project/same.md')).toBe(false);
    });

    it('returns true when file read fails', async () => {
      vi.spyOn(fs.promises, 'readFile').mockResolvedValueOnce(JSON.stringify({})).mockRejectedValueOnce(new Error('read error'));

      await checker.loadState();
      expect(await checker.shouldCheck('/project/broken.md')).toBe(true);
    });
  });

  describe('filterChanged', () => {
    it('returns only documents whose content has changed', async () => {
      const content = 'unchanged';
      const hash = crypto.createHash('md5').update(content).digest('hex');

      vi.spyOn(fs.promises, 'readFile')
        .mockResolvedValueOnce(JSON.stringify({ '/project/unchanged.md': hash }))
        .mockResolvedValueOnce(content)
        .mockResolvedValueOnce('new content');

      const docs = [makeDoc('unchanged.md'), makeDoc('changed.md')];
      const changed = await checker.filterChanged(docs);

      expect(changed).toHaveLength(1);
      expect(changed[0].path).toBe('changed.md');
    });
  });
});
