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
    const deps: string[] = [];

    switch (fileName) {
      case 'package.json': {
        const json = JSON.parse(content);
        deps.push(
          ...Object.keys(json.dependencies || {}),
          ...Object.keys(json.devDependencies || {}),
          ...Object.keys(json.peerDependencies || {}),
          ...Object.keys(json.optionalDependencies || {})
        );
        break;
      }

      case 'requirements.txt': {
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([a-zA-Z0-9\-_]+)/);
          if (match) deps.push(match[1]);
        }
        break;
      }

      case 'pyproject.toml': {
        const depsMatch = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\[|$)/);
        if (depsMatch) {
          const depMatches = depsMatch[1].match(/"([^"<>=!]+)/g) || [];
          for (const match of depMatches) {
            deps.push(match.replace(/"/g, '').split(/[<>=!]/)[0]);
          }
        }
        break;
      }

      case 'go.mod': {
        const requireMatch = content.match(/require\s+\(([\s\S]*?)\)/);
        if (requireMatch) {
          const lines = requireMatch[1].split('\n');
          for (const line of lines) {
            const match = line.trim().match(/^([^\s]+)/);
            if (match) deps.push(match[1]);
          }
        }
        break;
      }

      case 'Cargo.toml': {
        const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
        if (depsMatch) {
          const lines = depsMatch[1].split('\n');
          for (const line of lines) {
            const match = line.match(/^([a-zA-Z0-9\-_]+)\s*=/);
            if (match) deps.push(match[1]);
          }
        }
        break;
      }

      case 'pom.xml': {
        const depMatches = content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g);
        for (const match of depMatches) {
          deps.push(match[1]);
        }
        break;
      }
    }

    return deps;
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
