/**
 * Escape a string for safe inclusion in a Markdown table cell.
 * Escapes backslashes first (to prevent double-interpretation),
 * then pipe characters (to prevent cell boundary injection).
 */
export function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}
