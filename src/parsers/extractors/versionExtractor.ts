import { BaseExtractor } from './baseExtractor.js';
import type { Document, DocFreshnessConfig, Reference } from '../../types.js';

/**
 * Extracts version references
 * Configurable technology list for any stack
 */
export class VersionExtractor extends BaseExtractor {
  private technologies: string[];

  constructor(config: Partial<DocFreshnessConfig> = {}) {
    super('version');
    // Default technologies - can be extended via config
    this.technologies = config.technologies || [
      // JavaScript/TypeScript ecosystem
      'Node\\.?js?',
      'npm',
      'yarn',
      'pnpm',
      'React',
      'Vue',
      'Angular',
      'TypeScript',
      'Express',
      'Vite',
      'webpack',
      'Next\\.?js',
      'Nuxt',
      // Python ecosystem
      'Python',
      'pip',
      'Django',
      'Flask',
      'FastAPI',
      // Go ecosystem
      'Go',
      'Golang',
      // Rust ecosystem
      'Rust',
      'Cargo',
      // Java ecosystem
      'Java',
      'Maven',
      'Gradle',
      'Spring',
      // Databases
      'PostgreSQL',
      'MySQL',
      'MongoDB',
      'Redis',
      // Other
      'Docker',
      'Kubernetes',
      'Terraform',
    ];
  }

  extract(document: Document): Reference[] {
    const references: Reference[] = [];
    const techPattern = this.technologies.join('|');

    // Pattern: "Technology 19.x" or "Technology 19.2.3"
    const pattern = new RegExp(`\\b(${techPattern})\\s+v?(\\d+(?:\\.\\d+)?(?:\\.\\d+)?(?:\\.x)?)\\b`, 'gi');

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document.content)) !== null) {
      references.push({
        type: this.type,
        technology: match[1],
        version: match[2],
        value: match[0],
        lineNumber: this.findLineNumber(document.content, match.index),
        raw: match[0],
        sourceFile: document.path,
      });
    }

    return references;
  }
}
