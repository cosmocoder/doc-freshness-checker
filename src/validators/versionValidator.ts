import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import type { IncrementalInput } from './incrementalInputs.js';
import type { DocFreshnessConfig, Document, ManifestParser, Reference, ValidationResult } from '../types.js';
import { canonicalizePythonPackageName, parsePyprojectDependencies, parseRequirementsDependencies } from '../utils/pythonDependencies.js';

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

    const allDeps = { ...content.dependencies, ...content.devDependencies } as Record<string, string>;
    for (const [name, version] of Object.entries(allDeps)) {
      versions.set(name.toLowerCase(), normalizeVersion(version as string));
    }

    return versions;
  },

  // Python: requirements.txt
  'requirements.txt': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return parseRequirementsDependencies(content);
  },

  // Python: pyproject.toml
  'pyproject.toml': async (filePath: string): Promise<Map<string, string>> => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return parsePyprojectDependencies(content);
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
      for (const line of requireMatch[1].split('\n')) {
        const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)/);
        if (!match) {
          continue;
        }
        versions.set(match[1], normalizeVersion(match[2]));
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
      for (const line of depsMatch[1].split('\n')) {
        const match = line.match(/^([a-zA-Z0-9\-_]+)\s*=\s*"?([^"\n]+)"?/);
        if (!match) {
          continue;
        }
        versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
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

    for (const match of content.matchAll(
      /<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g
    )) {
      versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
    }

    return versions;
  },
};

function normalizeVersion(version: string): string {
  if (!version) {
    return 'any';
  }
  return version.replace(/^[\^~>=<]+/, '').replace(/\.x$/i, '.0');
}

interface VersionCandidate {
  version: string;
  sourceIndex: number;
}

/**
 * Validates version references against manifest files
 */
export class VersionValidator {
  private packageVersions: Map<string, VersionCandidate> | null;
  private pythonVersions: Map<string, VersionCandidate>;
  private technologyMap: Record<string, string[]>;
  private loadedFromKey: string | null;

  constructor() {
    this.packageVersions = null;
    this.pythonVersions = new Map();
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

  /** @internal */
  async getIncrementalInputs(_references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<IncrementalInput[]> {
    return resolveManifestPaths(config).map((manifestPath) => ({ path: manifestPath }));
  }

  private async loadPackageVersions(config: DocFreshnessConfig): Promise<void> {
    const manifestPaths = resolveManifestPaths(config);
    const configKey = manifestPaths.join('|');

    if (this.packageVersions && this.loadedFromKey === configKey) {
      return;
    }

    const packageVersions = new Map<string, VersionCandidate>();
    const pythonVersions = new Map<string, VersionCandidate>();

    for (const [sourceIndex, manifestPath] of manifestPaths.entries()) {
      const fileName = path.basename(manifestPath);
      const parser = manifestParsers[fileName];

      if (!parser) {
        continue;
      }

      try {
        const versions = await parser(manifestPath);
        for (const [name, version] of versions) {
          const candidate = { version, sourceIndex };
          packageVersions.set(name, candidate);
          if (fileName === 'pyproject.toml' || fileName === 'requirements.txt') {
            const canonicalName = canonicalizePythonPackageName(name);
            pythonVersions.set(canonicalName, candidate);
          }
        }
      }
      catch (cause) {
        throw new Error(`Failed to load manifest: ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }

    this.packageVersions = packageVersions;
    this.pythonVersions = pythonVersions;
    this.loadedFromKey = configKey;
  }

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
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
        const exactCandidate = this.packageVersions!.get(pkgName);
        const pythonCandidate = this.pythonVersions.get(canonicalizePythonPackageName(pkgName));
        const candidate =
          exactCandidate && pythonCandidate
            ? exactCandidate.sourceIndex >= pythonCandidate.sourceIndex
              ? exactCandidate
              : pythonCandidate
            : exactCandidate || pythonCandidate;
        if (candidate) {
          actualVersion = candidate.version;
          break;
        }
      }

      if (!actualVersion) {
        results.push({
          reference: ref,
          valid: true,
          message: `Could not find ${tech} in dependencies`,
        });
        continue;
      }
      if (actualVersion === 'any') {
        results.push({
          reference: ref,
          valid: true,
          message: `${ref.technology} is listed without an exact version; version comparison skipped`,
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
      }
      else {
        results.push({
          reference: ref,
          valid: true,
        });
      }
    }

    return results;
  }

  private getMajorVersion(version: string): number | null {
    const pythonRelease = version.match(/^(?:\d+!)?(\d+)(?:\.|$)/);
    if (pythonRelease) {
      return Number.parseInt(pythonRelease[1], 10);
    }
    const parsed = semver.coerce(version);
    return parsed ? parsed.major : null;
  }
}

export { manifestParsers };
