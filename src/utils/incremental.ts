import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isWithinRoot } from './pathSecurity.js';
import type { IncrementalInput } from '../validators/incrementalInputs.js';
import type { DocFreshnessConfig, Document, IncrementalStats } from '../types.js';

const STATE_VERSION = 2;
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules']);

interface IncrementalState {
  version: typeof STATE_VERSION;
  documentHashes: Record<string, string>;
  configFingerprint: string | null;
  inputFingerprint: string | null;
  clean: boolean;
}

/**
 * Incremental checker for skipping unchanged documentation files.
 * Skipping is allowed only after a clean run with unchanged validation inputs.
 */
export class IncrementalChecker {
  private stateDir: string;
  private stateFile: string;
  private previousState: IncrementalState | null;
  private currentHashes: Map<string, string>;
  private configFingerprint: string | null;
  private inputFingerprint: string | null;
  private verbose: boolean;

  constructor(stateDir: string = '.doc-freshness-cache') {
    this.stateDir = stateDir;
    this.stateFile = path.join(stateDir, 'file-hashes.json');
    this.previousState = null;
    this.currentHashes = new Map();
    this.configFingerprint = null;
    this.inputFingerprint = null;
    this.verbose = false;
  }

  async loadState(): Promise<void> {
    this.previousState = null;
    try {
      const value: unknown = JSON.parse(await fs.promises.readFile(this.stateFile, 'utf-8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        this.logFullValidation('saved state is not an object');
        return;
      }
      const parsed = value as Partial<IncrementalState>;
      if (parsed.version !== STATE_VERSION) {
        this.logFullValidation('saved state version is incompatible');
        return;
      }
      if (!parsed.documentHashes || typeof parsed.documentHashes !== 'object' || Array.isArray(parsed.documentHashes)) {
        this.logFullValidation('saved document hashes are invalid');
        return;
      }
      if (typeof parsed.clean !== 'boolean') {
        this.logFullValidation('saved clean status is invalid');
        return;
      }
      if (typeof parsed.configFingerprint !== 'string' && parsed.configFingerprint !== null) {
        this.logFullValidation('saved config fingerprint is invalid');
        return;
      }
      if (typeof parsed.inputFingerprint !== 'string' && parsed.inputFingerprint !== null) {
        this.logFullValidation('saved input fingerprint is invalid');
        return;
      }
      this.previousState = parsed as IncrementalState;
    }
    catch (error) {
      this.logFullValidation(
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no saved state exists' : 'saved state could not be read'
      );
    }
  }

  async saveState(clean: boolean = true): Promise<void> {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
    const state: IncrementalState = {
      version: STATE_VERSION,
      documentHashes: Object.fromEntries(this.currentHashes),
      configFingerprint: this.configFingerprint,
      inputFingerprint: this.inputFingerprint,
      clean,
    };
    await fs.promises.writeFile(this.stateFile, JSON.stringify(state, null, 2));
  }

  async getHash(filePath: string): Promise<string> {
    return hash(await fs.promises.readFile(filePath, 'utf-8'));
  }

  /**
   * @deprecated This compatibility method always returns true; use the configured runner for safe incremental reuse.
   */
  async shouldCheck(filePath: string): Promise<boolean> {
    try {
      this.currentHashes.set(filePath, await this.getHash(filePath));
    }
    catch {
      // Unreadable inputs must be checked.
    }
    return true;
  }

  /**
   * @deprecated This compatibility overload always full-validates; use the configured runner for safe incremental reuse.
   */
  filterChanged(documents: Document[]): Promise<Document[]>;
  /** @internal */
  filterChanged(
    documents: Document[],
    config?: DocFreshnessConfig,
    incrementalInputs?: readonly IncrementalInput[] | null,
    inventoryExclusions?: readonly string[]
  ): Promise<Document[]>;
  async filterChanged(
    documents: Document[],
    config?: DocFreshnessConfig,
    incrementalInputs?: readonly IncrementalInput[] | null,
    inventoryExclusions: readonly string[] = []
  ): Promise<Document[]> {
    this.verbose = config?.verbose === true;
    await this.loadState();
    this.configFingerprint = config ? this.getConfigFingerprint(config) : null;
    this.inputFingerprint =
      config && this.configFingerprint !== null ? await this.getInputFingerprint(config, incrementalInputs, inventoryExclusions) : null;

    if (!config) {
      this.logFullValidation('configuration was not provided');
    }

    const changed: Document[] = [];
    for (const doc of documents) {
      const documentHash = hash(doc.content);
      this.currentHashes.set(doc.absolutePath, documentHash);
      if (documentHash !== this.previousState?.documentHashes[doc.absolutePath]) {
        changed.push(doc);
      }
    }

    const canSkip =
      config !== undefined &&
      incrementalInputs !== undefined &&
      incrementalInputs !== null &&
      this.previousState?.clean === true &&
      this.configFingerprint !== null &&
      this.inputFingerprint !== null &&
      this.configFingerprint === this.previousState.configFingerprint &&
      this.inputFingerprint === this.previousState.inputFingerprint;

    if (this.previousState?.clean === false) {
      this.logFullValidation('the previous validation was not clean');
    }
    if (
      this.configFingerprint !== null &&
      typeof this.previousState?.configFingerprint === 'string' &&
      this.configFingerprint !== this.previousState.configFingerprint
    ) {
      this.logFullValidation('configuration changed');
    }
    else if (this.configFingerprint !== null && this.previousState?.configFingerprint === null) {
      this.logFullValidation('the saved config fingerprint is unavailable');
    }
    if (
      this.inputFingerprint !== null &&
      typeof this.previousState?.inputFingerprint === 'string' &&
      this.inputFingerprint !== this.previousState.inputFingerprint
    ) {
      this.logFullValidation('validation inputs changed');
    }
    else if (this.inputFingerprint !== null && this.previousState?.inputFingerprint === null) {
      this.logFullValidation('the saved input fingerprint is unavailable');
    }

    return canSkip ? changed : documents;
  }

  getStats(totalDocs: number, changedDocs: number): IncrementalStats {
    return {
      total: totalDocs,
      changed: changedDocs,
      skipped: totalDocs - changedDocs,
      percentSkipped: totalDocs > 0 ? Math.round(((totalDocs - changedDocs) / totalDocs) * 100) : 0,
    };
  }

  private getConfigFingerprint(config: DocFreshnessConfig): string | null {
    if (config.customExtractors?.length) {
      this.logFullValidation('custom extractors cannot be fingerprinted');
      return null;
    }
    if (Object.keys(config.customValidators || {}).length > 0) {
      this.logFullValidation('custom validators cannot be fingerprinted');
      return null;
    }

    try {
      const serialized = JSON.stringify(config, (_key, value: unknown) => {
        if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
          throw new TypeError('Unsupported config value');
        }
        return value instanceof RegExp ? { source: value.source, flags: value.flags } : value;
      });
      if (!serialized) {
        this.logFullValidation('configuration could not be serialized');
        return null;
      }
      return hash(serialized);
    }
    catch {
      this.logFullValidation('configuration contains unsupported values');
      return null;
    }
  }

