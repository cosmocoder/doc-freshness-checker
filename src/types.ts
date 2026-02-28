/**
 * Core type definitions for Documentation Freshness Checker
 */

// ============================================================================
// Configuration Types
// ============================================================================

export type Severity = 'error' | 'warning' | 'info';

export interface RuleConfig {
  enabled?: boolean;
  severity?: Severity;
}

export interface FilePathRuleConfig extends RuleConfig {
  /**
   * Patterns to identify illustrative/placeholder paths that shouldn't be validated
   * These are typically example paths in tutorials/guides that don't actually exist
   * Supports regex patterns (as strings) that match against the full path or filename
   */
  illustrativePatterns?: string[];
  /**
   * Skip validation for paths detected as illustrative (default: true)
   * When true, illustrative paths won't generate errors/warnings
   * When false, they'll be flagged with reduced severity (info)
   */
  skipIllustrative?: boolean;
}

export interface DirectoryStructureRuleConfig extends RuleConfig {
  /**
   * Patterns to identify illustrative/placeholder paths in directory trees
   */
  illustrativePatterns?: string[];
  /**
   * Skip validation for paths detected as illustrative (default: true)
   */
  skipIllustrative?: boolean;
}

export interface VersionRuleConfig extends RuleConfig {
  allowMinorDrift?: boolean;
}

export interface RulesConfig {
  'file-path'?: FilePathRuleConfig;
  'external-url'?: RuleConfig;
  version?: VersionRuleConfig;
  'directory-structure'?: DirectoryStructureRuleConfig;
  'code-pattern'?: RuleConfig;
  dependency?: RuleConfig;
  [key: string]: RuleConfig | VersionRuleConfig | FilePathRuleConfig | DirectoryStructureRuleConfig | undefined;
}

export interface UrlValidationConfig {
  enabled?: boolean;
  timeout?: number;
  concurrency?: number;
  skipDomains?: string[];
  cacheSeconds?: number;
}

export interface GraphConfig {
  enabled?: boolean;
  cacheDir?: string;
  cacheMaxAge?: number;
}

export interface GitConfig {
  enabled?: boolean;
  trackChanges?: boolean;
  changeWindow?: number;
}

export interface FreshnessScoringWeights {
  referenceValidity?: number;
  gitTimeDelta?: number;
  codeChangeFrequency?: number;
  symbolCoverage?: number;
}

export interface FreshnessScoringThresholds {
  gradeA?: number;
  gradeB?: number;
  gradeC?: number;
  gradeD?: number;
}

export interface FreshnessScoringConfig {
  enabled?: boolean;
  weights?: FreshnessScoringWeights;
  thresholds?: FreshnessScoringThresholds;
}

export interface VectorSearchConfig {
  enabled?: boolean;
  similarityThreshold?: number;
  indexCodeComments?: boolean;
  indexDocstrings?: boolean;
}

export interface CacheConfig {
  enabled?: boolean;
  dir?: string;
  maxAge?: number;
}

export interface IncrementalConfig {
  enabled?: boolean;
}

export type ReporterType = 'console' | 'json' | 'markdown' | 'enhanced';

export interface DocFreshnessConfig {
  rootDir?: string;
  include?: string[];
  exclude?: string[];
  manifestFiles?: string[] | null;
  sourcePatterns?: string[] | null;
  urlValidation?: UrlValidationConfig;
  rules?: RulesConfig;
  reporters?: ReporterType[];
  outputDir?: string;
  outputPath?: string;
  ignorePatterns?: string[];
  customExtractors?: BaseExtractor[];
  customValidators?: Record<string, BaseValidator>;
  graph?: GraphConfig;
  git?: GitConfig;
  freshnessScoring?: FreshnessScoringConfig;
  vectorSearch?: VectorSearchConfig;
  cache?: CacheConfig;
  incremental?: IncrementalConfig;
  verbose?: boolean;
  clearCache?: boolean;
  technologies?: string[];
  languageAliases?: Record<string, string[]>;
  languagePatterns?: Record<string, LanguagePattern[]>;
  ecosystems?: string[];
  // Internal properties
  _configFile?: string;
  _noConfigFile?: boolean;
}

// ============================================================================
// Document Types
// ============================================================================

export type DocumentFormat = 'markdown' | 'restructuredtext' | 'asciidoc' | 'plaintext';

export interface Reference {
  type: string;
  value: string;
  lineNumber: number;
  raw: string;
  sourceFile: string;
  // Optional properties for specific reference types
  linkText?: string;
  technology?: string;
  version?: string;
  kind?: string;
  language?: string;
  ecosystem?: string;
  // Line reference for file paths (e.g., "1", "26-38", "L123")
  lineRef?: string;
  // Flag indicating this is an illustrative/example path that may not exist
  isIllustrative?: boolean;
}

