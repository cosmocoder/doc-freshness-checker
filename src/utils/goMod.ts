export function parseGoModRequirements(content: string): Array<[string, string]> {
  const requirements: Array<[string, string]> = [];
  let inRequireBlock = false;

  for (const sourceLine of content.split('\n')) {
    const line = sourceLine.replace(/\/\/.*/, '').trim();
    if (inRequireBlock) {
      if (line === ')') {
        inRequireBlock = false;
        continue;
      }
      const requirement = parseRequirement(line);
      if (requirement) {
        requirements.push(requirement);
      }
      continue;
    }
    if (/^require\s*\($/.test(line)) {
      inRequireBlock = true;
      continue;
    }
    const match = line.match(/^require\s+(.+)$/);
    const requirement = match ? parseRequirement(match[1]) : null;
    if (requirement) {
      requirements.push(requirement);
    }
  }

  return requirements;
}

function parseRequirement(value: string): [string, string] | null {
  const match = value.match(/^(\S+)\s+(\S+)$/);
  if (!match) {
    return null;
  }

  const modulePath = unquote(match[1]);
  const version = unquote(match[2]);
  return version.startsWith('v') ? [modulePath, version.slice(1)] : null;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
