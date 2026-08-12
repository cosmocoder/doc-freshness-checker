import type { ValidationResults } from '../types.js';
import { JsonReporter } from './jsonReporter.js';

const results: ValidationResults = {
  documents: [],
  summary: { total: 3, valid: 3, errors: 0, warnings: 0, skipped: 0 },
};

describe('JsonReporter', () => {
  it('snapshots scored results before reading the clock', () => {
    const events: string[] = [];
    const proxiedResults = new Proxy(results, {
      ownKeys(target) {
        events.push('results:keys');
        return Reflect.ownKeys(target);
      },
      get(target, property, receiver) {
        events.push(`results:${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const originalToISOString = Date.prototype.toISOString;
    const clock = vi.spyOn(Date.prototype, 'toISOString').mockImplementation(function (this: Date) {
      events.push('clock');
      return originalToISOString.call(this);
    });

    new JsonReporter().generateWithScores(proxiedResults, null);

    expect(events).toEqual(['results:keys', 'results:documents', 'results:summary', 'clock']);
    clock.mockRestore();
  });

  it('does not read the clock when scored result spreading fails', () => {
    const proxiedResults = new Proxy(results, {
      get(_target, property) {
        if (property === 'documents') {
          throw new Error('result getter failed');
        }
        return Reflect.get(results, property);
      },
    });
    const clock = vi.spyOn(Date.prototype, 'toISOString');

    expect(() => new JsonReporter().generateWithScores(proxiedResults, null)).toThrow('result getter failed');
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });
});
