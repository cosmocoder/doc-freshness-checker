const TOML_MULTILINE_STRING = /"""(?:\\[\s\S]|"{1,2}(?!")|[^"\\])*"""|'''(?:'{1,2}(?!')|[^'])*'''/g;

export function stripTomlMultilineStrings(content: string): string {
  return content.replace(TOML_MULTILINE_STRING, '');
}
