import { FilePathExtractor } from './filePathExtractor.js';
import type { Document } from '../../types.js';

function makeDoc(content: string, format: 'markdown' | 'restructuredtext' | 'asciidoc' = 'markdown'): Document {
  return {
    path: 'docs/test.md',
    absolutePath: '/project/docs/test.md',
    content,
    format,
    lines: content.split('\n'),
    references: [],
  };
}

describe('FilePathExtractor', () => {
  const extractor = new FilePathExtractor();

  it('has type "file-path"', () => {
    expect(extractor.type).toBe('file-path');
  });

  describe('markdown format', () => {
    it('extracts relative file paths from links', () => {
      const doc = makeDoc('See [config](./config/loader.ts) and [readme](../README.md)');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(2);
      expect(refs[0].value).toBe('./config/loader.ts');
      expect(refs[1].value).toBe('../README.md');
    });

    it('extracts paths with extensions', () => {
      const doc = makeDoc('Check [file](src/utils/helper.ts)');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('src/utils/helper.ts');
    });

    it('skips URLs and anchors', () => {
      const doc = makeDoc('[link](https://example.com) [anchor](#heading)');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(0);
    });

    it('strips line number suffixes and stores lineRef', () => {
      const doc = makeDoc('[file](../src/file.ts:26-38)');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('../src/file.ts');
      expect(refs[0].lineRef).toBe('26-38');
    });

    it('handles GitHub-style line references', () => {
      const doc = makeDoc('[file](../src/file.ts#L123)');
      const refs = extractor.extract(doc);
      expect(refs[0].value).toBe('../src/file.ts');
      expect(refs[0].lineRef).toBe('123');
    });

    it('preserves linkText', () => {
      const doc = makeDoc('[My Link Text](./file.ts)');
      const refs = extractor.extract(doc);
      expect(refs[0].linkText).toBe('My Link Text');
    });
  });

  describe('restructuredtext format', () => {
    it('extracts RST link references', () => {
      const doc = makeDoc('`Configuration <../config.rst>`_', 'restructuredtext');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('../config.rst');
    });
  });

  describe('asciidoc format', () => {
    it('extracts AsciiDoc link references', () => {
      const doc = makeDoc('link:./config.adoc[Configuration]', 'asciidoc');
      const refs = extractor.extract(doc);
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./config.adoc');
      expect(refs[0].linkText).toBe('Configuration');
    });
  });
});
