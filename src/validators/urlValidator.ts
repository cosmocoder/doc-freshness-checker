import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import { pruneOldestEntries, setWithMaxEntries } from '../utils/boundedMap.js';
import type { DocFreshnessConfig, Document, Reference, UrlCacheEntry, ValidationResult } from '../types.js';

/**
 * Browser-like User-Agent to avoid being blocked by sites that reject bots
 */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

const MAX_URL_CACHE_ENTRIES = 5000;
const MAX_REDIRECTS = 10;

class UnsafeAddressError extends Error {}

const PRIVATE_ADDRESS_BLOCK_LIST = new net.BlockList();
const PRIVATE_ADDRESS_RANGES: Array<[string, number, 'ipv4' | 'ipv6']> = [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['224.0.0.0', 4, 'ipv4'],
  ['240.0.0.0', 4, 'ipv4'],
  ['::', 96, 'ipv6'],
  ['64:ff9b::', 96, 'ipv6'],
  ['2001::', 32, 'ipv6'],
  ['2002::', 16, 'ipv6'],
  ['::ffff:0:0:0', 96, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
  ['fec0::', 10, 'ipv6'],
  ['ff00::', 8, 'ipv6'],
];
PRIVATE_ADDRESS_RANGES.forEach(([address, prefix, family]) => PRIVATE_ADDRESS_BLOCK_LIST.addSubnet(address, prefix, family));

/**
 * Check whether a hostname is a private/internal address.
 * Prevents SSRF attacks against cloud metadata services, localhost, etc.
 */
function isPrivateHostname(hostname: string): boolean {
  return hostname === 'localhost' || isPrivateIpAddress(hostname);
}

function isPrivateIpAddress(value: string): boolean {
  const ipVersion = net.isIP(value);
  return ipVersion !== 0 && PRIVATE_ADDRESS_BLOCK_LIST.check(value, ipVersion === 4 ? 'ipv4' : 'ipv6');
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

/**
 * Validates external URLs are accessible
 */
export class UrlValidator {
  private cache: Map<string, UrlCacheEntry>;

  constructor() {
    this.cache = new Map();
  }

  async validateBatch(references: Reference[], _document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]> {
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

  private async validateUrl(ref: Reference, timeout: number, skipDomains: string[], config: DocFreshnessConfig): Promise<ValidationResult> {
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

    // Check skip domains and SSRF protection
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return {
          reference: ref,
          valid: false,
          severity: config.rules?.['external-url']?.severity || 'warning',
          message: `Unsupported URL protocol: ${urlObj.protocol}`,
        };
      }

      if (skipDomains.some((domain) => hostnameMatchesDomain(urlObj.hostname, domain))) {
        return {
          reference: ref,
          valid: true,
          skipped: true,
          message: 'Domain in skip list',
        };
      }
    }
    catch {
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
      }
      else if (response.status === 401 || response.status === 403) {
        // Authentication required - treat as valid but note it
        result = {
          valid: true,
          statusCode: response.status,
          message: `Requires authentication: ${url}`,
        };
      }
      else if (response.status === 404 && this.isGitHubUrl(url)) {
        // GitHub private repos return 404 - treat as potentially valid
        result = {
          valid: true,
          statusCode: response.status,
          message: `May be private repository: ${url}`,
        };
      }
      else {
        result = {
          valid: false,
          severity: config.rules?.['external-url']?.severity || 'warning',
          message: `${url} returned ${response.status} ${response.statusText}`,
          statusCode: response.status,
        };
      }

      this.setCacheEntry(url, result);

      return {
        reference: ref,
        ...result,
      };
    }
    catch (error) {
      const err = error as Error;
      if (err instanceof UnsafeAddressError) {
        return {
          reference: ref,
          valid: true,
          skipped: true,
          message: err.message,
        };
      }
      const result = {
        valid: false,
        severity: (config.rules?.['external-url']?.severity || 'warning') as 'error' | 'warning' | 'info',
        message: err.name === 'AbortError' ? `URL timeout: ${url}` : `URL check failed: ${url} (${err.message})`,
      };

      this.setCacheEntry(url, result);

      return {
        reference: ref,
        ...result,
      };
    }
  }

  private async fetchWithTimeout(
    url: string,
    method: 'HEAD' | 'GET',
    timeout: number
  ): Promise<{ ok: boolean; status: number; statusText: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      return await this.requestWithRedirects(new URL(url), method, controller.signal);
    }
    finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if URL is a GitHub URL (repos can be private)
   */
  private isGitHubUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname === 'github.com' || urlObj.hostname === 'raw.githubusercontent.com' || urlObj.hostname.endsWith('.github.com');
    }
    catch {
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
    pruneOldestEntries(this.cache, MAX_URL_CACHE_ENTRIES);
  }

  /**
   * Export cache for persistence
   */
  exportCache(): Record<string, UrlCacheEntry> {
    return Object.fromEntries(this.cache);
  }

  private async requestWithRedirects(
    url: URL,
    method: 'HEAD' | 'GET',
    signal: AbortSignal,
    redirectCount = 0
  ): Promise<{ ok: boolean; status: number; statusText: string }> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported URL protocol: ${url.protocol}`);
    }
    if (url.username || url.password) {
      throw new Error('Request URL must not include credentials');
    }
    const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    // Block direct/private hostnames before DNS resolution.
    if (isPrivateHostname(hostname)) {
      throw new UnsafeAddressError('Skipped: private/internal address');
    }

    const addresses = await this.lookupWithAbort(hostname, signal);
    if (addresses.length === 0 || addresses.some((entry) => isPrivateIpAddress(entry.address))) {
      throw new UnsafeAddressError('Skipped: hostname resolves to private/internal address');
    }
    const pinnedAddress = addresses[0];
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.request(
        url,
        {
          method,
          signal,
          agent: false,
          family: pinnedAddress.family,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          lookup: (_hostname, _options, callback) => callback(null, pinnedAddress.address, pinnedAddress.family),
        },
        resolve
      );
      request.once('error', reject);
      request.end();
    });

    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    response.destroy();

    if ([301, 302, 303, 307, 308].includes(status) && location) {
      if (redirectCount >= MAX_REDIRECTS) {
        throw new Error(`Too many redirects: ${url.href}`);
      }
      return this.requestWithRedirects(new URL(location, url), method, signal, redirectCount + 1);
    }

    return { ok: status >= 200 && status < 300, status, statusText: response.statusMessage ?? '' };
  }

  private lookupWithAbort(hostname: string, signal: AbortSignal): Promise<Array<{ address: string; family: number }>> {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(signal.reason);
      signal.addEventListener('abort', onAbort, { once: true });

      dns.lookup(hostname, { all: true, verbatim: true }).then(
        (addresses) => {
          signal.removeEventListener('abort', onAbort);
          if (!signal.aborted) {
            resolve(addresses);
          }
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      );
    });
  }

  private setCacheEntry(url: string, result: UrlCacheEntry['result']): void {
    setWithMaxEntries(this.cache, url, { result, timestamp: Date.now() }, MAX_URL_CACHE_ENTRIES);
  }
}
