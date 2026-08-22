import { UrlValidator } from './urlValidator.js';
import dns from 'dns/promises';
import { EventEmitter } from 'events';
import type http from 'http';
import { Readable } from 'stream';
import type { DocFreshnessConfig } from '../types.js';
import { makeDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('http', () => ({ default: { request: requestMock } }));
vi.mock('https', () => ({ default: { request: requestMock } }));

vi.mock('dns/promises', () => ({
  default: {
    lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
  },
}));

type MockResponse = { body: string; status: number; statusText: string; headers: http.IncomingHttpHeaders } | { error: Error };

const mockResponses: MockResponse[] = [];
const responseDestroyMocks: Array<ReturnType<typeof vi.fn>> = [];
const httpRequestMock = Object.assign(requestMock, {
  mockResponseOnce(body = '', init: { status?: number; statusText?: string; headers?: http.IncomingHttpHeaders } = {}) {
    mockResponses.push({
      body,
      status: init.status ?? 200,
      statusText: init.statusText ?? '',
      headers: init.headers ?? {},
    });
    return httpRequestMock;
  },
  mockRejectOnce(error: Error) {
    mockResponses.push({ error });
    return httpRequestMock;
  },
});

requestMock.mockImplementation((_url: URL, _options: http.RequestOptions, onResponse: (response: http.IncomingMessage) => void) => {
  const next = mockResponses.shift() ?? { body: '', status: 200, statusText: '', headers: {} };
  const request = new EventEmitter() as http.ClientRequest;
  request.end = vi.fn(() => {
    queueMicrotask(() => {
      if ('error' in next) {
        request.emit('error', next.error);
        return;
      }
      const response = Readable.from([next.body]) as http.IncomingMessage;
      response.destroy = vi.fn(response.destroy.bind(response)) as typeof response.destroy;
      responseDestroyMocks.push(response.destroy as unknown as ReturnType<typeof vi.fn>);
      response.statusCode = next.status;
      response.statusMessage = next.statusText;
      response.headers = next.headers;
      onResponse(response);
    });
    return request;
  }) as http.ClientRequest['end'];
  return request;
});

function makeRef(url: string) {
  return makeBaseRef('external-url', url);
}

const doc = makeDoc();
const enabledConfig: DocFreshnessConfig = { urlValidation: { enabled: true, timeout: 5000 } };

describe('UrlValidator', () => {
  let validator: UrlValidator;

  beforeEach(() => {
    mockResponses.length = 0;
    responseDestroyMocks.length = 0;
    vi.mocked(dns.lookup).mockReset();
    vi.mocked(dns.lookup).mockImplementation((async () => {
      return [{ address: '93.184.216.34', family: 4 }];
    }) as unknown as typeof dns.lookup);
    validator = new UrlValidator();
  });

  it('skips all URLs when urlValidation is disabled', async () => {
    const results = await validator.validateBatch([makeRef('https://example.com')], doc, { urlValidation: { enabled: false } });
    expect(results).toHaveLength(1);
    expect(results[0].skipped).toBe(true);
  });

  it('skips URLs with template placeholders', async () => {
    const results = await validator.validateBatch(
      [
        makeRef('https://api.example.com/${version}/endpoint'),
        makeRef('https://api.example.com/{{path}}/data'),
        makeRef('https://api.example.com/<% url %>'),
      ],
      doc,
      enabledConfig
    );
    results.forEach((r) => {
      expect(r.skipped).toBe(true);
      expect(r.message).toContain('template');
    });
  });

  it('skips domains in the skip list (including subdomains)', async () => {
    const config: DocFreshnessConfig = { urlValidation: { enabled: true, skipDomains: ['example.com'] } };
    const results = await validator.validateBatch(
      [makeRef('https://example.com/path'), makeRef('https://api.example.com/path')],
      doc,
      config
    );
    results.forEach((r) => expect(r.skipped).toBe(true));
  });

  describe('SSRF protection - private hostnames', () => {
    it.each(['http://localhost:3000', 'http://127.0.0.1/admin', 'http://0.0.0.0/', 'http://[::1]/'])('skips %s', async (url) => {
      const results = await validator.validateBatch([makeRef(url)], doc, enabledConfig);
      expect(results[0].skipped).toBe(true);
    });

    it.each([
      ['10.0.0.1', '10.x.x.x range'],
      ['172.16.0.1', '172.16-31.x.x range'],
      ['172.31.255.255', '172.16-31.x.x upper bound'],
      ['192.168.1.1', '192.168.x.x range'],
      ['169.254.1.1', '169.254.x.x link-local'],
      ['224.0.0.1', 'multicast range'],
      ['255.255.255.255', 'broadcast'],
      ['240.0.0.1', 'reserved range'],
      ['100.64.0.1', 'shared address range'],
    ])('skips private IPv4 %s (%s)', async (ip) => {
      const results = await validator.validateBatch([makeRef(`http://${ip}/`)], doc, enabledConfig);
      expect(results[0].skipped).toBe(true);
    });

    it.each([
      'http://127.0.0.1/admin',
      'http://10.0.0.1/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:127.0.0.1]/admin',
      'http://[::ffff:10.0.0.1]/admin',
      'http://[::ffff:169.254.169.254]/latest/meta-data/',
    ])('does not request private redirect target %s', async (location) => {
      httpRequestMock.mockResponseOnce('', { status: 302, headers: { location } });

      const results = await validator.validateBatch([makeRef('https://public.example.com/redirect')], doc, enabledConfig);

      expect(results[0].skipped).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);
    });

    it('allows an IPv4-mapped public address', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });

      const results = await validator.validateBatch([makeRef('http://[::ffff:93.184.216.34]/')], doc, enabledConfig);

      expect(results[0].valid).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);
    });

    it('pins the validated DNS address to the connection lookup', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });

      const results = await validator.validateBatch([makeRef('https://public.example.com/')], doc, enabledConfig);
      const options = httpRequestMock.mock.calls[0][1] as http.RequestOptions;
      const lookup = options.lookup as (
        hostname: string,
        options: object,
        callback: (error: Error | null, address: string, family: number) => void
      ) => void;
      const callback = vi.fn();
      lookup('public.example.com', {}, callback);

      expect(results[0].valid).toBe(true);
      expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      expect(dns.lookup).toHaveBeenCalledTimes(1);
    });

    it.each([
      'http://[::127.0.0.1]/',
      'http://[64:ff9b::7f00:1]/',
      'http://[2001::1]/',
      'http://[2002:7f00:1::]/',
      'http://[::ffff:0:7f00:1]/',
      'http://[ff02::1]/',
      'http://[fec0::1]/',
      'http://240.0.0.1/',
    ])('does not issue a request for missing private/reserved range %s', async (url) => {
      const results = await validator.validateBatch([makeRef(url)], doc, enabledConfig);

      expect(results[0].skipped).toBe(true);
      expect(httpRequestMock).not.toHaveBeenCalled();
    });
  });

  it('rejects unsupported protocols', async () => {
    const results = await validator.validateBatch([makeRef('ftp://files.example.com')], doc, enabledConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('Unsupported URL protocol');
  });

  it('does not issue a request for a redirect with unsupported protocol', async () => {
    httpRequestMock.mockResponseOnce('', { status: 302, headers: { location: 'ftp://example.com/file' } });

    const results = await validator.validateBatch([makeRef('https://public.example.com/redirect')], doc, enabledConfig);

    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('Unsupported URL protocol');
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('does not issue a request for a redirect with credentials', async () => {
    httpRequestMock.mockResponseOnce('', { status: 302, headers: { location: 'https://user:pass@example.com/file' } });

    const results = await validator.validateBatch([makeRef('https://public.example.com/redirect')], doc, enabledConfig);

    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('credentials');
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('skips a redirect whose target has no DNS addresses', async () => {
    httpRequestMock.mockResponseOnce('', { status: 302, headers: { location: 'https://empty.example.com/file' } });
    vi.mocked(dns.lookup).mockImplementationOnce((async () => [{ address: '93.184.216.34', family: 4 }]) as unknown as typeof dns.lookup);
    vi.mocked(dns.lookup).mockImplementationOnce((async () => []) as unknown as typeof dns.lookup);

    const results = await validator.validateBatch([makeRef('https://public.example.com/redirect')], doc, enabledConfig);

    expect(results[0].skipped).toBe(true);
    expect(results[0].message).toContain('private/internal');
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('stops after the maximum number of redirects', async () => {
    for (let i = 0; i <= 10; i++) {
      httpRequestMock.mockResponseOnce('', { status: 302, headers: { location: `https://redirect${i}.example.com/` } });
    }

    const results = await validator.validateBatch([makeRef('https://public.example.com/redirect')], doc, enabledConfig);

    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('Too many redirects');
    expect(httpRequestMock).toHaveBeenCalledTimes(11);
  });

  it('rejects invalid URL format', async () => {
    const results = await validator.validateBatch([makeRef('not-a-valid-url')], doc, enabledConfig);
    expect(results[0].valid).toBe(false);
    expect(results[0].message).toContain('Invalid URL');
  });

  describe('HTTP validation', () => {
    it('validates accessible URLs as valid (200)', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://httpbin.org/status/200')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(results[0].statusCode).toBe(200);
    });

    it('falls back from HEAD to GET on 404', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://example.com/page')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(2);
    });

    it('falls back from HEAD to GET on 405 Method Not Allowed', async () => {
      httpRequestMock.mockResponseOnce('', { status: 405 });
      httpRequestMock.mockResponseOnce('', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://example.com/api')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
    });

    it('uses GET directly for known GET-only domains', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://marketplace.visualstudio.com/items?q=test')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);
      expect(httpRequestMock.mock.calls[0][1]?.method).toBe('GET');
    });

    it('treats 401/403 as valid (auth-protected)', async () => {
      httpRequestMock.mockResponseOnce('', { status: 401 });
      const results = await validator.validateBatch([makeRef('https://api.example.com/protected')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(results[0].message).toContain('authentication');
    });

    it('treats GitHub 404 as potentially valid (private repo)', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 404 });
      const results = await validator.validateBatch([makeRef('https://github.com/owner/private-repo')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(results[0].message).toContain('private');
    });

    it('marks non-GitHub 404 as invalid', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 404 });
      const results = await validator.validateBatch([makeRef('https://example.com/missing')], doc, enabledConfig);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('404');
    });

    it('marks 500 errors as invalid', async () => {
      httpRequestMock.mockResponseOnce('', { status: 500 });
      const results = await validator.validateBatch([makeRef('https://example.com/error')], doc, enabledConfig);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('500');
    });

    it('aborts a pending request after the configured timeout', async () => {
      vi.useFakeTimers();
      let requestSignal: AbortSignal | undefined;
      requestMock.mockImplementationOnce((_url: URL, options: http.RequestOptions) => {
        requestSignal = options.signal;
        const request = new EventEmitter() as http.ClientRequest;
        request.end = vi.fn(() => request) as http.ClientRequest['end'];
        requestSignal?.addEventListener('abort', () => request.emit('error', requestSignal?.reason), { once: true });
        return request;
      });

      try {
        const resultPromise = validator.validateBatch([makeRef('https://slow.example.com/')], doc, enabledConfig);
        await vi.advanceTimersByTimeAsync(0);
        expect(requestSignal?.aborted).toBe(false);

        await vi.advanceTimersByTimeAsync(5001);
        const results = await resultPromise;

        expect(requestSignal?.aborted).toBe(true);
        expect(results[0].valid).toBe(false);
        expect(results[0].skipped).not.toBe(true);
        expect(results[0].message).toContain('timeout');
      }
      finally {
        vi.useRealTimers();
      }
    });

    it('handles request network error', async () => {
      httpRequestMock.mockRejectOnce(new Error('ECONNREFUSED'));
      const results = await validator.validateBatch([makeRef('https://down.example.com/')], doc, enabledConfig);
      expect(results[0].valid).toBe(false);
      expect(results[0].message).toContain('ECONNREFUSED');
    });

    it('respects custom severity from config', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 404 });
      const config: DocFreshnessConfig = {
        urlValidation: { enabled: true },
        rules: { 'external-url': { severity: 'error' } },
      };
      const results = await validator.validateBatch([makeRef('https://example.com/missing')], doc, config);
      expect(results[0].severity).toBe('error');
    });
  });

  describe('deduplication', () => {
    it('deduplicates identical URLs', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });
      const refs = [makeRef('https://same.com'), makeRef('https://same.com')];
      const results = await validator.validateBatch(refs, doc, enabledConfig);
      expect(results).toHaveLength(2);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache', () => {
    it('uses cached result for repeated URL within cache window', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });
      await validator.validateBatch([makeRef('https://cached.example.com/')], doc, enabledConfig);

      const results = await validator.validateBatch([makeRef('https://cached.example.com/')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);
    });

    it('loadCache and exportCache round-trip correctly', () => {
      const data = { 'https://example.com': { result: { valid: true }, timestamp: Date.now() } };
      validator.loadCache(data);
      const exported = validator.exportCache();
      expect(exported['https://example.com'].result.valid).toBe(true);
    });
  });

  describe('concurrency', () => {
    it('respects concurrency limit', async () => {
      for (let i = 0; i < 10; i++) {
        httpRequestMock.mockResponseOnce('', { status: 200 });
      }
      const refs = Array.from({ length: 10 }, (_, i) => makeRef(`https://example${i}.com/`));
      const config: DocFreshnessConfig = { urlValidation: { enabled: true, concurrency: 3 } };
      const results = await validator.validateBatch(refs, doc, config);
      expect(results).toHaveLength(10);
    });
  });

  describe('IPv6 SSRF protection', () => {
    it('skips [::1] IPv6 loopback', async () => {
      const results = await validator.validateBatch([makeRef('http://[::1]:8080/')], doc, enabledConfig);
      expect(results[0].skipped).toBe(true);
    });
  });

  describe('GitHub URL detection', () => {
    it('treats raw.githubusercontent.com 404 as potentially valid', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 404 });
      const results = await validator.validateBatch(
        [makeRef('https://raw.githubusercontent.com/owner/repo/main/file.txt')],
        doc,
        enabledConfig
      );
      expect(results[0].valid).toBe(true);
    });

    it('treats subdomain.github.com 404 as potentially valid', async () => {
      httpRequestMock.mockResponseOnce('', { status: 404 });
      httpRequestMock.mockResponseOnce('', { status: 404 });
      const results = await validator.validateBatch([makeRef('https://docs.github.com/missing')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
    });
  });

  it('handles 403 as valid (authentication required)', async () => {
    httpRequestMock.mockResponseOnce('', { status: 403 });
    const results = await validator.validateBatch([makeRef('https://api.example.com/private')], doc, enabledConfig);
    expect(results[0].valid).toBe(true);
    expect(results[0].message).toContain('authentication');
  });

  describe('cache expiry', () => {
    it('re-fetches when cache entry expires', async () => {
      httpRequestMock.mockResponseOnce('', { status: 200 });
      await validator.validateBatch([makeRef('https://expires.example.com/')], doc, enabledConfig);
      expect(httpRequestMock).toHaveBeenCalledTimes(1);

      validator.loadCache({
        'https://expires.example.com/': {
          result: { valid: true },
          timestamp: Date.now() - 999_999_999,
        },
      });

      httpRequestMock.mockResponseOnce('', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://expires.example.com/')], doc, {
        urlValidation: { enabled: true, cacheSeconds: 1 },
      });
      expect(results[0].valid).toBe(true);
      expect(httpRequestMock).toHaveBeenCalledTimes(2);
    });
  });

  describe('DNS resolution to private IP', () => {
    it('skips public hostnames that resolve to private IPs', async () => {
      vi.mocked(dns.lookup).mockImplementationOnce((async () => {
        return [{ address: '127.0.0.1', family: 4 }];
      }) as unknown as typeof dns.lookup);
      const results = await validator.validateBatch([makeRef('https://public.example.com/api')], doc, enabledConfig);
      expect(results[0].skipped).toBe(true);
      expect(results[0].message).toContain('resolves to private');
    });
  });

  describe('unsupported protocol severity', () => {
    it('uses custom severity for unsupported protocol', async () => {
      const config: DocFreshnessConfig = {
        urlValidation: { enabled: true },
        rules: { 'external-url': { severity: 'error' } },
      };
      const results = await validator.validateBatch([makeRef('ftp://files.example.com')], doc, config);
      expect(results[0].severity).toBe('error');
    });
  });

  describe('response body disposal', () => {
    it('handles HEAD response with 200 ok', async () => {
      httpRequestMock.mockResponseOnce('body content', { status: 200 });
      const results = await validator.validateBatch([makeRef('https://body-drain.example.com/')], doc, enabledConfig);
      expect(results[0].valid).toBe(true);
      expect(results[0].statusCode).toBe(200);
      expect(responseDestroyMocks[0]).toHaveBeenCalled();
    });
  });
});
