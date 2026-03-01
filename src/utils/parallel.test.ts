import { runParallel, batch, delay } from './parallel.js';

describe('batch', () => {
  it.each([
    { input: [1, 2, 3, 4, 5], size: 2, expected: [[1, 2], [3, 4], [5]] },
    { input: [1, 2, 3], size: 5, expected: [[1, 2, 3]] },
    { input: [] as number[], size: 3, expected: [] },
  ])('splits array of $input.length into chunks of $size', ({ input, size, expected }) => {
    expect(batch(input, size)).toEqual(expected);
  });

  it('throws when batch size is non-positive', () => {
    expect(() => batch([1, 2, 3], 0)).toThrow('Batch size must be greater than 0');
    expect(() => batch([1, 2, 3], -1)).toThrow('Batch size must be greater than 0');
  });
});

describe('delay', () => {
  it('resolves after the specified time', async () => {
    const start = Date.now();
    await delay(50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});

describe('runParallel', () => {
  it('runs all tasks and returns results in order', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)];
    const results = await runParallel(tasks);
    expect(results).toEqual([1, 2, 3]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const makeTask = (val: number) => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(20);
      concurrent--;
      return val;
    };

    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(i));
    const results = await runParallel(tasks, 2);

    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('propagates errors from tasks', async () => {
    const tasks = [() => Promise.resolve(1), () => Promise.reject(new Error('fail'))];
    await expect(runParallel(tasks)).rejects.toThrow('fail');
  });
});
