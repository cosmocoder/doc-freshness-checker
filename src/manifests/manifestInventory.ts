import fs from 'fs';
import path from 'path';
import type { DocFreshnessConfig, ManifestParser } from '../types.js';

type DependencyParser = (content: string) => string[];
type VersionParser = (content: string) => Map<string, string>;

interface ManifestFormat {
  dependency: DependencyParser;
  version: VersionParser;
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
      if (json.engines?.node) {
        versions.set('node', normalizeVersion(json.engines.node));
        versions.set('nodejs', normalizeVersion(json.engines.node));
      }
      if (json.engines?.npm) {
        versions.set('npm', normalizeVersion(json.engines.npm));
      }
      const dependencies = { ...json.dependencies, ...json.devDependencies } as Record<string, string>;
      for (const [name, version] of Object.entries(dependencies)) {
        versions.set(name.toLowerCase(), normalizeVersion(version));
      }
      return versions;
    },
  },
  'requirements.txt': {
    dependency: (content) =>
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => line.match(/^([a-zA-Z0-9\-_]+)/)?.[1])
        .filter((dependency): dependency is string => Boolean(dependency)),
    version: (content) => {
      const versions = new Map<string, string>();
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }
        const match = trimmed.match(/^([a-zA-Z0-9\-_]+)([<>=!]+)?(.+)?$/);
        if (!match) {
          continue;
        }
        versions.set(match[1].toLowerCase(), match[3] ? normalizeVersion(match[3]) : 'any');
      }
      return versions;
    },
  },
  'pyproject.toml': {
    dependency: (content) => {
      const dependencies = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\[|$)/);
      if (!dependencies) {
        return [];
      }
      return Array.from(dependencies[1].matchAll(/"([^"<>=!]+)/g), (match) => match[1].split(/[<>=!]/)[0]);
    },
    version: (content) => {
      const versions = new Map<string, string>();
      const dependencies = content.match(/\[project\.dependencies\]([\s\S]*?)(?:\[|$)/);
      if (dependencies) {
        const entries = Array.from(dependencies[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
        for (const dependency of entries) {
          const [name, version = 'any'] = dependency.split(/[<>=!]+/);
          if (name) {
            versions.set(name.toLowerCase(), version);
          }
        }
      }
      return versions;
    },
  },
  'go.mod': {
    dependency: (content) => {
      const requireBlock = content.match(/require\s+\(([\s\S]*?)\)/);
      if (!requireBlock) {
        return [];
      }
      return requireBlock[1]
        .split('\n')
        .map((line) => line.trim().match(/^([^\s]+)/)?.[1])
        .filter((dependency): dependency is string => Boolean(dependency));
    },
    version: (content) => {
      const versions = new Map<string, string>();
      const goVersion = content.match(/^go\s+(\d+\.\d+)/m);
      if (goVersion) {
        versions.set('go', goVersion[1]);
        versions.set('golang', goVersion[1]);
      }
      const requireBlock = content.match(/require\s+\(([\s\S]*?)\)/);
      if (requireBlock) {
        for (const line of requireBlock[1].split('\n')) {
          const match = line.trim().match(/^([^\s]+)\s+v?([^\s]+)/);
          if (match) {
            versions.set(match[1], normalizeVersion(match[2]));
          }
        }
      }
      return versions;
    },
  },
  'Cargo.toml': {
    dependency: (content) => {
      const dependencies = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (!dependencies) {
        return [];
      }
      return dependencies[1]
        .split('\n')
        .map((line) => line.match(/^([a-zA-Z0-9\-_]+)\s*=/)?.[1])
        .filter((dependency): dependency is string => Boolean(dependency));
    },
    version: (content) => {
      const versions = new Map<string, string>();
      const dependencies = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (dependencies) {
        for (const line of dependencies[1].split('\n')) {
          const match = line.match(/^([a-zA-Z0-9\-_]+)\s*=\s*"?([^"\n]+)"?/);
          if (match) {
            versions.set(match[1].toLowerCase(), normalizeVersion(match[2]));
          }
        }
      }
      return versions;
    },
  },
  'pom.xml': {
    dependency: (content) => Array.from(content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g), (match) => match[1]),
    version: (content) => {
      const versions = new Map<string, string>();
      const javaVersion = content.match(/<java\.version>([^<]+)<\/java\.version>/);
      if (javaVersion) {
        versions.set('java', javaVersion[1]);
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

const builtInManifestParsers: Record<string, ManifestParser> = Object.fromEntries(
  Object.entries(manifestFormats).map(([fileName, format]) => [
    fileName,
    async (filePath: string) => format.version(await fs.promises.readFile(filePath, 'utf-8')),
  ])
);

export const manifestParsers: Record<string, ManifestParser> = { ...builtInManifestParsers };

function normalizeVersion(version: string): string {
  if (!version) {
    return 'any';
  }
  return version.replace(/^[\^~>=<]+/, '').replace(/\.x$/i, '.0');
}

interface ManifestConfig {
  rootDir: string;
  files: string[];
  contents: Map<string, Promise<string | null>>;
}

export class ManifestInventory {
  private contents = new Map<string, Promise<string | null>>();
  private dependencyState: Promise<ReadonlySet<string>> | null = null;
  private versionState: Promise<ReadonlyMap<string, string>> | null = null;
  private activeKey: string | null = null;

  dependencyNames(config: DocFreshnessConfig): Promise<ReadonlySet<string>> {
    const manifestConfig = this.activate(config);
    this.dependencyState ??= this.loadDependencyNames(manifestConfig);
    return this.dependencyState;
  }

  packageVersions(config: DocFreshnessConfig): Promise<ReadonlyMap<string, string>> {
    const manifestConfig = this.activate(config);
    this.versionState ??= this.loadPackageVersions(manifestConfig);
    return this.versionState;
  }

  private activate(config: DocFreshnessConfig): ManifestConfig {
    const rootDir = config.rootDir || process.cwd();
    const files = config.manifestFiles || ['package.json'];
    const key = JSON.stringify([rootDir, files]);
    if (this.activeKey !== key) {
      this.activeKey = key;
      this.contents = new Map();
      this.dependencyState = null;
      this.versionState = null;
    }
    return { rootDir, files, contents: this.contents };
  }

  private async loadDependencyNames(config: ManifestConfig): Promise<ReadonlySet<string>> {
    const names = new Set<string>();
    for (const manifestPath of config.files) {
      const fullPath = path.join(config.rootDir, manifestPath);
      try {
        const content = await this.read(fullPath, config.contents);
        if (content === null) {
          continue;
        }
        const parser = manifestFormats[path.basename(manifestPath)]?.dependency;
        for (const dependency of parser ? parser(content) : []) {
          names.add(dependency.toLowerCase());
        }
      }
      catch {
        /* ignore this dependency projection */
      }
    }
    return names;
  }

  private async loadPackageVersions(config: ManifestConfig): Promise<ReadonlyMap<string, string>> {
    const versions = new Map<string, string>();
    for (const manifestPath of config.files) {
      const fileName = path.basename(manifestPath);
      const parser = manifestParsers[fileName];
      if (!parser) {
        continue;
      }
      try {
        const fullPath = path.join(config.rootDir, manifestPath);
        let manifestVersions: Map<string, string>;
        if (parser === builtInManifestParsers[fileName]) {
          const content = await this.read(fullPath, config.contents);
          if (content === null) {
            continue;
          }
          manifestVersions = manifestFormats[fileName].version(content);
        }
        else {
          manifestVersions = await parser(fullPath);
        }
        for (const [name, version] of manifestVersions) {
          versions.set(name, version);
        }
      }
      catch {
        /* ignore this version projection */
      }
    }
    return versions;
  }

  private read(filePath: string, contents: Map<string, Promise<string | null>>): Promise<string | null> {
    let content = contents.get(filePath);
    if (!content) {
      content = fs.promises.readFile(filePath, 'utf-8').catch(() => null);
      contents.set(filePath, content);
    }
    return content;
  }
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
