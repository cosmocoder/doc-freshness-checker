import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { DEFAULT_CONFIG } from './defaults.js';
import type { DocFreshnessConfig } from '../types.js';

export { DEFAULT_CONFIG };

// Create a require function for loading CJS modules
const require = createRequire(import.meta.url);

const MANIFEST_CANDIDATES = ['package.json', 'requirements.txt', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle'];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
const SOURCE_GLOB = `**/*.{${SOURCE_EXTENSIONS.map((ext) => ext.slice(1)).join(',')}}`;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '__pycache__', 'vendor', 'target']);

/**
 * Load and merge configuration
 */
export async function loadConfig(configPath?: string): Promise<DocFreshnessConfig> {
  const configFile = configPath || findConfigFile();

  if (!configFile) {
    // Note: We can't check verbose here as config isn't loaded yet
    // This message will only show in verbose mode from the runner
    return await autoDetectConfig({ ...DEFAULT_CONFIG, _noConfigFile: true });
  }

  const fullPath = path.resolve(process.cwd(), configFile);
  const extension = path.extname(configFile).toLowerCase();

  try {
    let userConfig: DocFreshnessConfig;

    if (extension === '.json') {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      userConfig = JSON.parse(content);
    } else if (extension === '.cjs') {
      userConfig = loadCjsConfig(fullPath);
    } else {
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      userConfig = detectModuleType(content, fullPath) ? await loadESMConfig(content, fullPath) : loadCjsConfig(fullPath);
    }

    const merged = mergeConfig(DEFAULT_CONFIG, userConfig);
    merged._configFile = configFile;
    return await autoDetectConfig(merged);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND') {
      console.log('Config file not found, using defaults');
      return await autoDetectConfig({ ...DEFAULT_CONFIG, _noConfigFile: true });
    }
    throw error;
  }
}

/**
 * Load ESM config file via dynamic import with a temp .mjs file
 * to avoid the Node.js MODULE_TYPELESS_PACKAGE_JSON warning.
 */
async function loadESMConfig(content: string, filePath: string): Promise<DocFreshnessConfig> {
  const transformedContent = transformConfigContent(content);

  const tempDir = path.join(path.dirname(filePath), '.doc-freshness-cache');
  const tempFile = path.join(tempDir, `temp-config-${Date.now()}-${crypto.randomUUID()}.mjs`);

  try {
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.writeFile(tempFile, transformedContent, 'utf-8');

    const configUrl = pathToFileURL(tempFile).href;
    const module = await import(configUrl);

    return module.default || module;
  } finally {
    await fs.promises.unlink(tempFile).catch(() => {});
  }
}

/**
 * Transform config content to handle doc-freshness-checker imports
 * Replaces the import with a local defineConfig function
 */
