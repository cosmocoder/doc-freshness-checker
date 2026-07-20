import type { ValidationResult } from '../types.js';
import { escapeMarkdownTableCell } from '../utils/escapeMarkdownTableCell.js';

export function normalizeMarkdownIssueCells(issue: ValidationResult): {
  readonly isError: boolean;
  readonly message: string;
  readonly suggestion: string;
} {
  const isError = issue.severity === 'error';
  const suggestion = escapeMarkdownTableCell(issue.suggestion || '-');
  const message = escapeMarkdownTableCell(issue.message || '');
  return { isError, message, suggestion };
}
