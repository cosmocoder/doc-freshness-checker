import { stripTomlMultilineStrings } from './toml.js';

const QUOTED_STRING = /"((?:\\.|[^"\\])*)"|'([^']*)'/g;
const TOML_COMMENT = /("(?:\\.|[^"\\])*"|'[^']*')|#[^\r\n]*/g;
const TOML_ARRAY = /^\[((?:[^"'\]]|"(?:\\.|[^"\\])*"|'[^']*')*)\]/;

type DependencyGroups = Map<string, { names: Set<string>; version: string }>;

export function parsePyprojectDependencies(content: string): Map<string, string> {
  const dependencyGroups: DependencyGroups = new Map();
  const uncommented = stripComments(stripTomlMultilineStrings(content));
  const coreSection = getSection(uncommented, 'project');
  const optionalSection = getSection(uncommented, 'project.optional-dependencies');
  const arrays = [
    ...findArrays(coreSection, /^[ \t]*dependencies[ \t]*=[ \t]*\[/gm),
    ...findArrays(optionalSection, /^[ \t]*[a-zA-Z0-9._-]+[ \t]*=[ \t]*\[/gm),
  ];

  for (const source of arrays) {
    for (const match of source.matchAll(QUOTED_STRING)) {
      const parsed = parsePythonRequirement(match[1] ?? match[2]);
      if (!parsed) {
        continue;
      }

      addDependency(dependencyGroups, parsed.name, parsed.version);
    }
  }

  return flattenDependencyGroups(dependencyGroups);
}

export function parseRequirementsDependencies(content: string): Map<string, string> {
  const dependencyGroups: DependencyGroups = new Map();

  for (const line of content.split('\n')) {
    const parsed = parsePythonRequirement(stripRequirementInlineComment(line));
    if (!parsed) {
      continue;
    }

    addDependency(dependencyGroups, parsed.name, parsed.version);
  }

  return flattenDependencyGroups(dependencyGroups);
}

function flattenDependencyGroups(dependencyGroups: DependencyGroups): Map<string, string> {
  const dependencies = new Map<string, string>();
  for (const group of dependencyGroups.values()) {
    for (const name of group.names) {
      dependencies.set(name, group.version);
    }
  }
  return dependencies;
}

export function canonicalizePythonPackageName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

function stripComments(content: string): string {
  return content.replace(TOML_COMMENT, (_match, quoted: string | undefined) => quoted ?? '');
}

function getSection(content: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^[ \\t]*\\[${escapedName}\\][ \\t]*\\r?$`, 'm').exec(content);
  if (!header) {
    return undefined;
  }

  const remainder = content.slice(header.index + header[0].length);
  const nextSection = remainder.search(/^[ \t]*(?:\[[^\]\r\n]+\]|\[\[[^\]\r\n]+\]\])[ \t]*\r?$/m);
  return nextSection === -1 ? remainder : remainder.slice(0, nextSection);
}

function findArrays(section: string | undefined, assignmentPattern: RegExp): string[] {
  if (!section) {
    return [];
  }

  const arrays: string[] = [];
  for (const match of section.matchAll(assignmentPattern)) {
    const openingBracket = match.index + match[0].lastIndexOf('[');
    const array = section.slice(openingBracket).match(TOML_ARRAY)?.[1];
    if (array !== undefined) {
      arrays.push(array);
    }
  }
  return arrays;
}

function getComparableVersion(constraint: string): string | undefined {
  const version = constraint.match(/^(?:={2,3}|~=)\s*([^,\s*]+)\s*$/) ?? constraint.match(/^\(\s*(?:={2,3}|~=)\s*([^,\s*()]+)\s*\)$/);
  return version?.[1];
}

function parsePythonRequirement(requirement: string): { name: string; version: string } | undefined {
  const parsed = requirement.trim().match(/^([a-zA-Z0-9][a-zA-Z0-9._-]*)(?:\s*\[[^\]]+\])?\s*(.*)$/);
  if (!parsed) {
    return undefined;
  }

  const constraint = parsed[2].split(';', 1)[0].trim();
  return { name: parsed[1], version: getComparableVersion(constraint) ?? 'any' };
}

function stripRequirementInlineComment(requirement: string): string {
  let quote: string | undefined;
  for (let index = 0; index < requirement.length; index += 1) {
    const character = requirement[index];
    if ((character === '"' || character === "'") && requirement[index - 1] !== '\\') {
      quote = quote === character ? undefined : quote || character;
    }
    else if (character === '#' && !quote && index > 0 && /\s/.test(requirement[index - 1])) {
      return requirement.slice(0, index).trimEnd();
    }
  }
  return requirement;
}

function addDependency(dependencies: DependencyGroups, name: string, version: string): void {
  const normalizedName = name.toLowerCase();
  const canonicalName = canonicalizePythonPackageName(normalizedName);
  const existing = dependencies.get(canonicalName);
  if (existing) {
    existing.names.add(normalizedName);
    if (existing.version !== version) {
      existing.version = 'any';
    }
  }
  else {
    dependencies.set(canonicalName, { names: new Set([normalizedName]), version });
  }
}