function transformConfigContent(content: string): string {
  // Replace import from doc-freshness-checker with local defineConfig
  const importPattern = /import\s*\{\s*defineConfig\s*\}\s*from\s*['"]doc-freshness-checker['"]\s*;?/g;

  return content.replace(importPattern, 'const defineConfig = (config) => config;');
}

/**
 * Detect if file content is ESM or CommonJS
 * Returns true for ESM, false for CommonJS
 */
function detectModuleType(content: string, filePath: string): boolean {
  // Check file extension first
  if (filePath.endsWith('.mjs')) return true;
  if (filePath.endsWith('.cjs')) return false;

  // Check for ESM syntax indicators
  const esmPatterns = [
    /^\s*export\s+default\s/m, // export default
    /^\s*export\s+\{/m, // export { ... }
    /^\s*export\s+(const|let|var|function|class)\s/m, // export const/let/var/function/class
    /^\s*import\s+.*\s+from\s+['"].*['"]/m, // import ... from '...'
    /^\s*import\s+['"].*['"]/m, // import '...'
  ];

  // Check for CommonJS syntax indicators
  const cjsPatterns = [
    /\bmodule\.exports\s*=/, // module.exports =
    /\bexports\.\w+\s*=/, // exports.foo =
    /\brequire\s*\(\s*['"].*['"]\s*\)/, // require('...')
  ];

  const hasESM = esmPatterns.some((pattern) => pattern.test(content));
  const hasCJS = cjsPatterns.some((pattern) => pattern.test(content));

  // If file has ESM syntax, treat as ESM
  if (hasESM && !hasCJS) return true;

  // If file has CJS syntax, treat as CJS
  if (hasCJS && !hasESM) return false;

  // If mixed or unclear, check project's package.json
  try {
    const projectRoot = process.cwd();
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.type === 'module') return true;
    }
  } catch {
    // Ignore package.json read errors
  }

  // Default to ESM if has ESM syntax, otherwise CJS
  return hasESM;
}

/**
 * Find configuration file in common locations
 */
function findConfigFile(): string | null {
  const candidates = ['.doc-freshness.config.js', '.doc-freshness.config.json', 'doc-freshness.config.js', 'doc-freshness.config.json'];

  for (const candidate of candidates) {
    if (fs.existsSync(path.resolve(process.cwd(), candidate))) {
      return candidate;
    }
  }

  return null;
}

/**
 * Auto-detect project configuration based on files present
 */
async function autoDetectConfig(config: DocFreshnessConfig): Promise<DocFreshnessConfig> {
  config.rootDir = config.rootDir || process.cwd();

  // Auto-detect manifest files if not specified
  if (!config.manifestFiles) {
    config.manifestFiles = detectManifestFiles(config.rootDir);
  }

  // Auto-detect source patterns if not specified
  if (!config.sourcePatterns) {
    config.sourcePatterns = detectSourcePatterns(config.rootDir);
  }

  return config;
}

/**
 * Detect manifest files present in the project
 */
function detectManifestFiles(rootDir: string): string[] {
  return MANIFEST_CANDIDATES.filter((f) => fs.existsSync(path.join(rootDir, f)));
}

/**
 * Detect source code patterns based on project structure
 * Dynamically scans the project to find directories containing source code
 */
function detectSourcePatterns(rootDir: string): string[] {
  const patterns: string[] = [];

  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Skip common non-source directories
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

      const dirPath = path.join(rootDir, entry.name);

      if (containsSourceFiles(dirPath, SOURCE_EXTENSIONS)) {
        const srcPath = path.join(dirPath, 'src');
        const pattern =
          fs.existsSync(srcPath) && containsSourceFiles(srcPath, SOURCE_EXTENSIONS)
            ? `${entry.name}/src/${SOURCE_GLOB}`
            : `${entry.name}/${SOURCE_GLOB}`;
        patterns.push(pattern);
      }
    }
  } catch {
    // Fallback if directory reading fails
  }

  // Fallback to broad pattern if nothing found
  if (patterns.length === 0) {
    patterns.push(SOURCE_GLOB);
  }

  return patterns;
}

/**
 * Check if a directory contains source files (non-recursively, just top level or one level deep)
 */
function containsSourceFiles(dirPath: string, extensions: string[]): boolean {
  const isSourceExt = (name: string) => extensions.includes(path.extname(name).toLowerCase());

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && isSourceExt(entry.name)) return true;

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        // Check one level deep
        const subPath = path.join(dirPath, entry.name);
        try {
          if (fs.readdirSync(subPath).some(isSourceExt)) return true;
        } catch {
          // Skip unreadable subdirectory
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return false;
}

/**
 * Deep merge user config with defaults
 */
function mergeConfig(defaults: DocFreshnessConfig, user: DocFreshnessConfig): DocFreshnessConfig {
  const result = { ...defaults } as Record<string, unknown>;

  for (const key of Object.keys(user)) {
    const userValue = (user as Record<string, unknown>)[key];
    const defaultValue = (defaults as Record<string, unknown>)[key];

    if (userValue === undefined) continue;

    if (
      typeof userValue === 'object' &&
      userValue !== null &&
      !Array.isArray(userValue) &&
      typeof defaultValue === 'object' &&
      defaultValue !== null
    ) {
      result[key] = mergeConfig(defaultValue as DocFreshnessConfig, userValue as DocFreshnessConfig);
    } else {
      result[key] = userValue;
    }
  }

  return result as DocFreshnessConfig;
}

function loadCjsConfig(fullPath: string): DocFreshnessConfig {
  const resolvedPath = require.resolve(fullPath);
  delete require.cache[resolvedPath];
  return require(resolvedPath) as DocFreshnessConfig;
}
