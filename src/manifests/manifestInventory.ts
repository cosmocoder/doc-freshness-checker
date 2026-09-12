import fs from 'fs';
import path from 'path';
import semver from 'semver';
import type { DocFreshnessConfig } from '../types.js';
import { parseCargoDependencies, resolveCargoDependencies } from '../utils/cargoDependencies.js';
import { parseGoModRequirements } from '../utils/goMod.js';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import { canonicalizePythonPackageName, parsePyprojectDependencies, parseRequirementsDependencies } from '../utils/pythonDependencies.js';

type DependencyParser = (content: string) => string[];
type VersionParser = (content: string) => Map<string, string>;

interface ManifestFormat {
  dependency: DependencyParser;
  version?: VersionParser;
  python?: boolean;
}

export interface VersionCandidate {
  version: string;
  sourceIndex: number;
}

interface DependencyProjection {
  all: ReadonlySet<string>;
  python: ReadonlySet<string>;
}

interface VersionProjection {
  all: ReadonlyMap<string, VersionCandidate>;
  python: ReadonlyMap<string, VersionCandidate>;
}

const manifestFormats: Record<string, ManifestFormat> = {
  'package.json': {
    dependency: (content) => {
      const json = JSON.parse(content) as Record<string, Record<string, unknown>>;
      return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) => Object.keys(json[key] || {}));
    },
    version: (content) => {
      const json = JSON.parse(content);
      const versions = new Map<string, string>();

      for (const [name, version] of Object.entries(json.peerDependencies || {})) {
        versions.set(name.toLowerCase(), normalizePeerVersion(version as string));
      }
      for (const [name, version] of Object.entries({
        ...json.dependencies,
        ...json.devDependencies,
        ...json.optionalDependencies,
      }) as Array<[string, string]>) {
        versions.set(name.toLowerCase(), normalizeVersion(version));
      }
      if (json.engines?.node) {
        versions.set('node', normalizeVersion(json.engines.node));
        versions.set('nodejs', normalizeVersion(json.engines.node));
      }
      if (json.engines?.npm) {
        versions.set('npm', normalizeVersion(json.engines.npm));
      }
      return versions;
    },
  },
  'requirements.txt': {
    dependency: (content) => Array.from(parseRequirementsDependencies(content).keys()),
    version: parseRequirementsDependencies,
    python: true,
  },
  'pyproject.toml': {
    dependency: (content) => Array.from(parsePyprojectDependencies(content).keys()),
    version: parsePyprojectDependencies,
    python: true,
  },
  'go.mod': {
    dependency: (content) => parseGoModRequirements(content).map(([modulePath]) => modulePath),
    version: (content) => {
      const versions = new Map<string, string>();
      const goVersion = content.match(/^go\s+(\d+\.\d+)/m)?.[1];
      if (goVersion) {
        versions.set('go', goVersion);
        versions.set('golang', goVersion);
      }
      for (const [modulePath, version] of parseGoModRequirements(content)) {
        versions.set(modulePath, normalizeVersion(version));
      }
      return versions;
    },
  },
  'Cargo.toml': {
    dependency: (content) => parseCargoDependencies(content).map(({ name }) => name),
  },
  'pom.xml': {
    dependency: (content) => Array.from(content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g), (match) => match[1]),
    version: (content) => {
      const versions = new Map<string, string>();
      const javaVersion = content.match(/<java\.version>([^<]+)<\/java\.version>/)?.[1];
      if (javaVersion) {
        versions.set('java', javaVersion);
      }
      for (const match of content.matchAll(
        /<dependency>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g
      )) {
        versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
      }
      return versions;
    },
  },
};

function normalizeVersion(version: string): string {
  return version ? version.replace(/^[\^~>=<]+/, '').replace(/\.x$/i, '.0') : 'any';
}

function normalizePeerVersion(version: string): string {
  const range = semver.validRange(version);
  const minimum = range && semver.minVersion(range);
  return minimum && semver.subset(range, `${minimum.major}.x`) ? minimum.version : 'any';
}

function setCandidate(candidates: Map<string, VersionCandidate>, name: string, version: string, sourceIndex: number): void {
  const current = candidates.get(name);
  const equallyConcrete = current && (version === 'any') === (current.version === 'any');
  if (!current || (version !== 'any' && current.version === 'any') || (equallyConcrete && sourceIndex >= current.sourceIndex)) {
    candidates.set(name, { version, sourceIndex });
  }
}

interface ManifestConfig {
  paths: string[];
  contents: Map<string, Promise<string>>;
}

