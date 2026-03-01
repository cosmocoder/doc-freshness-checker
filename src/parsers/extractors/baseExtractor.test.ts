import { BaseExtractor } from './baseExtractor.js';

describe('BaseExtractor', () => {
  let extractor: BaseExtractor;

  beforeEach(() => {
    extractor = new BaseExtractor('test-type');
  });

  it('initializes with type and all supported formats', () => {
    expect(extractor.type).toBe('test-type');
    expect(extractor.supportedFormats).toEqual(['markdown', 'restructuredtext', 'asciidoc', 'plaintext']);
  });

  describe('supportsFormat', () => {
    it.each(['markdown', 'restructuredtext', 'asciidoc', 'plaintext'] as const)('supports %s', (format) => {
      expect(extractor.supportsFormat(format)).toBe(true);
    });

    it('rejects unknown formats', () => {
      expect(extractor.supportsFormat('unknown' as 'markdown')).toBe(false);
    });
  });

  it('extract() throws by default', () => {
    const doc = { path: 'test.md', absolutePath: '/test.md', content: '', format: 'markdown' as const, lines: [], references: [] };
    expect(() => extractor.extract(doc)).toThrow('extract() must be implemented');
  });

  describe('findLineNumber', () => {
    it('returns correct line number for match index', () => {
      const content = 'line1\nline2\nline3\nline4';
      expect(extractor.findLineNumber(content, 0)).toBe(1);
      expect(extractor.findLineNumber(content, 6)).toBe(2);
      expect(extractor.findLineNumber(content, 12)).toBe(3);
    });
  });

  describe('getContext', () => {
    it('returns surrounding lines', () => {
      const lines = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
      const ctx = extractor.getContext(lines, 4, 1);
      expect(ctx).toBe('c\nd\ne');
    });

    it('clamps to array bounds', () => {
      const lines = ['a', 'b', 'c'];
      expect(extractor.getContext(lines, 1, 5)).toBe('a\nb\nc');
    });
  });
});
