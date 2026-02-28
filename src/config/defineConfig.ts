import type { DocFreshnessConfig } from '../types.js';

/**
 * Define configuration for Documentation Freshness Checker.
 *
 * This helper function provides IntelliSense support for configuration options.
 *
 * @example
 * ```ts
 * // .doc-freshness.config.js
 * import { defineConfig } from 'doc-freshness-checker';
 *
 * export default defineConfig({
 *   include: ['docs/**‍/*.md', 'README.md'],
 *   exclude: ['**‍/node_modules/**'],
 *   rules: {
 *     'file-path': { enabled: true, severity: 'error' },
 *     'external-url': { enabled: true, severity: 'warning' },
 *   },
 *   vectorSearch: {
 *     enabled: true,
 *   },
 * });
 * ```
 *
 * @param config - Configuration object
 * @returns The same configuration object (for type inference)
 */
export function defineConfig(config: DocFreshnessConfig): DocFreshnessConfig {
  return config;
}
