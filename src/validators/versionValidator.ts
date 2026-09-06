import fs from 'fs';
import path from 'path';
import semver from 'semver';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import type { IncrementalInput } from './incrementalInputs.js';
import type { DocFreshnessConfig, Document, ManifestParser, Reference, ValidationResult } from '../types.js';
import { canonicalizePythonPackageName, parsePyprojectDependencies, parseRequirementsDependencies } from '../utils/pythonDependencies.js';
import { parseGoModRequirements } from '../utils/goMod.js';
import { parseCargoDependencies, resolveCargoDependencies } from '../utils/cargoDependencies.js';

/**
 * Manifest file parsers for different ecosystems
 */
const manifestParsers: Record<string, ManifestParser> = {
  // Node.js: package.json
  'package.json': async (filePath: string): Promise<Map<string, string>> => {
    const content = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
    const versions = new Map<string, string>();

    for (const [name, version] of Object.entries(content.peerDependencies || {})) {
      versions.set(name.toLowerCase(), normalizePeerVersion(version as string));
    }

    const allDeps = {
      ...content.dependencies,
      ...content.devDependencies,
      ...content.optionalDependencies,
    } as Record<string, string>;
    for (const [name, version] of Object.entries(allDeps)) {
      versions.set(name.toLowerCase(), normalizeVersion(version as string));
    }

    if (content.engines?.node) {
      versions.set('node', normalizeVersion(content.engines.node));
      versions.set('nodejs', normalizeVersion(content.engines.node));
    }
    if (content.engines?.npm) {
      versions.set('npm', normalizeVersion(content.engines.npm));
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

    for (const [modulePath, version] of parseGoModRequirements(content)) {
      versions.set(modulePath, normalizeVersion(version));
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

function normalizePeerVersion(version: string): string {
  const range = semver.validRange(version);
  const minimum = range && semver.minVersion(range);
  return minimum && semver.subset(range, `${minimum.major}.x`) ? minimum.version : 'any';
}

interface VersionCandidate {
  version: string;
  sourceIndex: number;
}

function setCandidate(candidates: Map<string, VersionCandidate>, name: string, version: string, sourceIndex: number): void {
  const current = candidates.get(name);
  const equallyConcrete = current && (version === 'any') === (current.version === 'any');
  if (!current || (version !== 'any' && current.version === 'any') || (equallyConcrete && sourceIndex >= current.sourceIndex)) {
    candidates.set(name, { version, sourceIndex });
  }
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
    const cargoManifests: Array<{ entries: ReturnType<typeof parseCargoDependencies>; sourceIndex: number }> = [];

    for (const [sourceIndex, manifestPath] of manifestPaths.entries()) {
      const fileName = path.basename(manifestPath);

      try {
        if (fileName === 'Cargo.toml') {
          const content = await fs.promises.readFile(manifestPath, 'utf-8');
          cargoManifests.push({ entries: parseCargoDependencies(content), sourceIndex });
          continue;
        }
        const parser = manifestParsers[fileName];
        if (!parser) {
          continue;
        }
        const versions = await parser(manifestPath);
        for (const [name, version] of versions) {
          setCandidate(packageVersions, name, version, sourceIndex);
          if (fileName === 'pyproject.toml' || fileName === 'requirements.txt') {
            const canonicalName = canonicalizePythonPackageName(name);
            pythonVersions.set(canonicalName, { version, sourceIndex });
          }
        }
      }
      catch (cause) {
        throw new Error(`Failed to load manifest: ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
      }
    }

    const cargoDependencies = cargoManifests.flatMap(({ entries, sourceIndex }) => entries.map((entry) => ({ ...entry, sourceIndex })));
    for (const [name, dependency] of resolveCargoDependencies(cargoDependencies)) {
      if (dependency.unresolvedWorkspaceReference) {
        setCandidate(packageVersions, name, 'any', dependency.sourceIndex);
      }
      else {
        setCandidate(packageVersions, name, normalizeVersion(dependency.version), dependency.sourceIndex);
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
