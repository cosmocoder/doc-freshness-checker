import { CodePatternValidator } from '../validators/codePatternValidator.js';
import { CodeSnippetValidator } from '../validators/codeSnippetValidator.js';
import { SourceIndex } from './sourceIndex.js';

describe('public validator constructors', () => {
  it('accept only zero arguments in the public type surface', () => {
    expectTypeOf(CodePatternValidator).toBeConstructibleWith();
    expectTypeOf(CodeSnippetValidator).toBeConstructibleWith();

    const internalInjectionIsRejected = (): void => {
      // @ts-expect-error SourceIndex injection is internal-only.
      new CodePatternValidator(new SourceIndex());
      // @ts-expect-error SourceIndex injection is internal-only.
      new CodeSnippetValidator(new SourceIndex());
    };
    expectTypeOf(internalInjectionIsRejected).toBeFunction();
  });
});
