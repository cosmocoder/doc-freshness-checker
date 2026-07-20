import type { BaseExtractor as BaseExtractorContract, Document, Extractor, Reference } from '../types.js';
import { BaseExtractor } from './extractors/baseExtractor.js';

const extract: Extractor['extract'] = (_document) => [];
const supportsFormat: Extractor['supportsFormat'] = (format) => format === 'markdown';

function acceptsExtractor(_extractor: Extractor): void {}

describe('Extractor contract', () => {
  it('accepts subclasses, the six-member legacy shape, and two-method objects', () => {
    class CustomExtractor extends BaseExtractor {
      override extract(_document: Document): Reference[] {
        return [];
      }
    }
    const sixMemberExtractor = {
      type: 'custom',
      supportedFormats: ['markdown'],
      supportsFormat,
      extract,
      findLineNumber: () => 1,
      getContext: () => '',
    } satisfies BaseExtractorContract;
    const twoMemberExtractor = { supportsFormat, extract } satisfies Extractor;

    acceptsExtractor(new CustomExtractor('custom'));
    acceptsExtractor(sixMemberExtractor);
    acceptsExtractor(twoMemberExtractor);
    expectTypeOf(twoMemberExtractor).toMatchTypeOf<Extractor>();
  });

  it('requires both synchronous extractor methods', () => {
    // @ts-expect-error Extractors must implement extract.
    acceptsExtractor({ supportsFormat });
    // @ts-expect-error Extractors must implement supportsFormat.
    acceptsExtractor({ extract });
    // @ts-expect-error Asynchronous extraction remains unsupported.
    acceptsExtractor({ supportsFormat, extract: async () => [] });
  });
});
