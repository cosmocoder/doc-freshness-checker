import { DirectoryStructureExtractor } from './directoryStructureExtractor.js';
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

describe('DirectoryStructureExtractor', () => {
  const extractor = new DirectoryStructureExtractor();

  it('extracts paths from ASCII tree structures', () => {
    const tree = [
      '```',
      'src/',
      '├── index.ts',
      '├── utils/',
      '│   └── helper.ts',
      '└── config/',
      '    └── defaults.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).toContain('src');
    expect(values).toContain('src/index.ts');
    expect(values).toContain('src/utils');
    expect(values).toContain('src/utils/helper.ts');
    expect(values).toContain('src/config');
    expect(values).toContain('src/config/defaults.ts');
  });

  it('ignores code blocks without tree characters', () => {
    const doc = makeDoc('```\nconst x = 1;\n```');
    expect(extractor.extract(doc)).toHaveLength(0);
  });

  it('marks illustrative paths', () => {
    const tree = [
      '```',
      'project/',
      '├── YourComponent.tsx',
      '└── real-file.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const illustrative = refs.filter((r) => r.isIllustrative);
    expect(illustrative.length).toBeGreaterThan(0);
  });

  it('skips comments and ellipsis entries', () => {
    const tree = [
      '```',
      'src/',
      '├── ...',
      '├── # comment',
      '└── real.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).not.toContain('...');
    expect(values).not.toContain('# comment');
  });

  it('handles backtick-dash style trees', () => {
    const tree = [
      '```',
      'root/',
      '├── file.ts',
      '└── nested/',
      '    └── deep.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).toContain('root/file.ts');
    expect(values).toContain('root/nested');
    expect(values).toContain('root/nested/deep.ts');
  });

  it('skips separator and dash entries', () => {
    const tree = [
      '```',
      'src/',
      '├── -',
      '├── ---',
      '├── ___',
      '├── ===',
      '└── real.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).not.toContain('-');
    expect(values).not.toContain('---');
    expect(values).toContain('src/real.ts');
  });

  it('skips short single-segment paths', () => {
    const tree = [
      '```',
      'ab',
      '├── long-name.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).not.toContain('ab');
    expect(values).toContain('ab/long-name.ts');
  });

  it('handles backtick-dash connector in trees', () => {
    const tree = [
      '```',
      'project/',
      '├── src/',
      '│   └── index.ts',
      '`-- config.ts',
      '```',
    ].join('\n');

    const refs = extractor.extract(makeDoc(tree));
    const values = refs.map((r) => r.value);
    expect(values).toContain('project');
    expect(values).toContain('project/config.ts');
  });

  it('extracts from restructuredtext format', () => {
    const content = [
      '.. code-block::',
      '',
      '   project/',
      '   ├── src/',
      '   │   └── main.ts',
      '   └── README.md',
    ].join('\n');

    const doc = {
      path: 'docs/test.rst', absolutePath: '/project/docs/test.rst',
      content, format: 'restructuredtext' as const, lines: content.split('\n'), references: [],
    };
    const refs = extractor.extract(doc);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('extracts from asciidoc format', () => {
    const content = [
      '----',
      'project/',
      '├── src/',
      '│   └── main.ts',
      '----',
    ].join('\n');

    const doc = {
      path: 'docs/test.adoc', absolutePath: '/project/docs/test.adoc',
      content, format: 'asciidoc' as const, lines: content.split('\n'), references: [],
    };
    const refs = extractor.extract(doc);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('handles plaintext format with fallback to markdown pattern', () => {
    const tree = [
      '```',
      'app/',
      '├── main.py',
      '```',
    ].join('\n');

    const doc = {
      path: 'docs/test.txt', absolutePath: '/project/docs/test.txt',
      content: tree, format: 'plaintext' as const, lines: tree.split('\n'), references: [],
    };
    const refs = extractor.extract(doc);
    expect(refs.length).toBeGreaterThan(0);
  });

  it('uses custom illustrative patterns from config', () => {
    const ext = new DirectoryStructureExtractor({
      rules: { 'directory-structure': { illustrativePatterns: ['^custom-'] } },
    });
    const tree = [
      '```',
      'project/',
      '├── custom-example.ts',
      '└── real.ts',
      '```',
    ].join('\n');

    const refs = ext.extract(makeDoc(tree));
    const illustrative = refs.filter((r) => r.isIllustrative);
    expect(illustrative.some((r) => r.value.includes('custom-example'))).toBe(true);
  });
});
