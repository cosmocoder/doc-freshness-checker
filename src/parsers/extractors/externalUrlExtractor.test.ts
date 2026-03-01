import { ExternalUrlExtractor } from './externalUrlExtractor.js';
import type { Document } from '../../types.js';

function makeDoc(content: string): Document {
  return {
    path: 'docs/test.md',
    absolutePath: '/project/docs/test.md',
    content,
    format: 'markdown',
    lines: content.split('\n'),
    references: [],
  };
}

describe('ExternalUrlExtractor', () => {
  const extractor = new ExternalUrlExtractor();

  it('extracts HTTP and HTTPS URLs', () => {
    const doc = makeDoc('Visit https://example.com and http://test.org/path');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(2);
    expect(refs[0].value).toBe('https://example.com');
    expect(refs[1].value).toBe('http://test.org/path');
  });

  it('strips trailing punctuation', () => {
    const doc = makeDoc('See https://example.com. Also https://test.org,');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com');
    expect(refs[1].value).toBe('https://test.org');
  });

  it('preserves balanced parentheses in Wikipedia-style URLs', () => {
    const doc = makeDoc('See https://en.wikipedia.org/wiki/Example_(disambiguation)');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://en.wikipedia.org/wiki/Example_(disambiguation)');
  });

  it('strips unbalanced trailing parenthesis', () => {
    const doc = makeDoc('(visit https://example.com)');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com');
  });

  it('sets correct line numbers', () => {
    const doc = makeDoc('line1\nhttps://example.com\nline3');
    const refs = extractor.extract(doc);
    expect(refs[0].lineNumber).toBe(2);
  });

  it('extracts URLs with query params and fragments', () => {
    const doc = makeDoc('https://example.com/page?foo=bar&baz=1#section');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/page?foo=bar&baz=1#section');
  });

  it('strips multiple trailing punctuation characters', () => {
    const doc = makeDoc('See https://example.com/path...');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/path');
  });

  it('handles URL ending with semicolon and colon', () => {
    const doc = makeDoc('Visit https://example.com/page; and https://example.com/other:');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/page');
    expect(refs[1].value).toBe('https://example.com/other');
  });

  it('handles multiple unbalanced trailing parens', () => {
    const doc = makeDoc('(see (https://example.com))');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com');
  });

  it('preserves URL with balanced nested parens', () => {
    const doc = makeDoc('https://en.wikipedia.org/wiki/A_(B_(C))');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://en.wikipedia.org/wiki/A_(B_(C))');
  });

  it('strips trailing bracket characters', () => {
    const doc = makeDoc('[https://example.com/page]');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/page');
  });

  it('strips trailing single and double quotes', () => {
    const doc = makeDoc("see 'https://example.com/page'");
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/page');
  });

  it('strips trailing exclamation and question marks', () => {
    const doc = makeDoc('Visit https://example.com/page! or https://example.com/other?');
    const refs = extractor.extract(doc);
    expect(refs[0].value).toBe('https://example.com/page');
    expect(refs[1].value).toBe('https://example.com/other');
  });
});
