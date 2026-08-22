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

  it.each([
    ['strips trailing punctuation', 'See https://example.com. Also https://test.org,', ['https://example.com', 'https://test.org']],
    [
      'preserves balanced parentheses in Wikipedia-style URLs',
      'See https://en.wikipedia.org/wiki/Example_(disambiguation)',
      ['https://en.wikipedia.org/wiki/Example_(disambiguation)'],
    ],
    ['strips unbalanced trailing parenthesis', '(visit https://example.com)', ['https://example.com']],
    ['strips multiple trailing punctuation characters', 'See https://example.com/path...', ['https://example.com/path']],
    [
      'handles URL ending with semicolon and colon',
      'Visit https://example.com/page; and https://example.com/other:',
      ['https://example.com/page', 'https://example.com/other'],
    ],
    ['handles multiple unbalanced trailing parens', '(see (https://example.com))', ['https://example.com']],
    ['preserves URL with balanced nested parens', 'https://en.wikipedia.org/wiki/A_(B_(C))', ['https://en.wikipedia.org/wiki/A_(B_(C))']],
    ['strips trailing bracket characters', '[https://example.com/page]', ['https://example.com/page']],
    ['strips trailing brace characters', 'https://example.com/page}', ['https://example.com/page']],
    ['strips trailing single and double quotes', "see 'https://example.com/page'", ['https://example.com/page']],
    [
      'strips trailing exclamation and question marks',
      'Visit https://example.com/page! or https://example.com/other?',
      ['https://example.com/page', 'https://example.com/other'],
    ],
  ])('%s', (_name, content, expected) => {
    const refs = extractor.extract(makeDoc(content));
    expect(refs.map((ref) => ref.value)).toEqual(expected);
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
});
