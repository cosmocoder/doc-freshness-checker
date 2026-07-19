import crypto from 'crypto';
import { registerHooks } from 'module';
import { pathToFileURL } from 'url';

/**
 * Load an ESM config as a module from its original URL so relative imports and
 * import.meta resolve from the config directory, regardless of package type.
 */
export async function loadESMConfig<T>(content: string, filePath: string): Promise<T> {
  const configUrl = pathToFileURL(filePath);
  configUrl.searchParams.set('doc-freshness-reload', crypto.randomUUID());
  const transformedContent = transformConfigContent(content);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== configUrl.href) {
        return nextResolve(specifier, context);
      }

      return { url: configUrl.href, format: 'module', shortCircuit: true };
    },
    load(url, context, nextLoad) {
      if (url !== configUrl.href) {
        return nextLoad(url, context);
      }

      return { format: 'module', source: transformedContent, shortCircuit: true };
    },
  });

  try {
    const module = await import(configUrl.href);
    return (module.default || module) as T;
  }
  finally {
    hooks.deregister();
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
