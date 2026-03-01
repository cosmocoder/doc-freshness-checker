/**
 * Global test setup for Vitest
 */

import createFetchMock from 'vitest-fetch-mock';

const fetchMocker = createFetchMock(vi);
fetchMocker.enableMocks();

afterEach(() => {
  fetchMocker.resetMocks();
  vi.clearAllMocks();
});
