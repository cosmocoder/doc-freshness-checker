import { inventoryFor } from '../manifests/manifestInventory.js';
import { resolveManifestPaths } from '../utils/manifestPaths.js';
import { canonicalizePythonPackageName } from '../utils/pythonDependencies.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';
import type { IncrementalInput } from './incrementalInputs.js';

/**
 * Validates that mentioned dependencies exist in manifest files
 */
export class DependencyValidator {
  /** @internal */
  async getIncrementalInputs(_references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<IncrementalInput[]> {
    return resolveManifestPaths(config).map((manifestPath) => ({ path: manifestPath }));
  }

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    const dependencies = await inventoryFor(this).dependencyNames(config);
    const results: ValidationResult[] = [];

    for (const ref of references) {
      const pkg = ref.value.toLowerCase();
      const canonicalPythonName = canonicalizePythonPackageName(pkg);
      const found =
        ref.ecosystem === 'pypi'
          ? dependencies.python.has(canonicalPythonName)
          : dependencies.all.has(pkg) || (!ref.ecosystem && dependencies.python.has(canonicalPythonName));

      if (found) {
        results.push({ reference: ref, valid: true });
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
