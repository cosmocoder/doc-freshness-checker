import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { homedir } from 'os';
import { EmbeddingModel, FlagEmbedding } from 'fastembed';
import { pruneOldestEntries, setWithMaxEntries } from '../utils/boundedMap.js';
import type { CacheStats, CodeFile, Comment, DocFreshnessConfig, Document, IndexMetadata, Section, VectorMismatch } from '../types.js';

/**
 * Vector-based semantic search for documentation validation
 * Uses local embeddings via fastembed
 *
 * This feature is disabled by default and requires explicit configuration.
 */

// FastEmbed configuration
const EMBEDDING_DIMENSIONS = 384; // bge-small-en-v1.5 dimensions
const MAX_RETRIES = 3;
const MAX_EMBEDDING_CACHE_ENTRIES = 20000;

interface EmbeddingCache {
  model: string;
  dimensions: number;
  timestamp: string;
  embeddings: Record<string, number[]>;
  vectorIndex: number[][];
  indexMetadata: IndexMetadata[];
}

export class VectorSearch {
  private config: DocFreshnessConfig;
  private model: FlagEmbedding | null;
  private modelInitPromise: Promise<boolean> | null;
  private vectorIndex: number[][];
  private indexMetadata: IndexMetadata[];
  private embeddingCache: Map<string, number[]>;
  private cacheLoaded: boolean;
  private dimensions: number;
  private cacheDir: string;
  private embeddingCacheFile: string;
  private modelCacheDir: string;

  constructor(config: DocFreshnessConfig) {
    this.config = config;
    this.model = null;
    this.modelInitPromise = null;
    this.vectorIndex = [];
    this.indexMetadata = [];
    this.embeddingCache = new Map();
    this.cacheLoaded = false;
    this.dimensions = EMBEDDING_DIMENSIONS;

    // Cache settings
    this.cacheDir = config.cache?.dir || '.doc-freshness-cache';
    this.embeddingCacheFile = path.join(this.cacheDir, 'embedding-cache.json');
    this.modelCacheDir = path.join(homedir(), '.doc-freshness', 'fastembed-cache');
  }

  /**
   * Initialize the FastEmbed model (lazy loading)
   */
  async initialize(): Promise<boolean> {
    if (this.model) return true;

    // Wait for existing initialization if in progress
    if (this.modelInitPromise) {
      return this.modelInitPromise;
    }

    this.modelInitPromise = this.initializeModel();
    return this.modelInitPromise;
  }

  private async initializeModel(): Promise<boolean> {
    try {
      // Ensure cache directory exists
      await fs.promises.mkdir(this.modelCacheDir, { recursive: true });

      // Check if this is a first-time download (model not cached yet)
      const modelCacheExists = await this.checkModelCacheExists();
      if (!modelCacheExists) {
        console.log('  Downloading embedding model (first run only)...');
      } else if (this.config.verbose) {
        console.log(`  Loading embedding model from cache...`);
      }

      let retries = 0;
      while (retries < MAX_RETRIES) {
        try {
          this.model = await FlagEmbedding.init({
            model: EmbeddingModel.BGESmallENV15,
            cacheDir: this.modelCacheDir,
          });

          if (this.config.verbose) {
            console.log('  Embedding model loaded.');
          }

          this.modelInitPromise = null;
          return true;
        } catch (initError) {
          retries++;
          if (this.config.verbose) {
            console.warn(`  Model initialization attempt ${retries}/${MAX_RETRIES} failed: ${(initError as Error).message}`);
          }

          if (retries >= MAX_RETRIES) {
            throw initError;
          }

          // Wait before retrying (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, retries * 2000));
        }
      }

      return false;
    } catch (error) {
      this.modelInitPromise = null;
      console.warn('Vector search initialization failed:', (error as Error).message);
      this.model = null;
      return false;
    }
  }

  /**
   * Check if vector search is available
   */
  isAvailable(): boolean {
    return this.model !== null;
  }

