import type { DocFreshnessConfig, Document, Reference, UrlCacheEntry, ValidationResult } from '../types.js';

/**
 * Browser-like User-Agent to avoid being blocked by sites that reject bots
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Domains known to not support HEAD requests properly or have bot detection
 * These will use GET requests directly
 */
const DOMAINS_REQUIRING_GET = [
  'marketplace.visualstudio.com',
  'code.visualstudio.com',
  'visualstudio.microsoft.com',
  'learn.microsoft.com',
  'docs.microsoft.com',
];

/**
 * Validates external URLs are accessible
 */
export class UrlValidator {
  private cache: Map<string, UrlCacheEntry>;

  constructor() {
    this.cache = new Map();
  }

  async validateBatch(
    references: Reference[],
    _document: Document,
    config: DocFreshnessConfig
  ): Promise<ValidationResult[]> {
    if (!config.urlValidation?.enabled) {
      return references.map((ref) => ({
        reference: ref,
        valid: true,
        skipped: true,
      }));
    }

    const concurrency = config.urlValidation?.concurrency || 5;
    const timeout = config.urlValidation?.timeout || 10000;
    const skipDomains = config.urlValidation?.skipDomains || [];

    // Deduplicate - each unique URL only needs to be checked once
    const urlToRefs = new Map<string, Reference[]>();
    for (const ref of references) {
      const url = ref.value;
      if (!urlToRefs.has(url)) {
        urlToRefs.set(url, []);
      }
      urlToRefs.get(url)!.push(ref);
    }

    // Check each unique URL once
    const uniqueUrls = Array.from(urlToRefs.keys());
    const urlResults = new Map<string, ValidationResult>();

    for (let i = 0; i < uniqueUrls.length; i += concurrency) {
      const batch = uniqueUrls.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (url) => {
          // Create a temporary ref for validation
          const refs = urlToRefs.get(url)!;
          const result = await this.validateUrl(refs[0], timeout, skipDomains, config);
          return { url, result };
        })
      );
      for (const { url, result } of batchResults) {
        urlResults.set(url, result);
      }
    }

    // Map results back to all references
    const results: ValidationResult[] = [];
    for (const ref of references) {
      const cachedResult = urlResults.get(ref.value)!;
      results.push({
        ...cachedResult,
        reference: ref, // Use the actual reference
      });
    }

    return results;
  }

  private async validateUrl(
    ref: Reference,
    timeout: number,
    skipDomains: string[],
    config: DocFreshnessConfig
  ): Promise<ValidationResult> {
    const url = ref.value;

    // Skip URLs with template placeholders (${...}, {{...}}, etc.)
    if (/\$\{.*\}|\{\{.*\}\}|<%.*%>/.test(url)) {
      return {
        reference: ref,
        valid: true,
        skipped: true,
        message: 'URL contains template placeholders',
      };
    }

    // Check skip domains
    try {
      const urlObj = new URL(url);
      if (skipDomains.some((domain) => urlObj.hostname.includes(domain))) {
        return {
          reference: ref,
          valid: true,
          skipped: true,
          message: 'Domain in skip list',
        };
      }
    } catch {
      return {
        reference: ref,
        valid: false,
        severity: config.rules?.['external-url']?.severity || 'warning',
        message: `Invalid URL format: ${url}`,
      };
    }

    // Check cache
    if (this.cache.has(url)) {
      const cached = this.cache.get(url)!;
      if (Date.now() - cached.timestamp < (config.urlValidation?.cacheSeconds || 3600) * 1000) {
        return {
          reference: ref,
          ...cached.result,
        };
      }
    }

    // Validate URL
    try {
      const urlObj = new URL(url);
      const requiresGet = DOMAINS_REQUIRING_GET.some((domain) => urlObj.hostname.includes(domain));

      // Try HEAD first (unless domain is known to not support it), then fall back to GET
      let response = await this.fetchWithTimeout(url, requiresGet ? 'GET' : 'HEAD', timeout);

      // If HEAD returns 404 or 405 (Method Not Allowed), retry with GET
      if (!requiresGet && (response.status === 404 || response.status === 405)) {
        response = await this.fetchWithTimeout(url, 'GET', timeout);
      }

      let result: { valid: boolean; severity?: 'error' | 'warning' | 'info'; message?: string; statusCode?: number };

      if (response.ok) {
        result = {
          valid: true,
          statusCode: response.status,
        };
      } else if (response.status === 401 || response.status === 403) {
        // Authentication required - treat as valid but note it
        result = {
          valid: true,
          statusCode: response.status,
          message: `Requires authentication: ${url}`,
        };
      } else if (response.status === 404 && this.isGitHubUrl(url)) {
        // GitHub private repos return 404 - treat as potentially valid
        result = {
          valid: true,
          statusCode: response.status,
          message: `May be private repository: ${url}`,
        };
      } else {
        result = {
          valid: false,
          severity: config.rules?.['external-url']?.severity || 'warning',
          message: `${url} returned ${response.status} ${response.statusText}`,
          statusCode: response.status,
        };
      }

      this.cache.set(url, { result, timestamp: Date.now() });

      return {
        reference: ref,
        ...result,
      };
    } catch (error) {
      const err = error as Error;
      const result = {
        valid: false,
        severity: (config.rules?.['external-url']?.severity || 'warning') as 'error' | 'warning' | 'info',
        message: err.name === 'AbortError'
          ? `URL timeout: ${url}`
          : `URL check failed: ${url} (${err.message})`,
      };

      this.cache.set(url, { result, timestamp: Date.now() });

      return {
        reference: ref,
        ...result,
      };
    }
  }

  /**
   * Fetch a URL with timeout and browser-like headers
   */
  private async fetchWithTimeout(url: string, method: 'HEAD' | 'GET', timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        // Don't follow too many redirects
        redirect: 'follow',
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if URL is a GitHub URL (repos can be private)
   */
  private isGitHubUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === 'github.com' ||
             urlObj.hostname === 'raw.githubusercontent.com' ||
             urlObj.hostname.endsWith('.github.com');
    } catch {
      return false;
    }
  }

  /**
   * Load cache from external source
   */
  loadCache(cacheData: Record<string, UrlCacheEntry>): void {
    for (const [url, data] of Object.entries(cacheData)) {
      this.cache.set(url, data);
    }
  }

  /**
   * Export cache for persistence
   */
  exportCache(): Record<string, UrlCacheEntry> {
    return Object.fromEntries(this.cache);
  }
}
