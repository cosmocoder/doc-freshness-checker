import path from 'path';
import type { DocFreshnessConfig } from '../types.js';

export function resolveManifestPaths(config: DocFreshnessConfig): string[] {
  const rootDir = config.rootDir || process.cwd();
  return (config.manifestFiles || ['package.json']).map((manifest) => path.join(rootDir, manifest));
}
