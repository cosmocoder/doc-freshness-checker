import type { ValidationResult } from '../types.js';
import { escapeMarkdownTableCell } from '../utils/escapeMarkdownTableCell.js';

export function normalizeMarkdownIssueCells(issue: Pick<ValidationResult, 'message' | 'severity' | 'suggestion'>): {
  readonly isError: boolean;
  readonly isInfo: boolean;
  readonly message: string;
  readonly suggestion: string;
} {
  const isError = issue.severity === 'error';
  const isInfo = issue.severity === 'info';
  const suggestion = escapeMarkdownTableCell(issue.suggestion || '-');
  const message = escapeMarkdownTableCell(issue.message || '');
  return { isError, isInfo, message, suggestion };
}
