import type { VectorMismatch } from '../types.js';
import { escapeMarkdownTableCell } from '../utils/escapeMarkdownTableCell.js';

export function formatVectorMismatches(mismatches: VectorMismatch[] | undefined): string {
  if (!mismatches?.length) {
    return '';
  }

  let markdown = '## 🔍 Semantic Analysis (Vector Search)\n\n';
  markdown += '| Document | Section | Similarity | Best Match | Suggestion |\n';
  markdown += '|----------|---------|------------|------------|------------|\n';

  for (const mismatch of mismatches) {
    const bestMatch = mismatch.bestMatch ? `${mismatch.bestMatch.path} (${mismatch.bestMatch.symbol})` : '-';
    markdown += `| ${escapeMarkdownTableCell(mismatch.docPath)} | ${escapeMarkdownTableCell(mismatch.docSection)} | ${(mismatch.bestMatchScore * 100).toFixed(1)}% | ${escapeMarkdownTableCell(bestMatch)} | ${escapeMarkdownTableCell(mismatch.suggestion)} |\n`;
  }

  return `${markdown}\n`;
}
