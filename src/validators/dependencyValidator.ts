import { inventoryFor } from '../manifests/manifestInventory.js';
import type { DocFreshnessConfig, Document, Reference, ValidationResult } from '../types.js';

/**
 * Validates that mentioned dependencies exist in manifest files
 */
export class DependencyValidator {
  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
    const dependencies = await inventoryFor(this).dependencyNames(config);

    const results: ValidationResult[] = [];

    for (const ref of references) {
      const pkg = ref.value.toLowerCase();

      // Check if package exists in dependencies
      const found = dependencies.has(pkg);

      if (found) {
        results.push({
          reference: ref,
          valid: true,
        });
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
