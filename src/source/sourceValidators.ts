import { CodePatternValidator } from '../validators/codePatternValidator.js';
import { CodeSnippetValidator } from '../validators/codeSnippetValidator.js';
import { SourceIndex } from './sourceIndex.js';

type SourceValidatorConstructor<T> = new (index: SourceIndex) => T;

export function createSourceValidators(index: SourceIndex): {
  pattern: CodePatternValidator;
  snippet: CodeSnippetValidator;
} {
  const PatternValidator = CodePatternValidator as unknown as SourceValidatorConstructor<CodePatternValidator>;
  const SnippetValidator = CodeSnippetValidator as unknown as SourceValidatorConstructor<CodeSnippetValidator>;
  return { pattern: new PatternValidator(index), snippet: new SnippetValidator(index) };
}
