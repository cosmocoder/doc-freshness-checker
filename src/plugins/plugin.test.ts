import { Plugin } from './plugin.js';

describe('Plugin', () => {
  it('has a name', () => {
    const plugin = new Plugin('test-plugin');
    expect(plugin.name).toBe('test-plugin');
  });

  it('returns empty arrays/objects from default methods', () => {
    const plugin = new Plugin('test');
    expect(plugin.getExtractors()).toEqual([]);
    expect(plugin.getValidators()).toEqual({});
    expect(plugin.getReporters()).toEqual({});
  });

  it('lifecycle hooks resolve without error', async () => {
    const plugin = new Plugin('test');
    await expect(plugin.initialize({})).resolves.not.toThrow();
    await expect(plugin.beforeValidation([])).resolves.not.toThrow();
    await expect(plugin.afterValidation({
      documents: [],
      summary: { total: 0, valid: 0, errors: 0, warnings: 0, skipped: 0 },
    })).resolves.not.toThrow();
  });
});
