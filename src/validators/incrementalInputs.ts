import type { BaseValidator, DocFreshnessConfig, Document, Reference } from '../types.js';

/** @internal */
export interface IncrementalInput {
  path: string;
  content?: string;
}

/** @internal */
export interface IncrementalInputProvider extends BaseValidator {
  /** @internal */
  readonly incrementalCaptureScope?: 'document' | 'project';
  /** @internal */
  readonly incrementalInputsRequiredForGraph?: boolean;
  /** @internal */
  getIncrementalInputs(references: Reference[], document: Document, config: DocFreshnessConfig): Promise<IncrementalInput[] | null>;
}

/** @internal */
export function getIncrementalInputProvider(validator: BaseValidator | undefined): IncrementalInputProvider | null {
  const provider = validator as IncrementalInputProvider | undefined;
  return provider && typeof provider.getIncrementalInputs === 'function' ? provider : null;
}
