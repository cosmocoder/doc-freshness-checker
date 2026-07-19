import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const hookMocks = vi.hoisted(() => {
  const deregister = vi.fn();
  return { deregister, register: vi.fn(() => ({ deregister })) };
});

vi.mock('module', async (importOriginal) => ({
  ...(await importOriginal<typeof import('module')>()),
  registerHooks: hookMocks.register,
}));

import { loadESMConfig } from './esm-loader.js';

// The mocked hook isolates registration lifecycle; loader.test.ts covers real source injection.
it('shares and releases the ESM loader hook across concurrent loads', async () => {
  const directory = await fs.promises.mkdtemp(path.join(tmpdir(), 'doc-freshness-esm-loader-'));
  const paths = ['first.mjs', 'second.mjs', 'third.mjs'].map((name) => path.join(directory, name));

  try {
    await Promise.all([
      fs.promises.writeFile(paths[0], `await new Promise(r => setTimeout(r, 200)); export default {};`),
      ...paths.slice(1).map((filePath) => fs.promises.writeFile(filePath, `export default {};`)),
    ]);

    const slowLoad = loadESMConfig('{}', paths[0]);
    const fastLoad = loadESMConfig('{}', paths[1]);
    await fastLoad;
    expect(hookMocks.register).toHaveBeenCalledTimes(1);
    expect(hookMocks.deregister).toHaveBeenCalledTimes(0);

    await slowLoad;
    expect(hookMocks.deregister).toHaveBeenCalledTimes(1);

    await loadESMConfig('{}', paths[2]);
    expect(hookMocks.register).toHaveBeenCalledTimes(2);
    expect(hookMocks.deregister).toHaveBeenCalledTimes(2);
  }
  finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