export class ManifestInventory {
  private contents = new Map<string, Promise<string>>();
  private dependencyState: Promise<DependencyProjection> | null = null;
  private versionState: Promise<VersionProjection> | null = null;
  private activeKey: string | null = null;

  dependencyNames(config: DocFreshnessConfig): Promise<DependencyProjection> {
    const manifestConfig = this.activate(config);
    if (!this.dependencyState) {
      const pending = this.loadDependencyNames(manifestConfig);
      this.dependencyState = pending;
      void pending.catch(() => {
        if (this.dependencyState === pending) {
          this.dependencyState = null;
        }
      });
    }
    return this.dependencyState;
  }

  packageVersions(config: DocFreshnessConfig): Promise<VersionProjection> {
    const manifestConfig = this.activate(config);
    if (!this.versionState) {
      const pending = this.loadPackageVersions(manifestConfig);
      this.versionState = pending;
      void pending.catch(() => {
        if (this.versionState === pending) {
          this.versionState = null;
        }
      });
    }
    return this.versionState;
  }

  private activate(config: DocFreshnessConfig): ManifestConfig {
    const paths = resolveManifestPaths(config);
    const key = JSON.stringify(paths);
    if (this.activeKey !== key) {
      this.activeKey = key;
      this.contents = new Map();
      this.dependencyState = null;
      this.versionState = null;
    }
    return { paths, contents: this.contents };
  }

  private async loadDependencyNames(config: ManifestConfig): Promise<DependencyProjection> {
    const all = new Set<string>();
    const python = new Set<string>();

    for (const manifestPath of config.paths) {
      const format = manifestFormats[path.basename(manifestPath)];
      if (!format) {
        continue;
      }
      try {
        for (const dependency of format.dependency(await this.read(manifestPath, config.contents))) {
          const name = dependency.toLowerCase();
          all.add(name);
          if (format.python) {
            python.add(canonicalizePythonPackageName(name));
          }
        }
      }
      catch (cause) {
        config.contents.delete(manifestPath);
        throw manifestError(manifestPath, cause);
      }
    }
    return { all, python };
  }

  private async loadPackageVersions(config: ManifestConfig): Promise<VersionProjection> {
    const all = new Map<string, VersionCandidate>();
    const python = new Map<string, VersionCandidate>();
    const cargoManifests: Array<{ entries: ReturnType<typeof parseCargoDependencies>; sourceIndex: number }> = [];

    for (const [sourceIndex, manifestPath] of config.paths.entries()) {
      const fileName = path.basename(manifestPath);
      if (fileName === 'Cargo.toml') {
        try {
          cargoManifests.push({ entries: parseCargoDependencies(await this.read(manifestPath, config.contents)), sourceIndex });
        }
        catch (cause) {
          config.contents.delete(manifestPath);
          throw manifestError(manifestPath, cause);
        }
        continue;
      }

      const format = manifestFormats[fileName];
      if (!format?.version) {
        continue;
      }
      try {
        const versions = format.version(await this.read(manifestPath, config.contents));
        for (const [name, version] of versions) {
          setCandidate(all, name, version, sourceIndex);
          if (format?.python) {
            python.set(canonicalizePythonPackageName(name), { version, sourceIndex });
          }
        }
      }
      catch (cause) {
        config.contents.delete(manifestPath);
        throw manifestError(manifestPath, cause);
      }
    }

    const cargoDependencies = cargoManifests.flatMap(({ entries, sourceIndex }) => entries.map((entry) => ({ ...entry, sourceIndex })));
    for (const [name, dependency] of resolveCargoDependencies(cargoDependencies)) {
      setCandidate(
        all,
        name,
        dependency.unresolvedWorkspaceReference ? 'any' : normalizeVersion(dependency.version),
        dependency.sourceIndex
      );
    }

    return { all, python };
  }

  private read(filePath: string, contents: Map<string, Promise<string>>): Promise<string> {
    let content = contents.get(filePath);
    if (!content) {
      content = fs.promises.readFile(filePath, 'utf-8');
      contents.set(filePath, content);
    }
    return content;
  }
}

function manifestError(manifestPath: string, cause: unknown): Error {
  return new Error(`Failed to load manifest: ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}

const inventories = new WeakMap<object, ManifestInventory>();

export function inventoryFor(owner: object): ManifestInventory {
  let inventory = inventories.get(owner);
  if (!inventory) {
    inventory = new ManifestInventory();
    inventories.set(owner, inventory);
  }
  return inventory;
}

export function attachInventory(owner: object, inventory: ManifestInventory): void {
  inventories.set(owner, inventory);
}
