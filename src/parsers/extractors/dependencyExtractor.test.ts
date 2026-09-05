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

  it('extracts underscore PyPI names without treating dotted names as packages by default', () => {
    const refs = extractor.extract(makeDoc('Use `foo_bar`, `foo.bar`, and `foo-bar`'));
    expect(refs.map(({ value, ecosystem }) => ({ value, ecosystem }))).toEqual([
      { value: 'foo_bar', ecosystem: 'pypi' },
      { value: 'foo-bar', ecosystem: 'npm' },
    ]);
  });

  it('assigns ordinary packages to PyPI when npm is disabled', () => {
    const pypiOnly = new DependencyExtractor({ ecosystems: ['pypi'] });
    const refs = pypiOnly.extract(makeDoc('Use `requests`, `pytest-cov`, `foo_bar`, and `foo.bar`'));
    expect(refs.map(({ value, ecosystem }) => ({ value, ecosystem }))).toEqual([
      { value: 'foo_bar', ecosystem: 'pypi' },
      { value: 'foo.bar', ecosystem: 'pypi' },
      { value: 'requests', ecosystem: 'pypi' },
      { value: 'pytest-cov', ecosystem: 'pypi' },
    ]);
  });

  it.each(['go', 'crates'])('filters dotted names when PyPI is combined with %s', (otherEcosystem) => {
    const mixed = new DependencyExtractor({ ecosystems: ['pypi', otherEcosystem] });
    const refs = mixed.extract(makeDoc('Use `foo.bar` and edit `config.mjs`'));
    expect(refs).toHaveLength(0);
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
    const doc = makeDoc('Open `archive.zip`, `config.mjs`, `index.php`, `app.vue`, `schema.sql`, and `package.lock`');
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
