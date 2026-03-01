import fs from 'fs';
import path from 'path';
import { DocumentParser } from './parsers/documentParser.js';
import { FilePathExtractor } from './parsers/extractors/filePathExtractor.js';
import { VersionExtractor } from './parsers/extractors/versionExtractor.js';
import { DirectoryStructureExtractor } from './parsers/extractors/directoryStructureExtractor.js';
import { CodePatternExtractor } from './parsers/extractors/codePatternExtractor.js';
import { ExternalUrlExtractor } from './parsers/extractors/externalUrlExtractor.js';
import { DependencyExtractor } from './parsers/extractors/dependencyExtractor.js';
import { ValidationEngine } from './validators/validationEngine.js';
import { FileValidator } from './validators/fileValidator.js';
import { UrlValidator } from './validators/urlValidator.js';
import { VersionValidator } from './validators/versionValidator.js';
import { DirectoryValidator } from './validators/directoryValidator.js';
import { CodePatternValidator } from './validators/codePatternValidator.js';
import { DependencyValidator } from './validators/dependencyValidator.js';
import { ConsoleReporter } from './reporters/consoleReporter.js';
import { JsonReporter } from './reporters/jsonReporter.js';
import { MarkdownReporter } from './reporters/markdownReporter.js';
import { EnhancedReporter } from './reporters/enhancedReporter.js';
import { GraphBuilder } from './graph/graphBuilder.js';
import { GitChangeTracker } from './git/changeTracker.js';
import { CacheManager } from './cache/cacheManager.js';
import { FreshnessScorer } from './scoring/freshnessScorer.js';
import { IncrementalChecker } from './utils/incremental.js';
import { VectorSearch } from './semantic/vectorSearch.js';
import { loadConfig } from './config/loader.js';
import type { CodeDocGraph } from './graph/codeDocGraph.js';
import type { DocFreshnessConfig, ProjectScores, ValidationResults, VectorMismatch } from './types.js';

/**
 * Main entry point - run with config object
 */
export async function run(config: DocFreshnessConfig): Promise<ValidationResults> {
  // Show config file status in verbose mode
  if (config.verbose) {
    if (config._configFile) {
      console.log(`Using config file: ${config._configFile}`);
    } else if (config._noConfigFile) {
      console.log('No config file found, using defaults with auto-detection');
    }
    if (config.sourcePatterns) {
      console.log(`Source patterns: ${config.sourcePatterns.join(', ')}`);
    }
  }

  // Clear cache if requested
  if (config.clearCache) {
    const cacheManager = new CacheManager(config);
    await cacheManager.clearCache();
    if (config.verbose) {
      console.log('Cache cleared.');
    }
  }

  // Initialize components
  const parser = new DocumentParser(config);
  const validationEngine = new ValidationEngine(config);

  // Register extractors
  parser.registerExtractor(new FilePathExtractor());
  parser.registerExtractor(new VersionExtractor(config));
  parser.registerExtractor(new DirectoryStructureExtractor());
  parser.registerExtractor(new CodePatternExtractor(config));
  parser.registerExtractor(new ExternalUrlExtractor());
  parser.registerExtractor(new DependencyExtractor(config));

  // Register custom extractors
  if (config.customExtractors) {
    for (const extractor of config.customExtractors) {
      parser.registerExtractor(extractor);
    }
  }

  // Register validators
  const codePatternValidator = new CodePatternValidator();
  const urlValidator = new UrlValidator();

  validationEngine.registerValidator('file-path', new FileValidator());
  validationEngine.registerValidator('external-url', urlValidator);
  validationEngine.registerValidator('version', new VersionValidator());
  validationEngine.registerValidator('directory-structure', new DirectoryValidator());
  validationEngine.registerValidator('code-pattern', codePatternValidator);
  validationEngine.registerValidator('dependency', new DependencyValidator());

  // Register custom validators
  if (config.customValidators) {
    for (const [type, validator] of Object.entries(config.customValidators)) {
      validationEngine.registerValidator(type, validator);
    }
  }

  // Load URL cache if available
  if (config.cache?.enabled !== false) {
    const cacheManager = new CacheManager(config);
    const urlCache = await cacheManager.loadUrlCache();
    urlValidator.loadCache(urlCache);
  }

  // Parse documents
  if (config.verbose) {
    console.log('Scanning documentation files...');
  }

  let documents = await parser.scanDocuments();

  if (config.verbose) {
    console.log(`Found ${documents.length} documentation files.`);
  }

  // Apply incremental checking if enabled
  let incrementalChecker: IncrementalChecker | null = null;
  if (config.incremental?.enabled) {
    incrementalChecker = new IncrementalChecker(config.cache?.dir || '.doc-freshness-cache');
    const allDocs = documents;
    documents = await incrementalChecker.filterChanged(documents);

    if (config.verbose) {
      const stats = incrementalChecker.getStats(allDocs.length, documents.length);
      console.log(`Incremental mode: checking ${stats.changed} changed files, skipping ${stats.skipped} unchanged.`);
    }
  }

  if (config.verbose) {
    const totalRefs = documents.reduce((sum, doc) => sum + doc.references.length, 0);
    console.log(`Extracted ${totalRefs} references.`);
  }

  // Validate references
  if (config.verbose) {
    console.log('Validating references...');
  }

  const results = await validationEngine.validate(documents);

  // Save incremental state
  if (incrementalChecker) {
    await incrementalChecker.saveState();
  }

  // Build graph if enabled
  let graph: CodeDocGraph | null = null;
  let gitTracker: GitChangeTracker | null = null;
  let freshnessScores: ProjectScores | null = null;

  if (config.graph?.enabled !== false) {
    gitTracker = new GitChangeTracker(config);

    // Build source code index for graph
    await codePatternValidator.buildSourceIndex(config);
    const codeIndex = codePatternValidator.getSourceIndex();

    // Build graph
    const graphBuilder = new GraphBuilder(config);
    graph = await graphBuilder.buildGraph(documents, codeIndex);

    if (gitTracker.isGitRepo()) {
      graph.gitCommit = gitTracker.getCurrentCommit();
    }

    // Save graph cache
    if (config.cache?.enabled !== false) {
      const cacheManager = new CacheManager(config);
      await cacheManager.saveGraph(graph);
      await cacheManager.saveUrlCache(urlValidator.exportCache());
    }

    // Calculate freshness scores if enabled
    if (config.freshnessScoring?.enabled) {
      const scorer = new FreshnessScorer(config);
      freshnessScores = scorer.calculateProjectScores(documents, results, gitTracker, graph);
    }
  }

  // Run vector search if enabled
  let vectorMismatches: VectorMismatch[] | null = null;
  if (config.vectorSearch?.enabled) {
    // Always show this message since embedding generation can take time
    console.log('🔍 Running semantic analysis (this may take a moment on first run)...');

    const vectorSearch = new VectorSearch(config);

    // Index documentation
    if (config.verbose) {
      console.log('  Indexing documentation sections...');
    }
    await vectorSearch.indexDocumentation(documents);

    // Ensure source index is built (may already be built if graph is enabled)
    if (!codePatternValidator.getSourceIndex()) {
      if (config.verbose) {
        console.log('  Building source code index...');
      }
      await codePatternValidator.buildSourceIndex(config);
    }

    // Index code comments from source files
    const sourceFiles = codePatternValidator.getSourceFiles();
    if (sourceFiles && sourceFiles.size > 0) {
      if (config.verbose) {
        console.log(`  Indexing code comments from ${sourceFiles.size} source files...`);
      }
      const codeFiles = Array.from(sourceFiles.entries()).map(([filePath, data]) => ({
        path: filePath,
        content: data.content,
        language: data.language,
      }));
      await vectorSearch.indexCodeComments(codeFiles);
    }

    // Find mismatches
    if (config.verbose) {
      console.log('  Finding semantic mismatches...');
    }
    vectorMismatches = await vectorSearch.findMismatches();

    const stats = vectorSearch.getCacheStats();
    console.log(`  ✓ Analyzed ${stats.indexedDocSections} doc sections and ${stats.indexedCodeComments} code comments`);

    if (config.verbose) {
      console.log(`  Found ${vectorMismatches.length} potential semantic mismatches.`);
    }

    // Add vector mismatches to results
    if (vectorMismatches.length > 0) {
      results.vectorMismatches = vectorMismatches;
    }
  }

  // Generate reports
  await generateReports(results, config, graph, gitTracker, freshnessScores, vectorMismatches);

  return results;
}

