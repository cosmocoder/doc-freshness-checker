import { defineConfig } from './defineConfig.js';

describe('defineConfig', () => {
  it('returns the same config object for type inference', () => {
    const input = { include: ['docs/**/*.md'], verbose: true };
    const result = defineConfig(input);
    expect(result).toBe(input);
    expect(result).toEqual({ include: ['docs/**/*.md'], verbose: true });
  });
});
