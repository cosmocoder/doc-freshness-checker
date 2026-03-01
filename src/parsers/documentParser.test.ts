import fs from 'fs';
import path from 'path';
import { DocumentParser } from './documentParser.js';
import { BaseExtractor } from './extractors/baseExtractor.js';
import type { Document, Reference } from '../types.js';
import { captureConsoleWarn } from '../test-utils/console.js';

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
  const captureWarn = captureConsoleWarn;
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

    it('handles unreadable files gracefully in verbose mode', async () => {
      const badFile = await writeDoc('bad-file.md', 'content');
      const parser = createParser([path.relative(process.cwd(), badFile)], true);

      const readSpy = vi.spyOn(fs.promises, 'readFile');
      readSpy.mockRejectedValueOnce(new Error('Permission denied'));
      const warnSpy = captureWarn();

      const docs = await parser.scanDocuments();
      expect(docs).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Permission denied'));
    });

    it('silently skips unreadable files in non-verbose mode', async () => {
      const badFile = await writeDoc('silent-bad.md', 'content');
      const parser = createParser([path.relative(process.cwd(), badFile)], false);

      vi.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(new Error('EPERM'));
      const warnSpy = captureWarn();

      const docs = await parser.scanDocuments();
      expect(docs).toHaveLength(0);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('uses empty array when include is not set', async () => {
      const parser = new DocumentParser({ rootDir: process.cwd() });
      const docs = await parser.scanDocuments();
      expect(docs).toEqual([]);
    });
  });
});
