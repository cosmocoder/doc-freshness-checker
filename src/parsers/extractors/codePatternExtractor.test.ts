import { CodePatternExtractor } from './codePatternExtractor.js';
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

describe('CodePatternExtractor', () => {
  const extractor = new CodePatternExtractor();

  it('extracts class and function names from TypeScript code blocks', () => {
    const doc = makeDoc(
      ['```typescript', 'class ValidationEngine {', '  constructor() {}', '}', 'function runCheck() {}', '```'].join('\n')
    );

    const refs = extractor.extract(doc);
    expect(refs.map((r) => r.value)).toContain('ValidationEngine');
    expect(refs.map((r) => r.value)).toContain('runCheck');
  });

  it('extracts interfaces and types from TypeScript', () => {
    const doc = makeDoc(['```ts', 'interface ConfigOptions {}', 'type ResultType = string;', '```'].join('\n'));

    const refs = extractor.extract(doc);
    expect(refs.map((r) => r.value)).toContain('ConfigOptions');
    expect(refs.map((r) => r.value)).toContain('ResultType');
  });

  it('extracts Python symbols', () => {
    const doc = makeDoc(['```python', 'class UserService:', '    def get_user(self):', '        pass', '```'].join('\n'));

    const refs = extractor.extract(doc);
    expect(refs.map((r) => r.value)).toContain('UserService');
    expect(refs.map((r) => r.value)).toContain('get_user');
  });

  it('marks illustrative symbols', () => {
    const doc = makeDoc(['```javascript', 'class YourComponent {}', 'function FooBar() {}', '```'].join('\n'));

    const refs = extractor.extract(doc);
    const illustrative = refs.filter((r) => r.isIllustrative);
    expect(illustrative.length).toBeGreaterThan(0);
  });

  it('ignores non-code blocks', () => {
    const doc = makeDoc('class NotInBlock {}');
    expect(extractor.extract(doc)).toHaveLength(0);
  });

  it('detects language from code block tag', () => {
    const doc = makeDoc(['```go', 'type ServerConfig struct {}', 'func HandleRequest() {}', '```'].join('\n'));

    const refs = extractor.extract(doc);
    expect(refs.some((r) => r.language === 'go')).toBe(true);
    expect(refs.map((r) => r.value)).toContain('ServerConfig');
  });
});
