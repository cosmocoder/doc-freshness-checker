import fs from 'fs';
import path from 'path';

export async function withOutputFile(cacheRoot: string, fileName: string, runAssert: (outputPath: string) => Promise<void>): Promise<void> {
  const outputPath = path.join(cacheRoot, fileName);
  try {
    await runAssert(outputPath);
  } finally {
    await fs.promises.unlink(outputPath).catch(() => {});
  }
}
