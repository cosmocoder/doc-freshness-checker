import { stripTomlMultilineStrings } from './toml.js';

const DEPENDENCY_SECTIONS = new Set(['dependencies', 'dev-dependencies', 'build-dependencies', 'workspace.dependencies']);

export interface CargoDependency {
  name: string;
  version: string;
  kind: 'dependency' | 'workspace-definition' | 'workspace-reference';
}

export interface SourcedCargoDependency extends CargoDependency {
  sourceIndex: number;
}

export interface ResolvedCargoDependency {
  version: string;
  sourceIndex: number;
  unresolvedWorkspaceReference: boolean;
}

export function resolveCargoDependencies(entries: SourcedCargoDependency[]): Map<string, ResolvedCargoDependency> {
  const definitions = new Map<string, Pick<ResolvedCargoDependency, 'version' | 'sourceIndex'>>();

  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (entry.kind === 'workspace-definition' && entry.version !== 'any') {
      definitions.set(name, entry);
    }
  }

  const pinsVersion = (entry: SourcedCargoDependency): boolean =>
    entry.kind === 'workspace-reference' ? definitions.has(entry.name.toLowerCase()) : entry.version !== 'any';
  const finalEntries = new Map<string, SourcedCargoDependency>();
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const current = finalEntries.get(name);
    if (!current || pinsVersion(entry) || !pinsVersion(current)) {
      finalEntries.set(name, entry);
    }
  }

  return new Map(
    Array.from(finalEntries, ([name, entry]) => {
      const definition = entry.kind === 'workspace-reference' ? definitions.get(name) : undefined;
      return [
        name,
        {
          version: entry.kind === 'workspace-reference' ? (definition?.version ?? 'any') : entry.version,
          sourceIndex: Math.max(entry.sourceIndex, definition?.sourceIndex ?? entry.sourceIndex),
          unresolvedWorkspaceReference: entry.kind === 'workspace-reference' && !definition,
        },
      ];
    })
  );
}

export function parseCargoDependencies(content: string): CargoDependency[] {
  const dependencies: CargoDependency[] = [];
  let section = '';

  for (const sourceLine of stripTomlMultilineStrings(content).split('\n')) {
    const line = stripComment(sourceLine).trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('[')) {
      section = line.match(/^\[([^\]]+)\]$/)?.[1] ?? '';
      continue;
    }
    if (!DEPENDENCY_SECTIONS.has(section)) {
      continue;
    }

    const entry = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (!entry) {
      continue;
    }
    const [, name, value] = entry;
    const stringVersion = quotedValue(value);
    const fields = parseInlineFields(value);
    const workspaceReference = fields.get('workspace') === 'true';

    dependencies.push({
      name,
      version: stringVersion ?? quotedValue(fields.get('version') ?? '') ?? 'any',
      kind: section === 'workspace.dependencies' ? 'workspace-definition' : workspaceReference ? 'workspace-reference' : 'dependency',
    });
  }

  return dependencies;
}

function parseInlineFields(value: string): Map<string, string> {
  const fields = new Map<string, string>();
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return fields;
  }

  for (const field of splitTopLevel(trimmed.slice(1, -1))) {
    const match = field.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
    if (match) {
      fields.set(match[1], match[2].trim());
    }
  }
  return fields;
}

function splitTopLevel(value: string): string[] {
  const fields: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | undefined;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
    }
    else if (quote === "'" && character === "'") {
      quote = undefined;
    }
    else if (quote === '"' && character === '"' && !isEscaped(value, index)) {
      quote = undefined;
    }
    else if (!quote && '[{('.includes(character)) {
      depth += 1;
    }
    else if (!quote && ']})'.includes(character)) {
      depth -= 1;
    }
    else if (!quote && depth === 0 && character === ',') {
      fields.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  fields.push(value.slice(start).trim());
  return fields;
}

function quotedValue(value: string): string | undefined {
  const trimmed = value.trim();
  return (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0] ? trimmed.slice(1, -1) : undefined;
}

function stripComment(line: string): string {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (!quote && (character === '"' || character === "'")) {
      quote = character;
    }
    else if (quote === "'" && character === "'") {
      quote = undefined;
    }
    else if (quote === '"' && character === '"' && !isEscaped(line, index)) {
      quote = undefined;
    }
    else if (character === '#' && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function isEscaped(value: string, index: number): boolean {
  let backslashes = 0;
  while (value[index - backslashes - 1] === '\\') {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}