  /**
   * Check if model cache directory has the model files
   */
  private async checkModelCacheExists(): Promise<boolean> {
    try {
      const entries = await fs.promises.readdir(this.modelCacheDir, { withFileTypes: true });
      // Check if there are any subdirectories (fastembed stores models in subdirs like 'fast-bge-small-en-v1.5')
      return entries.some((entry) => entry.isDirectory() && entry.name.includes('bge'));
    } catch {
      return false;
    }
  }

  /**
   * Load embedding cache from disk
   */
  private async loadCache(): Promise<void> {
    if (this.cacheLoaded) return;

    try {
      const data = await fs.promises.readFile(this.embeddingCacheFile, 'utf-8');
      const parsed = JSON.parse(data) as EmbeddingCache;

      // Restore cache as Map
      this.embeddingCache = new Map(Object.entries(parsed.embeddings || {}));
      pruneOldestEntries(this.embeddingCache, MAX_EMBEDDING_CACHE_ENTRIES);

      // Restore index if available
      if (parsed.vectorIndex && parsed.indexMetadata) {
        this.vectorIndex = parsed.vectorIndex;
        this.indexMetadata = parsed.indexMetadata;
      }

      if (this.config.verbose) {
        console.log(`Loaded ${this.embeddingCache.size} cached embeddings.`);
      }
    } catch {
      // No cache file or invalid - start fresh
      this.embeddingCache = new Map();
    }

    this.cacheLoaded = true;
  }

  /**
   * Save embedding cache to disk
   */
  private async saveCache(): Promise<void> {
    try {
      await fs.promises.mkdir(this.cacheDir, { recursive: true });

      const data: EmbeddingCache = {
        model: 'BGESmallENV15',
        dimensions: this.dimensions,
        timestamp: new Date().toISOString(),
        embeddings: Object.fromEntries(this.embeddingCache),
        vectorIndex: this.vectorIndex,
        indexMetadata: this.indexMetadata,
      };

      await fs.promises.writeFile(this.embeddingCacheFile, JSON.stringify(data), 'utf-8');

      if (this.config.verbose) {
        console.log(`Saved ${this.embeddingCache.size} embeddings to cache.`);
      }
    } catch (error) {
      if (this.config.verbose) {
        console.warn('Failed to save embedding cache:', (error as Error).message);
      }
    }
  }

  /**
   * Generate a cache key for content
   */
  private getCacheKey(content: string, type: string): string {
    const hash = crypto.createHash('md5').update(content).digest('hex');
    return `${type}:${hash}`;
  }

