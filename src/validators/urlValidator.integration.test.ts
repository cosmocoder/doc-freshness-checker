import dns from 'dns/promises';
import { createServer } from 'http';
import net from 'net';
import type { AddressInfo } from 'net';
import type { DocFreshnessConfig } from '../types.js';
import { makeDoc, makeRef as makeBaseRef } from '../test-utils/factories.js';
import { UrlValidator } from './urlValidator.js';

vi.mock('dns/promises', () => ({
  default: { lookup: vi.fn() },
}));

const enabledConfig: DocFreshnessConfig = { urlValidation: { enabled: true, timeout: 5000 } };

function makeRef(url: string) {
  return makeBaseRef('external-url', url);
}

describe('UrlValidator real transport', () => {
  it('pins the validated DNS address for a hostname that does not resolve normally', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200);
      response.end();
    });
    const blockListCheck = vi.spyOn(net.BlockList.prototype, 'check').mockReturnValue(false);

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      vi.mocked(dns.lookup).mockImplementation((async () => [{ address: '127.0.0.1', family: 4 }]) as unknown as typeof dns.lookup);

      const results = await new UrlValidator().validateBatch([makeRef(`http://pin.test.invalid:${port}/`)], makeDoc(), enabledConfig);

      expect(results[0].valid).toBe(true);
      expect(results[0].statusCode).toBe(200);
      expect(dns.lookup).toHaveBeenCalledWith('pin.test.invalid', { all: true, verbatim: true });
      expect(blockListCheck).toHaveBeenCalled();
    }
    finally {
      blockListCheck.mockRestore();
      if (server.listening) {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      }
    }
  });
});
