import { parseGoModRequirements } from './goMod.js';

describe('parseGoModRequirements', () => {
  it('parses CRLF requirements with comments', () => {
    const content = [
      'require example.com/single v1.0.0 // indirect',
      'require (',
      '  example.com/block v2.0.0 // indirect',
      '  example.com/other v3.0.0 // indirect',
      ') // comment',
      'require "example.com/quoted" "v4.0.0"',
      'require example.com/after v5.0.0',
    ].join('\r\n');

    expect(parseGoModRequirements(content)).toEqual([
      ['example.com/single', '1.0.0'],
      ['example.com/block', '2.0.0'],
      ['example.com/other', '3.0.0'],
      ['example.com/quoted', '4.0.0'],
      ['example.com/after', '5.0.0'],
    ]);
  });

  it('ignores non-version directives in an unterminated block', () => {
    const content = ['require (', '  a.com/one v1.0.0', 'toolchain go1.22.3'].join('\n');

    expect(parseGoModRequirements(content)).toEqual([['a.com/one', '1.0.0']]);
  });
});