/**
 * Run with config file path
 */
export async function runWithConfig(configPath: string): Promise<ValidationResults> {
  const config = await loadConfig(configPath);
  return run(config);
}

/**
 * Generate reports based on configuration
 */
async function generateReports(
  results: ValidationResults,
  config: DocFreshnessConfig,
  graph: CodeDocGraph | null,
  gitTracker: GitChangeTracker | null,
  freshnessScores: ProjectScores | null,
  _vectorMismatches: VectorMismatch[] | null
): Promise<void> {
  const reporters = config.reporters || ['console'];

  for (const reporterType of reporters) {
    let reporter;
    let output: string;

    switch (reporterType) {
      case 'console':
        reporter = new ConsoleReporter();
        if (freshnessScores) {
          reporter.generateWithScores(results, freshnessScores);
        } else {
          reporter.generate(results);
        }
        break;

      case 'json':
        reporter = new JsonReporter();
        output = freshnessScores
          ? reporter.generateWithScores(results, freshnessScores)
          : reporter.generate(results);

        if (config.outputPath) {
          await writeOutput(config.outputPath, output);
          if (config.verbose) {
            console.log(`JSON report written to ${config.outputPath}`);
          }
        } else {
          console.log(output);
        }
        break;

      case 'markdown':
        reporter = new MarkdownReporter();
        output = freshnessScores
          ? reporter.generateWithScores(results, freshnessScores)
          : reporter.generate(results);

        if (config.outputPath) {
          await writeOutput(config.outputPath, output);
          if (config.verbose) {
            console.log(`Markdown report written to ${config.outputPath}`);
          }
        } else {
          console.log(output);
        }
        break;

      case 'enhanced':
        reporter = new EnhancedReporter();
        output = reporter.generateScanReport(results, graph, gitTracker, freshnessScores);

        if (config.outputPath) {
          await writeOutput(config.outputPath, output);
          if (config.verbose) {
            console.log(`Enhanced report written to ${config.outputPath}`);
          }
        } else {
          console.log(output);
        }
        break;

      default:
        if (config.verbose) {
          console.warn(`Unknown reporter type: ${reporterType}`);
        }
    }
  }
}

/**
 * Write output to file, creating directory if needed
 */
async function writeOutput(outputPath: string, content: string): Promise<void> {
  const dir = path.dirname(outputPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(outputPath, content, 'utf-8');
}
