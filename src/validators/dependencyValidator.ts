import fs from 'fs';
import path from 'path';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import type { IncrementalInput } from './incrementalInputs.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';
import { canonicalizePythonPackageName, parsePyprojectDependencies, parseRequirementsDependencies } from '../utils/pythonDependencies.js';

/**
 * Validates that mentioned dependencies exist in manifest files
 */
export class DependencyValidator {
  private dependencies: Set<string> | null;
  private pythonDependencies: Set<string>;
  private loadedFromKey: string | null;

  constructor() {
    this.dependencies = null;
    this.pythonDependencies = new Set();
    this.loadedFromKey = null;
  }

  /** @internal */
  async getIncrementalInputs(_references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<IncrementalInput[]> {
    return resolveManifestPaths(config).map((manifestPath) => ({ path: manifestPath }));
  }

  private async loadDependencies(config: DocFreshnessConfig): Promise<void> {
    const manifestPaths = resolveManifestPaths(config);
    const configKey = manifestPaths.join('|');

    if (this.dependencies && this.loadedFromKey === configKey) {
      return;
    }

    const dependencies = new Set<string>();
    const pythonDependencies = new Set<string>();

    for (const manifestPath of manifestPaths) {
      const fileName = path.basename(manifestPath);
      const parser = manifestDependencyParsers[fileName];

      if (!parser) {
        continue;
      }

      try {
        const content = await fs.promises.readFile(manifestPath, 'utf-8');
        const deps = parser(content);
        for (const dep of deps) {
          dependencies.add(dep.toLowerCase());
          if (fileName === 'pyproject.toml' || fileName === 'requirements.txt') {
            pythonDependencies.add(canonicalizePythonPackageName(dep));
          }
        }
      }
      catch (cause) {
        throw new Error(`Failed to load manifest: ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }

    this.dependencies = dependencies;
    this.pythonDependencies = pythonDependencies;
    this.loadedFromKey = configKey;
  }

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    await this.loadDependencies(config);

    const results: ValidationResult[] = [];

    for (const ref of references) {
      const pkg = ref.value.toLowerCase();

      // Check if package exists in dependencies
      const found =
        ref.ecosystem === 'pypi'
          ? this.pythonDependencies.has(canonicalizePythonPackageName(pkg))
          : this.dependencies!.has(pkg) || (!ref.ecosystem && this.pythonDependencies.has(canonicalizePythonPackageName(pkg)));

      if (found) {
        results.push({
          reference: ref,
          valid: true,
        });
      }
      else {
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
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) => Object.keys(json[key] || {}));
  },
  'requirements.txt': (content) => Array.from(parseRequirementsDependencies(content).keys()),
  'pyproject.toml': (content) => Array.from(parsePyprojectDependencies(content).keys()),
  'go.mod': (content) => {
    const requireMatch = content.match(/require\s+\(([\s\S]*?)\)/);
    if (!requireMatch) {
      return [];
    }
    return requireMatch[1]
      .split('\n')
      .map((line) => line.trim().match(/^([^\s]+)/)?.[1])
      .filter((dep): dep is string => Boolean(dep));
  },
  'Cargo.toml': (content) => {
    const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (!depsMatch) {
      return [];
    }
    return depsMatch[1]
      .split('\n')
      .map((line) => line.match(/^([a-zA-Z0-9\-_]+)\s*=/)?.[1])
      .filter((dep): dep is string => Boolean(dep));
  },
  'pom.xml': (content) => Array.from(content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g), (match) => match[1]),
};
