import path from 'path';
import { getIncrementalInputProvider } from './incrementalInputs.js';
import type { IncrementalInput, IncrementalInputProvider } from './incrementalInputs.js';
import type { BaseValidator, DocFreshnessConfig, Document, DocumentIssues, Reference, ValidationResults } from '../types.js';

/**
 * Orchestrates validation of extracted references
 */
export class ValidationEngine {
  private config: DocFreshnessConfig;
  private validators: Map<string, BaseValidator>;
  private latestHadInvalidResults: boolean;
  private latestHadIncompleteValidation: boolean;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.validators = new Map();
    this.latestHadInvalidResults = false;
    this.latestHadIncompleteValidation = false;
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
    this.latestHadInvalidResults = false;
    this.latestHadIncompleteValidation = false;
    const results: ValidationResults = {
      documents: [],
      summary: {
        total: 0,
        valid: 0,
        errors: 0,
        warnings: 0,
        info: 0,
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
          this.latestHadIncompleteValidation = true;
          results.summary.total += refs.length;
          results.summary.skipped += refs.length;
          continue;
        }

        const validationResults = await validator.validateBatch(refs, doc, this.config);

        for (const result of validationResults) {
          if (!result.valid) {
            this.latestHadInvalidResults = true;
          }
          const bucket = this.classifyResult(result);
          this.incrementSummary(results, bucket);
          if (bucket === 'error' || bucket === 'warning' || bucket === 'info') {
            docResult.issues.push(result);
          }
        }
      }

      if (docResult.issues.length > 0) {
        results.documents.push(docResult);
      }
    }

    return results;
  }

  /** @internal */
  hadInvalidResults(): boolean {
    return this.latestHadInvalidResults;
  }

  /** @internal */
  hadIncompleteValidation(): boolean {
    return this.latestHadIncompleteValidation;
  }

  /** @internal */
  async captureIncrementalInputs(documents: Document[]): Promise<IncrementalInput[] | null> {
    const inputs: IncrementalInput[] = [];
    const groups: Array<{ validator: IncrementalInputProvider; references: Reference[]; document: Document }> = [];
    try {
      for (const document of documents) {
        for (const [type, references] of this.groupByType(document.references)) {
          if (this.config.rules?.[type]?.enabled === false) {
            continue;
          }
          const validator = getIncrementalInputProvider(this.validators.get(type));
          if (!validator) {
            return null;
          }
          groups.push({ validator, references, document });
        }
      }

      const projectCaptures = new Map<IncrementalInputProvider, { references: Reference[]; document: Document }>();
      for (const group of groups) {
        if (group.validator.incrementalCaptureScope === 'project') {
          if (!projectCaptures.has(group.validator)) {
            projectCaptures.set(group.validator, group);
          }
          continue;
        }
        const captured = await group.validator.getIncrementalInputs(group.references, group.document, this.config);
        if (!captured) {
          return null;
        }
        inputs.push(...captured);
      }

      const graphDocument = documents[0];
      if (graphDocument && this.config.graph?.enabled !== false) {
        for (const registeredValidator of new Set(this.validators.values())) {
          const graphProvider = registeredValidator as Partial<IncrementalInputProvider>;
          if (graphProvider.incrementalCaptureScope !== 'project' || !graphProvider.incrementalInputsRequiredForGraph) {
            continue;
          }
          const validator = getIncrementalInputProvider(registeredValidator);
          if (!validator) {
            return null;
          }
          if (projectCaptures.has(validator)) {
            continue;
          }
          projectCaptures.set(validator, { references: [], document: graphDocument });
        }
      }

      for (const [validator, capture] of projectCaptures) {
        const captured = await validator.getIncrementalInputs(capture.references, capture.document, this.config);
        if (!captured) {
          return null;
        }
        inputs.push(...captured);
      }
      const uniqueInputs = new Map<string, IncrementalInput>();
      for (const input of inputs) {
        const resolvedPath = path.resolve(input.path);
        if (!uniqueInputs.has(resolvedPath) || input.content !== undefined) {
          uniqueInputs.set(resolvedPath, { path: resolvedPath, ...(input.content === undefined ? {} : { content: input.content }) });
        }
      }
      return [...uniqueInputs.values()];
    }
    catch {
      return null;
    }
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

  private classifyResult(result: {
    skipped?: boolean;
    valid: boolean;
    severity?: 'error' | 'warning' | 'info';
  }): 'valid' | 'error' | 'warning' | 'info' | 'skipped' {
    if (result.skipped) {
      return 'skipped';
    }
    if (result.valid) {
      return 'valid';
    }
    if (result.severity === 'error') {
      return 'error';
    }
    if (result.severity === 'warning') {
      return 'warning';
    }
    if (result.severity === 'info') {
      return 'info';
    }
    return 'warning';
  }

  private incrementSummary(results: ValidationResults, bucket: 'valid' | 'error' | 'warning' | 'info' | 'skipped'): void {
    results.summary.total++;
    switch (bucket) {
      case 'valid':
        results.summary.valid++;
        break;
      case 'error':
        results.summary.errors++;
        break;
      case 'warning':
        results.summary.warnings++;
        break;
      case 'info':
        results.summary.info = (results.summary.info ?? 0) + 1;
        break;
      case 'skipped':
        results.summary.skipped++;
        break;
    }
  }
}
