import type { VectorMismatch } from '../types.js';
import { formatVectorMismatches } from './formatVectorMismatches.js';

describe('formatVectorMismatches', () => {
  it('formats vector mismatches as a Markdown table and escapes cell delimiters', () => {
    const mismatches: VectorMismatch[] = [
      {
        docPath: 'docs\\api|v2.md',
        docSection: 'Auth | API',
        docText: 'Authentication docs',
        bestMatchScore: 0.234,
        bestMatch: { type: 'code', path: 'src\\auth|api.ts', symbol: 'sign|in', text: 'Sign in' },
        suggestion: 'Update \\ examples | references',
      },
    ];

    expect(formatVectorMismatches(mismatches)).toBe(
      '## 🔍 Semantic Analysis (Vector Search)\n\n' +
        '| Document | Section | Similarity | Best Match | Suggestion |\n' +
        '|----------|---------|------------|------------|------------|\n' +
        '| docs\\\\api\\|v2.md | Auth \\| API | 23.4% | src\\\\auth\\|api.ts (sign\\|in) | Update \\\\ examples \\| references |\n\n'
    );
  });

  it('returns an empty string when there are no vector mismatches', () => {
    expect(formatVectorMismatches(undefined)).toBe('');
    expect(formatVectorMismatches([])).toBe('');
  });
});
