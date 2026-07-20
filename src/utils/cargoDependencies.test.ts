import { parseCargoDependencies, resolveCargoDependencies } from './cargoDependencies.js';
import { CARGO_DEPENDENCY_FIXTURE } from '../test-utils/cargoFixture.js';

describe('parseCargoDependencies', () => {
  it('preserves workspace provenance', () => {
    expect(parseCargoDependencies(CARGO_DEPENDENCY_FIXTURE).filter(({ name }) => name === 'shared')).toEqual([
      { name: 'shared', version: '3.2.0', kind: 'workspace-definition' },
      { name: 'shared', version: 'any', kind: 'workspace-reference' },
    ]);
  });

  it('parses only top-level inline-table fields', () => {
    const content = `[dependencies]
tricky = { path = "vendor/version='7'", features = ["a,b", "c"], version = "4.0" }
quoted-workspace = { note = "workspace = true", version = "5.0" }
inherited = { features = ["x,y"], workspace = true }
hash-path = { path = "vendor/#cache", version = "6.0" } # comment
double-backslash = { path = "vendor\\\\", version = "4.0" } # comment
literal-backslash = { path = 'vendor\\', version = "4.0" } # comment
`;

    expect(parseCargoDependencies(content)).toEqual([
      { name: 'tricky', version: '4.0', kind: 'dependency' },
      { name: 'quoted-workspace', version: '5.0', kind: 'dependency' },
      { name: 'inherited', version: 'any', kind: 'workspace-reference' },
      { name: 'hash-path', version: '6.0', kind: 'dependency' },
      { name: 'double-backslash', version: '4.0', kind: 'dependency' },
      { name: 'literal-backslash', version: '4.0', kind: 'dependency' },
    ]);
  });

  it('parses CRLF dependency versions with single quotes', () => {
    const content = "[dependencies]\r\nplain = '1.2'\r\n[build-dependencies]\r\ninline = { version = '2.3' }\r\n";

    expect(parseCargoDependencies(content)).toEqual([
      { name: 'plain', version: '1.2', kind: 'dependency' },
      { name: 'inline', version: '2.3', kind: 'dependency' },
    ]);
  });

  it('keeps concrete versions when later entries are unpinned', () => {
    const entries = parseCargoDependencies(`[dependencies]
serde = "1.0"
tokio = "1.28"
[dev-dependencies]
serde = { path = "../serde" }
tokio = { workspace = true }
`).map((entry) => ({ ...entry, sourceIndex: 0 }));

    expect(Array.from(resolveCargoDependencies(entries), ([name, { version }]) => [name, version])).toEqual([
      ['serde', '1.0'],
      ['tokio', '1.28'],
    ]);
  });

  it('ignores a workspace definition that pins no version', () => {
    const entries = parseCargoDependencies(`[workspace.dependencies]
foo = { git = "https://example.com/foo" }
[dependencies]
foo = "1.0"
[dev-dependencies]
foo = { workspace = true }
`).map((entry) => ({ ...entry, sourceIndex: 0 }));

    expect(resolveCargoDependencies(entries).get('foo')?.version).toBe('1.0');
  });

  it('ignores dependency sections inside multiline strings', () => {
    const content = `[package]
readme = """
[dependencies]
double-quoted = "9.0"
"""
description = '''
[dependencies]
single-quoted = "9.0"
'''
[dependencies]
serde = "1.0"
`;

    expect(parseCargoDependencies(content)).toEqual([{ name: 'serde', version: '1.0', kind: 'dependency' }]);
  });
});
