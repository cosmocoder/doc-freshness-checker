import type { Document, DocumentFormat, Reference } from '../types.js';

export function makeDoc(overrides: Partial<Document> = {}): Document {
  const docPath = overrides.path ?? 'doc.md';
  const absolutePath = overrides.absolutePath ?? `/project/${docPath}`;
  const format = overrides.format ?? 'markdown';

  return {
    path: docPath,
    absolutePath,
    content: '',
    format: format as DocumentFormat,
    lines: [],
    references: [],
    ...overrides,
  };
}

export function makeRef(type: string, value: string, overrides: Partial<Reference> = {}): Reference {
  return {
    type,
    value,
    lineNumber: 1,
    raw: value,
    sourceFile: 'doc.md',
    ...overrides,
  };
}