export interface Document {
  path: string;
  absolutePath: string;
  content: string;
  format: DocumentFormat;
  lines: string[];
  references: Reference[];
}

// ============================================================================
// Validation Types
// ============================================================================

export interface ValidationResult {
  reference: Reference;
  valid: boolean;
  severity?: Severity;
  message?: string;
  suggestion?: string | null;
  resolvedPath?: string;
  foundIn?: string[];
  foundAt?: string;
  statusCode?: number;
  skipped?: boolean;
}

export interface DocumentIssues {
  path: string;
  issues: ValidationResult[];
}

export interface ValidationSummary {
  total: number;
  valid: number;
  errors: number;
  warnings: number;
  skipped: number;
}

export interface VectorMismatch {
  docPath: string;
  docSection: string;
  docText: string;
  bestMatchScore: number;
  bestMatch: IndexMetadata | null;
  suggestion: string;
}

export interface ValidationResults {
  documents: DocumentIssues[];
  summary: ValidationSummary;
  vectorMismatches?: VectorMismatch[];
}

// ============================================================================
// Extractor & Validator Base Types
// ============================================================================

export interface LanguagePattern {
  regex: RegExp;
  kind: string;
}

export interface BaseExtractor {
  type: string;
  supportedFormats: DocumentFormat[];
  supportsFormat(format: DocumentFormat): boolean;
  extract(document: Document): Reference[];
  findLineNumber(content: string, matchIndex: number): number;
  getContext(lines: string[], lineNumber: number, contextLines?: number): string;
}

export interface BaseValidator {
  validateBatch(references: Reference[], document: Document, config: DocFreshnessConfig): Promise<ValidationResult[]>;
}

// ============================================================================
// Graph Types
// ============================================================================

export interface GraphReference extends Reference {
  resolvedCodeFile: string;
}

export interface SerializedGraph {
  docToCode: Record<string, string[]>;
  codeToDoc: Record<string, string[]>;
  codeSymbols: Record<string, string[]>;
  docReferences: Record<string, GraphReference[]>;
  buildTimestamp: number | null;
  gitCommit: string | null;
  configHash: string | null;
}

// ============================================================================
// Code Index Types
// ============================================================================

export interface SymbolLocation {
  filePath: string;
  kind: string;
  language: string;
}

export interface SourceFileData {
  content: string;
  language: string;
}

export interface CodeFile {
  path: string;
  content: string;
  language: string;
}

// ============================================================================
// Freshness Scoring Types
// ============================================================================

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface DocScore {
  document: string;
  totalScore: number;
  factors: {
    referenceValidity: number;
    gitTimeDelta: number;
    codeChangeFrequency: number;
    symbolCoverage: number;
  };
  grade: Grade;
}

export interface ProjectScores {
  projectScore: number;
  projectGrade: Grade;
  documents: DocScore[];
  summary: {
    total: number;
    gradeA: number;
    gradeB: number;
    gradeC: number;
    gradeD: number;
    gradeF: number;
  };
}

// ============================================================================
// Git Types
// ============================================================================

export interface CommitInfo {
  hash: string;
  timestamp: number;
  message: string;
}

export interface ChangeSummaryItem {
  codeFile: string;
  affectedDocs: string[];
  lastCommit: CommitInfo | null;
}

// ============================================================================
// Vector Search Types
// ============================================================================

export interface IndexMetadata {
  type: 'doc' | 'code';
  path: string;
  section?: string;
  symbol?: string;
  text: string;
}

export interface Section {
  heading: string;
  text: string;
}

export interface Comment {
  text: string;
  symbol: string;
}

export interface CacheStats {
  cachedEmbeddings: number;
  indexedDocSections: number;
  indexedCodeComments: number;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheStats2 {
  exists: boolean;
  graphSize: number;
  urlCacheSize: number;
  lastUpdated: Date | null;
}

export interface UrlCacheEntry {
  result: {
    valid: boolean;
    severity?: Severity;
    message?: string;
    statusCode?: number;
  };
  timestamp: number;
}

// ============================================================================
// Incremental Types
// ============================================================================

export interface IncrementalStats {
  total: number;
  changed: number;
  skipped: number;
  percentSkipped: number;
}

// ============================================================================
// Manifest Parser Types
// ============================================================================

export type ManifestParser = (filePath: string) => Promise<Map<string, string>>;

// ============================================================================
// Language Config Types
// ============================================================================

export interface LanguageConfig {
  extensions: string[];
  patterns: LanguagePattern[];
}
