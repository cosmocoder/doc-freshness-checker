import fs from 'fs';
import path from 'path';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

/**
 * Validates that mentioned dependencies exist in manifest files
 */
export class DependencyValidator {
  private dependencies: Set<string> | null;
  private loadedFromKey: string | null;

  constructor() {
    this.dependencies = null;
    this.loadedFromKey = null;
  }

  private async loadDependencies(config: DocFreshnessConfig): Promise<void> {
    const rootDir = config.rootDir || process.cwd();
    const manifestFiles = config.manifestFiles || ['package.json'];
    const configKey = `${rootDir}::${manifestFiles.join('|')}`;

    if (this.dependencies && this.loadedFromKey === configKey) return;

    this.dependencies = new Set();
    this.loadedFromKey = configKey;

    for (const manifestPath of manifestFiles) {
      const fullPath = path.join(rootDir, manifestPath);
      const fileName = path.basename(manifestPath);

      try {
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const deps = await this.parseManifest(fileName, content);
        for (const dep of deps) {
          this.dependencies.add(dep.toLowerCase());
        }
      } catch {
        // Manifest not found
      }
    }
  }

  private async parseManifest(fileName: string, content: string): Promise<string[]> {
    const parser = manifestDependencyParsers[fileName];
    return parser ? parser(content) : [];
  }

  async validateBatch(
    references: Reference[],
    _document: Document,
    config: DocFreshnessConfig
  ): Promise<ValidationResult[]> {
    await this.loadDependencies(config);

    const results: ValidationResult[] = [];

    for (const ref of references) {
      const pkg = ref.value.toLowerCase();

      // Check if package exists in dependencies
      const found = this.dependencies!.has(pkg);

      if (found) {
        results.push({
          reference: ref,
          valid: true,
        });
      } else {
        results.push({
          reference: ref,
          valid: false,
          severity: config.rules?.dependency?.severity || 'info',
          message: `Package not found in dependencies: ${ref.value}`,
        });
      }
    }

    return results;
  }
}

const manifestDependencyParsers: Record<string, (content: string) => string[]> = {
  'package.json': (content) => {
    const json = JSON.parse(content) as Record<string, Record<string, unknown>>;
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
      .flatMap((key) => Object.keys(json[key] || {}));
  },
  'requirements.txt': (content) =>
    content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.match(/^([a-zA-Z0-9\-_]+)/)?.[1])
      .filter((dep): dep is string => Boolean(dep)),
  'pyproject.toml': (content) => {
    const depsMatch = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\[|$)/);
    if (!depsMatch) return [];
    return Array.from(
      depsMatch[1].matchAll(/"([^"<>=!]+)/g),
      (match) => match[1].split(/[<>=!]/)[0]
    );
  },
  'go.mod': (content) => {
    const requireMatch = content.match(/require\s+\(([\s\S]*?)\)/);
    if (!requireMatch) return [];
    return requireMatch[1]
      .split('\n')
      .map((line) => line.trim().match(/^([^\s]+)/)?.[1])
      .filter((dep): dep is string => Boolean(dep));
  },
  'Cargo.toml': (content) => {
    const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (!depsMatch) return [];
    return depsMatch[1]
      .split('\n')
      .map((line) => line.match(/^([a-zA-Z0-9\-_]+)\s*=/)?.[1])
      .filter((dep): dep is string => Boolean(dep));
  },
  'pom.xml': (content) =>
    Array.from(content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g), (match) => match[1]),
};