  private async getInputFingerprint(
    config: DocFreshnessConfig,
    incrementalInputs?: readonly IncrementalInput[] | null,
    inventoryExclusions: readonly string[] = []
  ): Promise<string | null> {
    const rootDir = path.resolve(config.rootDir || process.cwd());
    const stateDir = path.resolve(this.stateDir);
    if (!incrementalInputs) {
      this.logFullValidation('validation inputs could not be captured');
      return null;
    }
    if (config.freshnessScoring?.enabled) {
      this.logFullValidation('freshness scoring inputs cannot be fingerprinted');
      return null;
    }
    if (config.vectorSearch?.enabled) {
      this.logFullValidation('vector search inputs cannot be fingerprinted');
      return null;
    }
    if (stateDir === rootDir) {
      this.logFullValidation('the state directory is the project root');
      return null;
    }
    if (!isWithinRoot(stateDir, rootDir)) {
      this.logFullValidation('the state directory is outside the project root');
      return null;
    }

    try {
      const realRootDir = await fs.promises.realpath(rootDir);
      const realStateDir = await fs.promises.realpath(stateDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return path.resolve(realRootDir, path.relative(rootDir, stateDir));
        }
        throw error;
      });
      if (!isWithinRoot(realStateDir, realRootDir)) {
        this.logFullValidation('the state directory resolves outside the project root');
        return null;
      }

