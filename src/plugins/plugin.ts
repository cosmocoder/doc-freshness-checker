import type { BaseExtractor, BaseValidator, DocFreshnessConfig, Document, ValidationResults } from '../types.js';

/**
 * Plugin interface for extending doc-freshness functionality
 */
export class Plugin {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  /**
   * Called when the plugin is registered
   */
  async initialize(_config: DocFreshnessConfig): Promise<void> {}

  /**
   * Return custom extractors
   */
  getExtractors(): BaseExtractor[] {
    return [];
  }

  /**
   * Return custom validators
   */
  getValidators(): Record<string, BaseValidator> {
    return {};
  }

  /**
   * Return custom reporters
   */
  getReporters(): Record<string, unknown> {
    return {};
  }

  /**
   * Called before validation starts
   */
  async beforeValidation(_documents: Document[]): Promise<void> {}

  /**
   * Called after validation completes
   */
  async afterValidation(_results: ValidationResults): Promise<void> {}
}
