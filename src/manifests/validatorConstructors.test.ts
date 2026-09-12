import { DependencyValidator } from '../validators/dependencyValidator.js';
import { VersionValidator } from '../validators/versionValidator.js';
import { ManifestInventory } from './manifestInventory.js';

describe('public manifest validator constructors', () => {
  it('accept only zero arguments in the public type surface', () => {
    expectTypeOf(DependencyValidator).toBeConstructibleWith();
    expectTypeOf(VersionValidator).toBeConstructibleWith();

    const internalInjectionIsRejected = (): void => {
      // @ts-expect-error ManifestInventory injection is internal-only.
      new DependencyValidator(new ManifestInventory());
      // @ts-expect-error ManifestInventory injection is internal-only.
      new VersionValidator(new ManifestInventory());
    };
    expectTypeOf(internalInjectionIsRejected).toBeFunction();
  });
});