      const entries: string[] = [];
      const realStatePath = path.resolve(rootDir, path.relative(realRootDir, realStateDir));
      const excludedPaths = new Set([stateDir, realStatePath, realStateDir]);
      const capturedContents = await this.inventoryCapturedInputs(rootDir, realRootDir, incrementalInputs, entries);
      for (const inventoryExclusion of inventoryExclusions) {
        const excludedPath = path.resolve(inventoryExclusion);
        excludedPaths.add(excludedPath);
        excludedPaths.add(
          await fs.promises.realpath(excludedPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
              return excludedPath;
            }
            throw error;
          })
        );
      }
      await this.inventoryDirectory(realRootDir, rootDir, '', excludedPaths, capturedContents, entries, new Set());
      return hash(entries.join('\n'));
    }
    catch {
      this.logFullValidation('validation inputs could not be inventoried');
      return null;
    }
  }

  private logFullValidation(reason: string): void {
    if (this.verbose) {
      console.log(`Incremental full validation: ${reason}.`);
    }
  }

  private async inventoryDirectory(
    realRootDir: string,
    directory: string,
    relativeDirectory: string,
    excludedPaths: Set<string>,
    capturedContents: ReadonlyMap<string, string>,
    entries: string[],
    visitedDirectories: Set<string>
  ): Promise<void> {
    const realDirectory = await fs.promises.realpath(directory);
    if (!isWithinRoot(realDirectory, realRootDir)) {
      throw new Error('Inventory directory escaped project root');
    }
    if (excludedPaths.has(directory) || excludedPaths.has(realDirectory) || visitedDirectories.has(realDirectory)) {
      return;
    }
    visitedDirectories.add(realDirectory);

    const children = await fs.promises.readdir(realDirectory, { withFileTypes: true });
    children.sort((a, b) => a.name.localeCompare(b.name));

    for (const child of children) {
      if (EXCLUDED_DIRECTORIES.has(child.name)) {
        continue;
      }

      const fullPath = path.resolve(realDirectory, child.name);
      const realFullPath = await fs.promises.realpath(fullPath);
      if (!isWithinRoot(realFullPath, realRootDir)) {
        throw new Error('Inventory path escaped project root');
      }
      if (excludedPaths.has(fullPath) || excludedPaths.has(realFullPath)) {
        continue;
      }

      const relativePath = path.join(relativeDirectory, child.name);
      if (child.isDirectory()) {
        entries.push(`D:${relativePath}`);
        await this.inventoryDirectory(realRootDir, fullPath, relativePath, excludedPaths, capturedContents, entries, visitedDirectories);
      }
      else if (child.isFile()) {
        entries.push(`F:${relativePath}:${hash(capturedContents.get(realFullPath) ?? (await fs.promises.readFile(realFullPath)))}`);
      }
      else if (child.isSymbolicLink()) {
        const link = await fs.promises.readlink(fullPath);
        const stat = await fs.promises.stat(realFullPath);
        if (stat.isFile()) {
          entries.push(
            `L:${relativePath}:${link}:${hash(capturedContents.get(realFullPath) ?? (await fs.promises.readFile(realFullPath)))}`
          );
        }
        else if (stat.isDirectory()) {
          entries.push(`L:${relativePath}:${link}:directory`);
          await this.inventoryDirectory(
            realRootDir,
            realFullPath,
            relativePath,
            excludedPaths,
            capturedContents,
            entries,
            visitedDirectories
          );
        }
        else {
          throw new Error('Unsupported inventory symlink target');
        }
      }
      else {
        throw new Error('Unsupported inventory entry');
      }
    }
  }

  private async inventoryCapturedInputs(
    rootDir: string,
    realRootDir: string,
    incrementalInputs: readonly IncrementalInput[],
    entries: string[]
  ): Promise<Map<string, string>> {
    const capturedContents = new Map<string, string>();
    const inputs = new Map<string, string | undefined>();
    for (const input of incrementalInputs) {
      const target = path.resolve(input.path);
      if (!inputs.has(target) || input.content !== undefined) {
        inputs.set(target, input.content);
      }
    }

    for (const [target, providedContent] of [...inputs].sort(([left], [right]) => left.localeCompare(right))) {
      if (!isWithinRoot(target, rootDir)) {
        throw new Error('Captured input escaped project root');
      }
      const relativeTarget = path.relative(rootDir, target);
      try {
        const realTarget = await fs.promises.realpath(target);
        if (!isWithinRoot(realTarget, realRootDir)) {
          throw new Error('Captured input symlink escaped project root');
        }
        const [targetStat, realStat] = await Promise.all([fs.promises.lstat(target), fs.promises.stat(realTarget)]);
        const link = targetStat.isSymbolicLink() ? await fs.promises.readlink(target) : null;
        if (realStat.isFile()) {
          const content = providedContent ?? (await fs.promises.readFile(realTarget));
          capturedContents.set(realTarget, typeof content === 'string' ? content : content.toString());
          entries.push(`I:${relativeTarget}:${link ? `link:${link}` : 'file'}:${hash(content)}`);
        }
        else if (realStat.isDirectory()) {
          entries.push(`I:${relativeTarget}:${link ? `link:${link}:` : ''}directory`);
        }
        else {
          throw new Error('Unsupported captured input');
        }
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          entries.push(`I:${relativeTarget}:missing`);
          continue;
        }
        throw error;
      }
    }
    return capturedContents;
  }
}

function hash(value: string | Buffer): string {
  return crypto.createHash('md5').update(value).digest('hex');
}
