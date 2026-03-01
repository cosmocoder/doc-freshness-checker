import { VersionExtractor } from './versionExtractor.js';
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

describe('VersionExtractor', () => {
  const extractor = new VersionExtractor();

  it('extracts technology version references', () => {
    const doc = makeDoc('Requires Node.js 18.0.0 and TypeScript 5.0');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ technology: 'Node.js', version: '18.0.0' });
    expect(refs[1]).toMatchObject({ technology: 'TypeScript', version: '5.0' });
  });

  it('handles v-prefixed versions', () => {
    const doc = makeDoc('Uses React v18.2.0');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0].version).toBe('18.2.0');
  });

  it('handles .x wildcard versions', () => {
    const doc = makeDoc('Supports Python 3.x');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0].version).toBe('3.x');
  });

  it('respects custom technologies config', () => {
    const custom = new VersionExtractor({ technologies: ['CustomTool'] });
    const doc = makeDoc('Uses CustomTool 2.0 and React 18.0');
    const refs = custom.extract(doc);
    expect(refs).toHaveLength(1);
    expect(refs[0].technology).toBe('CustomTool');
  });

  it('does not extract versions without known technology prefix', () => {
    const doc = makeDoc('Version 1.0.0 of something');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(0);
  });

  it.each([
    ['Docker 24.0', 'Docker', '24.0'],
    ['PostgreSQL 16', 'PostgreSQL', '16'],
    ['Go 1.21', 'Go', '1.21'],
    ['Redis 7.2.1', 'Redis', '7.2.1'],
  ])('extracts %s => tech=%s version=%s', (input, tech, version) => {
    const refs = extractor.extract(makeDoc(input));
    expect(refs[0]).toMatchObject({ technology: tech, version });
  });
});
