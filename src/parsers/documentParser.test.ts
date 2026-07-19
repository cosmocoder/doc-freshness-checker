import fs from 'fs';
import path from 'path';
import { DocumentParser } from './documentParser.js';
import { BaseExtractor } from './extractors/baseExtractor.js';
import type { Document, Reference } from '../types.js';

class MockExtractor extends BaseExtractor {
  private refs: Reference[];

  constructor(type: string, refs: Reference[] = []) {
    super(type);
    this.refs = refs;
  }

  extract(_document: Document): Reference[] {
    return this.refs;
  }
}

class MarkdownOnlyExtractor extends BaseExtractor {
  constructor() {
    super('test');
  }

  supportsFormat(format: string): boolean {
    return format === 'markdown';
  }

  extract(_document: Document): Reference[] {
    return [{ type: 'test', value: 'found', lineNumber: 1, raw: 'found', sourceFile: '' }];
  }
}

describe('DocumentParser', () => {
  const tmpDir = path.join(process.cwd(), '.doc-freshness-cache', 'parser-test');
  const writeDoc = async (fileName: string, content: string) => {
    const fullPath = path.join(tmpDir, fileName);
    await fs.promises.writeFile(fullPath, content);
    return fullPath;
  };
  const createParser = (include: string[], verbose: boolean = false) =>
    new DocumentParser({
      rootDir: process.cwd(),
      include,
      verbose,
    });

  beforeAll(async () => {
    await fs.promises.mkdir(tmpDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  describe('detectFormat', () => {
    const parser = new DocumentParser({ rootDir: process.cwd() });

    it.each([
      ['file.md', 'markdown'],
      ['file.markdown', 'markdown'],
      ['file.rst', 'restructuredtext'],
      ['file.adoc', 'asciidoc'],
      ['file.asciidoc', 'asciidoc'],
      ['file.txt', 'plaintext'],
      ['file.unknown', 'plaintext'],
    ] as const)('detectFormat(%s) => %s', (file, expected) => {
      expect(parser.detectFormat(file)).toBe(expected);
    });
  });

  describe('scanDocuments', () => {
    it('returns empty array when no files match', async () => {
      const parser = createParser(['nonexistent/**/*.md']);
      const docs = await parser.scanDocuments();
      expect(docs).toEqual([]);
    });

    it('scans and parses matching doc files', async () => {
      const mdFile = await writeDoc('test-doc.md', '# Hello\n\nSome content');
      const parser = createParser([path.relative(process.cwd(), mdFile)]);
      const docs = await parser.scanDocuments();
      expect(docs).toHaveLength(1);
      expect(docs[0].format).toBe('markdown');
      expect(docs[0].content).toContain('Hello');
    });

    it('applies registered extractors to matching documents', async () => {
      const mdFile = await writeDoc('extract-doc.md', '# Test\n\nContent');
      const parser = createParser([path.relative(process.cwd(), mdFile)]);
      const ref: Reference = { type: 'test', value: 'found', lineNumber: 1, raw: 'found', sourceFile: '' };
      parser.registerExtractor(new MockExtractor('test', [ref]));
      const docs = await parser.scanDocuments();
      expect(docs[0].references).toHaveLength(1);
      expect(docs[0].references[0].value).toBe('found');
    });

    it('skips extractors that do not support the doc format', async () => {
      const txtFile = await writeDoc('plain.txt', 'plain text content');
      const parser = createParser([path.relative(process.cwd(), txtFile)]);
      parser.registerExtractor(new MarkdownOnlyExtractor());
      const docs = await parser.scanDocuments();
      expect(docs[0].references).toHaveLength(0);
    });

    it('propagates matched-document read failures', async () => {
      const badFile = await writeDoc('bad-file.md', 'content');
      const parser = createParser([path.relative(process.cwd(), badFile)], true);

      const readSpy = vi.spyOn(fs.promises, 'readFile');
      readSpy.mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { code: 'EACCES' }));

      await expect(parser.scanDocuments()).rejects.toThrow('Permission denied');
    });

    it('preserves the read failure when checking whether the path disappeared also fails', async () => {
      const badFile = await writeDoc('bad-file-stat.md', 'content');
      const parser = createParser([path.relative(process.cwd(), badFile)]);
      const readError = Object.assign(new Error('File disappeared while opening'), {
        code: 'ENOENT',
        syscall: 'open',
      });
      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(readError);
      vi.spyOn(fs.promises, 'lstat').mockRejectedValueOnce(
        Object.assign(new Error('Permission denied while checking path'), {
          code: 'EACCES',
          syscall: 'lstat',
        })
      );

      await expect(parser.scanDocuments()).rejects.toBe(readError);
    });

    it('continues when a matched document disappears before it is read', async () => {
      const firstFile = await writeDoc('race-a.md', 'first');
      const missingFile = await writeDoc('race-b.md', 'missing');
      const lastFile = await writeDoc('race-c.md', 'last');
      const parser = createParser([firstFile, missingFile, lastFile].map((file) => path.relative(process.cwd(), file)));
      const contents = new Map([
        [firstFile, 'first'],
        [lastFile, 'last'],
      ]);
      const readSpy = vi.spyOn(fs.promises, 'readFile').mockImplementation(async (file) => {
        if (file === missingFile) {
          throw Object.assign(new Error('File disappeared'), { code: 'ENOENT' });
        }
        return contents.get(file.toString()) ?? '';
      });
      const lstatSpy = vi
        .spyOn(fs.promises, 'lstat')
        .mockRejectedValueOnce(Object.assign(new Error('File disappeared'), { code: 'ENOENT' }));

      try {
        const docs = await parser.scanDocuments();
        expect(docs.map((doc) => doc.absolutePath).sort()).toEqual([firstFile, lastFile].sort());
      }
      finally {
        readSpy.mockRestore();
        lstatSpy.mockRestore();
      }
    });

    it('rejects a dangling matched-document symlink', async () => {
      const linkPath = path.join(tmpDir, 'broken-link.md');
      await fs.promises.rm(linkPath, { force: true });
      await fs.promises.symlink('missing-target.md', linkPath);
      const parser = createParser([path.relative(process.cwd(), linkPath)]);

      await expect(parser.scanDocuments()).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('propagates ENOENT-coded extractor failures', async () => {
      const mdFile = await writeDoc('extractor-enoent.md', 'content');
      const parser = createParser([path.relative(process.cwd(), mdFile)]);
      const extractor = new MockExtractor('test');
      vi.spyOn(extractor, 'extract').mockImplementation(() => {
        throw Object.assign(new Error('Extractor path missing'), { code: 'ENOENT' });
      });
      parser.registerExtractor(extractor);

      await expect(parser.scanDocuments()).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('uses empty array when include is not set', async () => {
      const parser = new DocumentParser({ rootDir: process.cwd() });
      const docs = await parser.scanDocuments();
      expect(docs).toEqual([]);
    });
  });
});