  /**
   * Generate embedding for text (with caching)
   */
  private async embed(text: string, cacheKey: string | null = null): Promise<number[]> {
    if (!this.model) {
      throw new Error('Vector search not initialized');
    }

    // Check cache first
    if (cacheKey && this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey)!;
    }

    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error('Input text is empty');
    }

    // Use passageEmbed for documents/content
    const embeddingGenerator = this.model.passageEmbed([cleanText]);

    let embedding: number[] | null = null;
    for await (const batch of embeddingGenerator) {
      if (batch && batch.length > 0 && batch[0]) {
        embedding = Array.from(batch[0]);
        break;
      }
    }

    if (!embedding || embedding.length !== this.dimensions) {
      throw new Error(`Invalid embedding: got ${embedding?.length} dimensions, expected ${this.dimensions}`);
    }

    // Store in cache
    if (cacheKey) {
      setWithMaxEntries(this.embeddingCache, cacheKey, embedding, MAX_EMBEDDING_CACHE_ENTRIES);
    }

    return embedding;
  }

  /**
   * Generate embedding for a query (optimized for search)
   */
  async embedQuery(text: string): Promise<number[]> {
    if (!this.model) {
      throw new Error('Vector search not initialized');
    }

    const cleanText = text.trim();
    if (!cleanText) {
      throw new Error('Input text is empty');
    }

    // Use queryEmbed for search queries
    const embeddingArray = await this.model.queryEmbed(cleanText);

    if (!embeddingArray || embeddingArray.length !== this.dimensions) {
      throw new Error(`Invalid query embedding: got ${embeddingArray?.length} dimensions, expected ${this.dimensions}`);
    }

    return Array.from(embeddingArray);
  }

  /**
   * Index all documentation sections (with incremental support)
   */
  async indexDocumentation(documents: Document[]): Promise<void> {
    const initialized = await this.initialize();
    if (!initialized) return;

    await this.loadCache();

    // Clear previous index to avoid duplicates across runs
    this.vectorIndex = [];
    this.indexMetadata = [];

    let newEmbeddings = 0;
    let cachedEmbeddings = 0;

    for (const doc of documents) {
      const sections = this.splitIntoSections(doc.content);

      for (const section of sections) {
        if (section.text.length < 50) continue;

        const cacheKey = this.getCacheKey(section.text, 'doc');
        const wasCached = this.embeddingCache.has(cacheKey);

        const embedding = await this.embed(section.text, cacheKey);

        if (wasCached) {
          cachedEmbeddings++;
        } else {
          newEmbeddings++;
        }

        this.vectorIndex.push(embedding);
        this.indexMetadata.push({
          type: 'doc',
          path: doc.path,
          section: section.heading,
          text: section.text.substring(0, 200),
        });
      }
    }

    if (this.config.verbose) {
      console.log(`Indexed documentation: ${newEmbeddings} new, ${cachedEmbeddings} cached.`);
    }
  }

  /**
   * Index code comments and docstrings (with incremental support)
   */
  async indexCodeComments(codeFiles: CodeFile[]): Promise<void> {
    const initialized = await this.initialize();
    if (!initialized) return;

    await this.loadCache();

    let newEmbeddings = 0;
    let cachedEmbeddings = 0;

    for (const file of codeFiles) {
      const comments = this.extractComments(file.content, file.language);

      for (const comment of comments) {
        if (comment.text.length < 20) continue;

        const cacheKey = this.getCacheKey(comment.text, 'code');
        const wasCached = this.embeddingCache.has(cacheKey);

        const embedding = await this.embed(comment.text, cacheKey);

        if (wasCached) {
          cachedEmbeddings++;
        } else {
          newEmbeddings++;
        }

        this.vectorIndex.push(embedding);
        this.indexMetadata.push({
          type: 'code',
          path: file.path,
          symbol: comment.symbol,
          text: comment.text.substring(0, 200),
        });
      }
    }

    if (this.config.verbose) {
      console.log(`Indexed code comments: ${newEmbeddings} new, ${cachedEmbeddings} cached.`);
    }
  }

  /**
   * Find semantic mismatches between docs and code
   */
  async findMismatches(threshold: number | null = null): Promise<VectorMismatch[]> {
    threshold = threshold ?? this.config.vectorSearch?.similarityThreshold ?? 0.3;

    const mismatches: VectorMismatch[] = [];
    const docs = this.indexMetadata
      .map((meta, index) => ({ meta, embedding: this.vectorIndex[index] }))
      .filter((entry) => entry.meta.type === 'doc');
    const codeEntries = this.indexMetadata
      .map((meta, index) => ({ meta, embedding: this.vectorIndex[index] }))
      .filter((entry) => entry.meta.type === 'code');

    // For each doc section, find best matching code comment
    for (const { meta, embedding: docEmbedding } of docs) {
      let bestMatch: IndexMetadata | null = null;
      let bestScore = 0;

      // Find most similar code comment
      for (const { meta: codeMeta, embedding } of codeEntries) {
        const similarity = this.cosineSimilarity(docEmbedding, embedding);

        if (similarity > bestScore) {
          bestScore = similarity;
          bestMatch = codeMeta;
        }
      }

      // Report if no good match found for technical content
      if (
        bestScore < threshold &&
        (meta.text.includes('function') ||
          meta.text.includes('class') ||
          meta.text.includes('method') ||
          meta.text.includes('API') ||
          meta.text.includes('returns'))
      ) {
        mismatches.push({
          docPath: meta.path,
          docSection: meta.section || '',
          docText: meta.text,
          bestMatchScore: bestScore,
          bestMatch: bestMatch,
          suggestion: 'Documentation may describe functionality not found in code',
        });
      }
    }

    // Save cache after processing
    await this.saveCache();

    return mismatches;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  /**
   * Split markdown into sections
   */
  private splitIntoSections(content: string): Section[] {
    const sections: Section[] = [];
    const headingPattern = /^(#{1,6})\s+(.+)$/gm;

    let lastIndex = 0;
    let lastHeading = 'Introduction';
    let match: RegExpExecArray | null;

    while ((match = headingPattern.exec(content)) !== null) {
      if (match.index > lastIndex) {
        sections.push({
          heading: lastHeading,
          text: content.substring(lastIndex, match.index).trim(),
        });
      }
      lastHeading = match[2];
      lastIndex = match.index + match[0].length;
    }

    // Add final section
    if (lastIndex < content.length) {
      sections.push({
        heading: lastHeading,
        text: content.substring(lastIndex).trim(),
      });
    }

    return sections;
  }

  /**
   * Extract comments from code
   */
  private extractComments(content: string, language: string): Comment[] {
    const comments: Comment[] = [];

    // Language-specific comment patterns
    const patterns: Record<string, RegExp[]> = {
      javascript: [
        /\/\*\*[\s\S]*?\*\//g, // JSDoc
        /\/\/.*$/gm, // Single line
      ],
      typescript: [
        /\/\*\*[\s\S]*?\*\//g, // JSDoc
        /\/\/.*$/gm, // Single line
      ],
      python: [
        /"""[\s\S]*?"""/g, // Docstrings
        /#.*$/gm, // Single line
      ],
      go: [
        /\/\/.*$/gm, // Single line
        /\/\*[\s\S]*?\*\//g, // Block
      ],
      rust: [
        /\/\/\/.*$/gm, // Doc comments
        /\/\/.*$/gm, // Single line
      ],
      java: [
        /\/\*\*[\s\S]*?\*\//g, // Javadoc
        /\/\/.*$/gm, // Single line
      ],
    };

    const langPatterns = patterns[language] || patterns.javascript;

    for (const pattern of langPatterns) {
      let match: RegExpExecArray | null;
      const re = new RegExp(pattern.source, pattern.flags);
      while ((match = re.exec(content)) !== null) {
        const text = match[0]
          .replace(/^\/\*\*|\*\/$/g, '')
          .replace(/^\/\/\/?/gm, '')
          .replace(/^#/gm, '')
          .replace(/^\s*\*\s?/gm, '')
          .trim();

        if (text.length > 0) {
          comments.push({
            text,
            symbol: this.findNearestSymbol(content, match.index),
          });
        }
      }
    }

    return comments;
  }

  /**
   * Find the function/class name nearest to a comment
   */
  private findNearestSymbol(content: string, commentIndex: number): string {
    const after = content.substring(commentIndex);
    const symbolMatch = after.match(/(?:function|class|const|let|var|def|async|fn|func|type|interface|struct)\s+(\w+)/);
    return symbolMatch ? symbolMatch[1] : 'unknown';
  }

  /**
   * Clear the embedding cache
   */
  async clearCache(): Promise<void> {
    this.embeddingCache.clear();
    this.vectorIndex = [];
    this.indexMetadata = [];

    try {
      await fs.promises.unlink(this.embeddingCacheFile);
    } catch {
      // File doesn't exist - ok
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): CacheStats {
    return {
      cachedEmbeddings: this.embeddingCache.size,
      indexedDocSections: this.indexMetadata.filter((m) => m.type === 'doc').length,
      indexedCodeComments: this.indexMetadata.filter((m) => m.type === 'code').length,
    };
  }
}
