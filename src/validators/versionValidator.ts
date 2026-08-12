import semver from 'semver';
import { inventoryFor } from '../manifests/manifestInventory.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

export { manifestParsers } from '../manifests/manifestInventory.js';

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

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    const packageVersions = await inventoryFor(this).packageVersions(config);

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
        if (packageVersions.has(pkgName)) {
          actualVersion = packageVersions.get(pkgName)!;
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
    const parsed = semver.coerce(version);
    return parsed ? parsed.major : null;
  }
}
