import fs from 'fs';
import path from 'path';

/**
 * Returns true if candidatePath is equal to or nested within rootDir.
 */
export function isWithinRoot(candidatePath: string, rootDir: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

/**
 * Resolves symlinks in both paths, so a link inside rootDir that points outside it reports 'outside'.
 */
export async function locateRealPath(candidatePath: string, rootDir: string): Promise<'inside' | 'outside' | 'missing'> {
  let realCandidate: string;
  try {
    realCandidate = await fs.promises.realpath(candidatePath);
  }
  catch {
    return 'missing';
  }
  const realRoot = await fs.promises.realpath(rootDir).catch(() => path.resolve(rootDir));
  return isWithinRoot(realCandidate, realRoot) ? 'inside' : 'outside';
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
