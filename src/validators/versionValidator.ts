import semver from 'semver';
import { inventoryFor } from '../manifests/manifestInventory.js';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import { canonicalizePythonPackageName } from '../utils/pythonDependencies.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';
import type { IncrementalInput } from './incrementalInputs.js';

/**
 * Validates version references against manifest files
 */
export class VersionValidator {
  private technologyMap: Record<string, string[]>;

  constructor() {
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

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    const versions = await inventoryFor(this).packageVersions(config);
    const results: ValidationResult[] = [];

    for (const ref of references) {
      if (!ref.technology) {
        results.push({ reference: ref, valid: true });
        continue;
      }

      const tech = ref.technology.toLowerCase();
      const docVersion = ref.version;
      const pkgNames = this.technologyMap[tech] || [tech];
      let actualVersion: string | null = null;

      for (const pkgName of pkgNames) {
        const exactCandidate = versions.all.get(pkgName);
        const pythonCandidate = versions.python.get(canonicalizePythonPackageName(pkgName));
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
        results.push({ reference: ref, valid: true, message: `Could not find ${tech} in dependencies` });
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
        results.push({ reference: ref, valid: true });
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
