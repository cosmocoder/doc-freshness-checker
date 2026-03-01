import fs from 'fs';
import path from 'path';
import semver from 'semver';
import type { DocFreshnessConfig, Document, ManifestParser, Reference, ValidationResult } from '../types.js';

/**
 * Manifest file parsers for different ecosystems
 */
const manifestParsers: Record<string, ManifestParser> = {
  // Node.js: package.json
  'package.json': async (filePath: string): Promise<Map<string, string>> => {
    const content = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
    const versions = new Map<string, string>();

    if (content.engines?.node) {
      versions.set('node', normalizeVersion(content.engines.node));
      versions.set('nodejs', normalizeVersion(content.engines.node));
    }
    if (content.engines?.npm) {
      versions.set('npm', normalizeVersion(content.engines.npm));
    }

    const allDeps = { ...content.dependencies, ...content.devDependencies };
    for (const [name, version] of Object.entries(allDeps)) {
      versions.set(name.toLowerCase(), normalizeVersion(version as string));
    }

    return versions;
  },

  // Python: requirements.txt
  'requirements.txt': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const versions = new Map<string, string>();

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([a-zA-Z0-9\-_]+)([<>=!]+)?(.+)?$/);
      if (match) {
        const pkg = match[1].toLowerCase();
        const version = match[3] ? normalizeVersion(match[3]) : 'any';
        versions.set(pkg, version);
      }
    }

    return versions;
  },

  // Python: pyproject.toml
  'pyproject.toml': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const versions = new Map<string, string>();

    // Basic TOML parsing for dependencies
    const depsMatch = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depsMatch) {
      const depsSection = depsMatch[1];
      const depLines = depsSection.match(/"([^"]+)"/g) || [];
      for (const dep of depLines) {
        const clean = dep.replace(/"/g, '');
        const parts = clean.split(/[<>=!]+/);
        if (parts[0]) {
          versions.set(parts[0].toLowerCase(), parts[1] || 'any');
        }
      }
    }

    return versions;
  },

  // Go: go.mod
  'go.mod': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const versions = new Map<string, string>();

    const goMatch = content.match(/^go\s+(\d+\.\d+)/m);
    if (goMatch) {
      versions.set('go', goMatch[1]);
      versions.set('golang', goMatch[1]);
    }

    const requireMatch = content.match(/require\s+\(([\s\S]*?)\)/);
    if (requireMatch) {
      const lines = requireMatch[1].split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)/);
        if (match) {
          versions.set(match[1], normalizeVersion(match[2]));
        }
      }
    }

    return versions;
  },

  // Rust: Cargo.toml
  'Cargo.toml': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const versions = new Map<string, string>();

    const depsMatch = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
    if (depsMatch) {
      const depsSection = depsMatch[1];
      const depLines = depsSection.split('\n');
      for (const line of depLines) {
        const match = line.match(/^([a-zA-Z0-9\-_]+)\s*=\s*"?([^"\n]+)"?/);
        if (match) {
          versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
        }
      }
    }

    return versions;
  },

  // Java: pom.xml (basic parsing)
  'pom.xml': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const versions = new Map<string, string>();

    const javaMatch = content.match(/<java\.version>([^<]+)<\/java\.version>/);
    if (javaMatch) {
      versions.set('java', javaMatch[1]);
    }

    const depMatches = content.matchAll(
      /<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g
    );
    for (const match of depMatches) {
      versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
    }

    return versions;
  },
};

function normalizeVersion(version: string): string {
  if (!version) return 'any';
  return version.replace(/^[\^~>=<]+/, '').replace(/\.x$/i, '.0');
}

/**
 * Validates version references against manifest files
 */
export class VersionValidator {
  private packageVersions: Map<string, string> | null;
  private technologyMap: Record<string, string[]>;
  private loadedFromKey: string | null;

  constructor() {
    this.packageVersions = null;
    this.loadedFromKey = null;
    this.technologyMap = {
      react: ['react'],
      typescript: ['typescript'],
      node: ['node'],
      nodejs: ['node'],
      python: ['python'],
      go: ['go'],
      rust: ['rust'],
      java: ['java'],
    };
  }

  private async loadPackageVersions(config: DocFreshnessConfig): Promise<void> {
    const rootDir = config.rootDir || process.cwd();
    const manifestFiles = config.manifestFiles || ['package.json'];
    const configKey = `${rootDir}::${manifestFiles.join('|')}`;

    if (this.packageVersions && this.loadedFromKey === configKey) return;

    this.packageVersions = new Map();
    this.loadedFromKey = configKey;

    for (const manifestPath of manifestFiles) {
      const fullPath = path.join(rootDir, manifestPath);
      const fileName = path.basename(manifestPath);
      const parser = manifestParsers[fileName];

      if (!parser) continue;

      try {
        const versions = await parser(fullPath);
        for (const [name, version] of versions) {
          this.packageVersions.set(name, version);
        }
      } catch {
        // Manifest file not found or parse error
      }
    }
  }

  async validateBatch(
    references: Reference[],
    _document: Document,
    config: DocFreshnessConfig
  ): Promise<ValidationResult[]> {
    await this.loadPackageVersions(config);

    const results: ValidationResult[] = [];

    for (const ref of references) {
      if (!ref.technology) {
        results.push({ reference: ref, valid: true });
        continue;
      }

      const tech = ref.technology.toLowerCase();
      const docVersion = ref.version;

      // Find actual version
      const pkgNames = this.technologyMap[tech] || [tech];
      let actualVersion: string | null = null;

      for (const pkgName of pkgNames) {
        if (this.packageVersions!.has(pkgName)) {
          actualVersion = this.packageVersions!.get(pkgName)!;
          break;
        }
      }

      if (!actualVersion || actualVersion === 'any') {
        results.push({
          reference: ref,
          valid: true,
          message: `Could not find ${tech} in dependencies`,
        });
        continue;
      }

      // Compare versions
      const docMajor = this.getMajorVersion(docVersion || '');
      const actualMajor = this.getMajorVersion(actualVersion);

      if (docMajor !== null && actualMajor !== null && docMajor !== actualMajor) {
        results.push({
          reference: ref,
          valid: false,
          severity: config.rules?.version?.severity || 'warning',
          message: `Version mismatch: doc says ${ref.technology} ${docVersion}, actual is ${actualVersion}`,
          suggestion: `Update to ${ref.technology} ${actualVersion}`,
        });
      } else {
        results.push({
          reference: ref,
          valid: true,
        });
      }
    }

    return results;
  }

  private getMajorVersion(version: string): number | null {
    const parsed = semver.coerce(version);
    return parsed ? parsed.major : null;
  }
}

export { manifestParsers };
