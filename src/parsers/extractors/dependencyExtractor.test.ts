import { DependencyExtractor } from './dependencyExtractor.js';
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

describe('DependencyExtractor', () => {
  const extractor = new DependencyExtractor();

  it('extracts npm scoped packages in backticks', () => {
    const doc = makeDoc('Install `@types/node` for types');
    const refs = extractor.extract(doc);
    expect(refs.some((r) => r.value === '@types/node')).toBe(true);
  });

  it('extracts regular npm packages in backticks', () => {
    const doc = makeDoc('Use `express` and `commander` for CLI');
    const refs = extractor.extract(doc);
    const values = refs.map((r) => r.value);
    expect(values).toContain('express');
    expect(values).toContain('commander');
  });

  it('extracts Go packages', () => {
    const doc = makeDoc('Import `github.com/gin-gonic/gin`');
    const refs = extractor.extract(doc);
    expect(refs.some((r) => r.value === 'github.com/gin-gonic/gin' && r.ecosystem === 'go')).toBe(true);
  });

  it('filters out common words and short names', () => {
    const doc = makeDoc('Use `true`, `false`, `null`, `ab`, `config`');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(0);
  });

  it('filters out file extensions', () => {
    const doc = makeDoc('Edit `styles.css` and `app.tsx`');
    const refs = extractor.extract(doc);
    expect(refs).toHaveLength(0);
  });

  it('respects configured ecosystems', () => {
    const npmOnly = new DependencyExtractor({ ecosystems: ['npm'] });
    const doc = makeDoc('Use `express` and `github.com/gin-gonic/gin`');
    const refs = npmOnly.extract(doc);
    expect(refs.every((r) => r.ecosystem === 'npm')).toBe(true);
  });
});
