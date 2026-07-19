import crypto from 'crypto';
import fs from 'fs';
import { registerHooks } from 'module';
import { pathToFileURL } from 'url';

const activeConfigSources = new Map<string, string>();
let registeredHooks: ReturnType<typeof registerHooks> | null = null;

function registerESMLoaderHook(): void {
  if (registeredHooks) {
    return;
  }

  registeredHooks = registerHooks({
    load(url, context, nextLoad) {
      const source = activeConfigSources.get(url);
      if (source === undefined) {
        return nextLoad(url, context);
      }

      return { format: 'module', source, shortCircuit: true };
    },
  });
}

function releaseESMLoaderHook(): void {
  if (registeredHooks && activeConfigSources.size === 0) {
    registeredHooks.deregister();
    registeredHooks = null;
  }
}

/**
 * Load an ESM config as a module from its original URL so relative imports and
 * import.meta resolve from the config directory, regardless of package type.
 */
export async function loadESMConfig<T>(content: string, filePath: string): Promise<T> {
  const configUrl = pathToFileURL(await fs.promises.realpath(filePath));
  configUrl.searchParams.set('doc-freshness-reload', crypto.randomUUID());
  registerESMLoaderHook();
  activeConfigSources.set(configUrl.href, transformConfigContent(content));

  try {
    const module = await import(configUrl.href);
    return (module.default || module) as T;
  }
  finally {
    activeConfigSources.delete(configUrl.href);
    releaseESMLoaderHook();
  }
}

/**
 * Replace the documented defineConfig import so globally installed CLI usage
 * does not require the project to install this package locally.
 */
function transformConfigContent(content: string): string {
  const importPattern = /import\s*\{\s*defineConfig\s*\}\s*from\s*['"]doc-freshness-checker['"]\s*;?/g;
  return content.replace(importPattern, 'const defineConfig = (config) => config;');
}
