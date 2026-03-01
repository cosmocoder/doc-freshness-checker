import type {
  BaseValidator,
  DocFreshnessConfig,
  Document,
  DocumentIssues,
  Reference,
  ValidationResults,
} from '../types.js';

/**
 * Orchestrates validation of extracted references
 */
export class ValidationEngine {
  private config: DocFreshnessConfig;
  private validators: Map<string, BaseValidator>;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.validators = new Map();
  }

  /**
   * Register a validator for a specific reference type
   */
  registerValidator(type: string, validator: BaseValidator): void {
    this.validators.set(type, validator);
  }

  /**
   * Validate all references from parsed documents
   */
  async validate(documents: Document[]): Promise<ValidationResults> {
    const results: ValidationResults = {
      documents: [],
      summary: {
        total: 0,
        valid: 0,
        errors: 0,
        warnings: 0,
        skipped: 0,
      },
    };

    for (const doc of documents) {
      const docResult: DocumentIssues = {
        path: doc.path,
        issues: [],
      };

      // Group references by type for batch validation
      const refsByType = this.groupByType(doc.references);

      for (const [type, refs] of refsByType) {
        // Check if this rule is explicitly disabled
        const ruleConfig = this.config.rules?.[type];
        if (ruleConfig?.enabled === false) {
          results.summary.total += refs.length;
          results.summary.skipped += refs.length;
          continue;
        }

        const validator = this.validators.get(type);

        if (!validator) {
          results.summary.total += refs.length;
          results.summary.skipped += refs.length;
          continue;
        }

        try {
          const validationResults = await validator.validateBatch(refs, doc, this.config);

          for (const result of validationResults) {
            results.summary.total++;

            if (result.skipped) {
              results.summary.skipped++;
            } else if (result.valid) {
              results.summary.valid++;
            } else if (result.severity === 'error') {
              results.summary.errors++;
              docResult.issues.push(result);
            } else if (result.severity === 'warning') {
              results.summary.warnings++;
              docResult.issues.push(result);
            } else {
              // info-level issues: count as valid, don't add to issues
              results.summary.valid++;
            }
          }
        } catch (error) {
          if (this.config.verbose) {
            console.warn(`Warning: Validator for ${type} failed: ${(error as Error).message}`);
          }
          results.summary.total += refs.length;
          results.summary.skipped += refs.length;
        }
      }

      if (docResult.issues.length > 0) {
        results.documents.push(docResult);
      }
    }

    return results;
  }

  /**
   * Group references by type
   */
  private groupByType(references: Reference[]): Map<string, Reference[]> {
    const grouped = new Map<string, Reference[]>();
    for (const ref of references) {
      if (!grouped.has(ref.type)) {
        grouped.set(ref.type, []);
      }
      grouped.get(ref.type)!.push(ref);
    }
    return grouped;
  }
}
