import path from 'path';

/**
 * Returns true if candidatePath is equal to or nested within rootDir.
 */
export function isWithinRoot(candidatePath: string, rootDir: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(resolvedRoot + path.sep)
  );
}

/**
 * Resolve project root from config or process cwd.
 */
export function resolveProjectRoot(configRootDir?: string): string {
  return path.resolve(configRootDir || process.cwd());
}

/**
 * Resolve a document directory relative to project root.
 */
export function resolveDocumentDir(rootDir: string, documentPath: string): string {
  return path.dirname(path.resolve(rootDir, documentPath));
}
