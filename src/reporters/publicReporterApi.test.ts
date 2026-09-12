import * as publicApi from '../index.js';
import type { CodeDocGraph } from '../graph/codeDocGraph.js';
import type { GitChangeTracker } from '../git/changeTracker.js';
import type { ProjectScores, ValidationResults } from '../types.js';
// @ts-expect-error ReportContext is intentionally not exported from the package root.
import type { ReportContext as RootReportContext } from '../index.js';

describe('public reporter interface', () => {
  it('keeps the four root exports and their method signatures without exposing internals', () => {
    expectTypeOf(publicApi.ConsoleReporter).toBeConstructibleWith();
    expectTypeOf(publicApi.JsonReporter).toBeConstructibleWith();
    expectTypeOf(publicApi.MarkdownReporter).toBeConstructibleWith();
    expectTypeOf(publicApi.EnhancedReporter).toBeConstructibleWith();

    expectTypeOf(publicApi.ConsoleReporter.prototype.generate).parameters.toEqualTypeOf<[ValidationResults]>();
    expectTypeOf(publicApi.ConsoleReporter.prototype.generate).returns.toBeVoid();
    expectTypeOf(publicApi.ConsoleReporter.prototype.generateWithScores).parameters.toEqualTypeOf<
      [ValidationResults, ProjectScores | null]
    >();
    expectTypeOf(publicApi.ConsoleReporter.prototype.generateWithScores).returns.toBeVoid();
    expectTypeOf(publicApi.JsonReporter.prototype.generate).parameters.toEqualTypeOf<[ValidationResults]>();
    expectTypeOf(publicApi.JsonReporter.prototype.generate).returns.toBeString();
    expectTypeOf(publicApi.JsonReporter.prototype.generateWithScores).parameters.toEqualTypeOf<[ValidationResults, ProjectScores | null]>();
    expectTypeOf(publicApi.JsonReporter.prototype.generateWithScores).returns.toBeString();
    expectTypeOf(publicApi.MarkdownReporter.prototype.generate).parameters.toEqualTypeOf<[ValidationResults]>();
    expectTypeOf(publicApi.MarkdownReporter.prototype.generate).returns.toBeString();
    expectTypeOf(publicApi.MarkdownReporter.prototype.generateWithScores).parameters.toEqualTypeOf<
      [ValidationResults, ProjectScores | null]
    >();
    expectTypeOf(publicApi.MarkdownReporter.prototype.generateWithScores).returns.toBeString();
    expectTypeOf(publicApi.EnhancedReporter.prototype.generateScanReport).parameters.toEqualTypeOf<
      [ValidationResults, CodeDocGraph | null, GitChangeTracker | null, ProjectScores | null]
    >();
    expectTypeOf(publicApi.EnhancedReporter.prototype.generateScanReport).returns.toBeString();
    expectTypeOf<RootReportContext>().toBeAny();

    expect(publicApi).not.toHaveProperty('ReportContext');
    expect(publicApi).not.toHaveProperty('renderConsoleReport');
    expect(publicApi).not.toHaveProperty('createReportContext');
  });
});
