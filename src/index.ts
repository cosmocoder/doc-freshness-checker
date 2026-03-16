/**
 * Documentation Freshness Checker
 *
 * A universal, project-agnostic tool that validates documentation accuracy
 * by checking references against the actual codebase.
 */

export { run, runWithConfig } from './runner.js';
export { loadConfig, DEFAULT_CONFIG } from './config/loader.js';
export { defineConfig } from './config/defineConfig.js';
export { DocumentParser } from './parsers/documentParser.js';
export { ValidationEngine } from './validators/validationEngine.js';
export { BaseExtractor } from './parsers/extractors/baseExtractor.js';
export { FilePathExtractor } from './parsers/extractors/filePathExtractor.js';
export { VersionExtractor } from './parsers/extractors/versionExtractor.js';
export { DirectoryStructureExtractor } from './parsers/extractors/directoryStructureExtractor.js';
export { CodePatternExtractor } from './parsers/extractors/codePatternExtractor.js';
export { ExternalUrlExtractor } from './parsers/extractors/externalUrlExtractor.js';
export { DependencyExtractor } from './parsers/extractors/dependencyExtractor.js';
export { CodeSnippetExtractor } from './parsers/extractors/codeSnippetExtractor.js';
export { FileValidator } from './validators/fileValidator.js';
export { UrlValidator } from './validators/urlValidator.js';
export { VersionValidator } from './validators/versionValidator.js';
export { DirectoryValidator } from './validators/directoryValidator.js';
export { CodePatternValidator } from './validators/codePatternValidator.js';
export { DependencyValidator } from './validators/dependencyValidator.js';
export { CodeSnippetValidator } from './validators/codeSnippetValidator.js';
export { ConsoleReporter } from './reporters/consoleReporter.js';
export { JsonReporter } from './reporters/jsonReporter.js';
export { MarkdownReporter } from './reporters/markdownReporter.js';
export { EnhancedReporter } from './reporters/enhancedReporter.js';
export { CodeDocGraph } from './graph/codeDocGraph.js';
export { GraphBuilder } from './graph/graphBuilder.js';
export { GitChangeTracker } from './git/changeTracker.js';
export { CacheManager } from './cache/cacheManager.js';
export { FreshnessScorer } from './scoring/freshnessScorer.js';
export { Plugin } from './plugins/plugin.js';
export { IncrementalChecker } from './utils/incremental.js';
export { VectorSearch } from './semantic/vectorSearch.js';

// Re-export types
export type {
  DocFreshnessConfig,
  Document,
  DocumentFormat,
  Reference,
  ValidationResult,
  ValidationResults,
  ValidationSummary,
  DocumentIssues,
  VectorMismatch,
  Severity,
  RuleConfig,
  VersionRuleConfig,
  RulesConfig,
  UrlValidationConfig,
  GraphConfig,
  GitConfig,
  FreshnessScoringConfig,
  FreshnessScoringWeights,
  FreshnessScoringThresholds,
  VectorSearchConfig,
  CacheConfig,
  IncrementalConfig,
  ReporterType,
  Grade,
  DocScore,
  ProjectScores,
  CommitInfo,
  ChangeSummaryItem,
  IndexMetadata,
  CacheStats,
  SymbolLocation,
  SourceFileData,
  CodeFile,
  CodeSnippetRuleConfig,
  BaseExtractor as BaseExtractorType,
  BaseValidator,
} from './types.js';
