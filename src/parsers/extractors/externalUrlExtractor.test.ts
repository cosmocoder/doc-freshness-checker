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
    {
      name: 'strips trailing punctuation',
      content: 'See https://example.com. Also https://test.org,',
      expected: ['https://example.com', 'https://test.org'],
    },
    {
      name: 'preserves balanced parentheses in Wikipedia-style URLs',
      content: 'See https://en.wikipedia.org/wiki/Example_(disambiguation)',
      expected: ['https://en.wikipedia.org/wiki/Example_(disambiguation)'],
    },
    {
      name: 'strips unbalanced trailing parenthesis',
      content: '(visit https://example.com)',
      expected: ['https://example.com'],
    },
    {
      name: 'strips multiple trailing punctuation characters',
      content: 'See https://example.com/path...',
      expected: ['https://example.com/path'],
    },
    {
      name: 'handles URL ending with semicolon and colon',
      content: 'Visit https://example.com/page; and https://example.com/other:',
      expected: ['https://example.com/page', 'https://example.com/other'],
    },
    {
      name: 'handles multiple unbalanced trailing parens',
      content: '(see (https://example.com))',
      expected: ['https://example.com'],
    },
    {
      name: 'preserves URL with balanced nested parens',
      content: 'https://en.wikipedia.org/wiki/A_(B_(C))',
      expected: ['https://en.wikipedia.org/wiki/A_(B_(C))'],
    },
    {
      name: 'strips trailing bracket characters',
      content: '[https://example.com/page]',
      expected: ['https://example.com/page'],
    },
    {
      name: 'strips trailing single and double quotes',
      content: "see 'https://example.com/page'",
      expected: ['https://example.com/page'],
    },
    {
      name: 'strips trailing exclamation and question marks',
      content: 'Visit https://example.com/page! or https://example.com/other?',
      expected: ['https://example.com/page', 'https://example.com/other'],
    },
  ])('$name', ({ content, expected }) => {
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
