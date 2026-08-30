import type { ProjectScores, ValidationResults, VectorMismatch } from '../types.js';

/**
 * Console reporter for terminal output
 */
export class ConsoleReporter {
  generate(results: ValidationResults): void {
    this.generateValidationResults(results);

    if (results.vectorMismatches?.length) {
      this.generateVectorMismatches(results.vectorMismatches);
    }
  }

  /**
   * Generate with freshness scores
   */
  generateWithScores(results: ValidationResults, freshnessScores: ProjectScores | null): void {
    this.generateValidationResults(results);

    if (freshnessScores) {
      console.log('📊 Freshness Scores:\n');
      console.log(`   Project Score: ${freshnessScores.projectScore}/100 (Grade: ${freshnessScores.projectGrade})\n`);

      console.log('   By Document:');
      for (const doc of freshnessScores.documents) {
        const grade = doc.grade;
        const icon = grade === 'A' ? '🟢' : grade === 'B' ? '🟡' : grade === 'C' ? '🟠' : '🔴';
        console.log(`   ${icon} ${doc.document}: ${doc.totalScore}/100 (${grade})`);
      }
      console.log('');
    }

    if (results.vectorMismatches?.length) {
      this.generateVectorMismatches(results.vectorMismatches);
    }
  }

  private generateValidationResults(results: ValidationResults): void {
    const { summary, documents } = results;

    console.log('\n📚 Documentation Freshness Report\n');
    console.log('━'.repeat(50));

    console.log(`\n📊 Summary:`);
    console.log(`   Total references checked: ${summary.total}`);
    console.log(`   ✅ Valid: ${summary.valid}`);
    console.log(`   ❌ Errors: ${summary.errors}`);
    console.log(`   ⚠️  Warnings: ${summary.warnings}`);
    console.log(`   ℹ️  Info: ${summary.info ?? 0}`);
    console.log(`   ⏭️  Skipped: ${summary.skipped}`);

    if (documents.length === 0) {
      if (!results.vectorMismatches?.length) {
        console.log('\n✨ All documentation is up to date!\n');
      }
      else {
        console.log('');
      }
    }
    else {
      console.log('\n📋 Issues by Document:\n');

      for (const doc of documents) {
        console.log(`\n📄 ${doc.path}`);
        console.log('─'.repeat(40));

        for (const issue of doc.issues) {
          const icon = issue.severity === 'error' ? '❌' : issue.severity === 'info' ? 'ℹ️' : '⚠️';
          const ref = issue.reference;
          console.log(`  ${icon} Line ${ref.lineNumber}: ${issue.message}`);
          if (issue.suggestion) {
            console.log(`     💡 ${issue.suggestion}`);
          }
        }
      }

      console.log('\n');
    }
  }

  /**
   * Generate vector mismatch report
   */
  private generateVectorMismatches(mismatches: VectorMismatch[]): void {
    console.log('🔍 Semantic Analysis (Vector Search):\n');
    console.log(`   Found ${mismatches.length} potential semantic mismatches:\n`);

    for (const mismatch of mismatches) {
      console.log(`   ⚠️  ${mismatch.docPath}`);
      console.log(`      Section: "${mismatch.docSection}"`);
      console.log(`      Similarity: ${(mismatch.bestMatchScore * 100).toFixed(1)}%`);
      const bestMatch = mismatch.bestMatch ? `${mismatch.bestMatch.path} (${mismatch.bestMatch.symbol})` : '-';
      console.log(`      Best match: ${bestMatch}`);
      console.log(`      💡 ${mismatch.suggestion}`);
      console.log('');
    }
  }
}
