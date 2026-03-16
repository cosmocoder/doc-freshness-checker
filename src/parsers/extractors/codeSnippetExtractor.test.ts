import { CodeSnippetExtractor } from './codeSnippetExtractor.js';
import type { Document } from '../../types.js';

function makeDoc(content: string): Document {
  return {
    path: 'docs/test.md',
    absolutePath: '/project/docs/test.md',
    content,
    format: 'markdown',
    lines: content.split('\n'),
    references: [],
  };
}

describe('CodeSnippetExtractor', () => {
  const extractor = new CodeSnippetExtractor();

  // -------------------------------------------------------------------------
  // Import extraction
  // -------------------------------------------------------------------------
  describe('import extraction', () => {
    it('extracts named imports from TypeScript snippets', () => {
      const doc = makeDoc(['```typescript', "import { createUser, updateUser } from './services/userService';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./services/userService');
      expect(refs[0].linkText).toBe('createUser,updateUser');
      expect(refs[0].language).toBe('typescript');
    });

    it('extracts default imports', () => {
      const doc = makeDoc(['```js', "import Router from './router';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./router');
      expect(refs[0].linkText).toBe('Router');
      expect(refs[0].importSpecifiers).toEqual(['default:Router']);
    });

    it('extracts combined default and named imports', () => {
      const doc = makeDoc(['```ts', "import client, { createUser, deleteUser as removeUser } from './services';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./services');
      expect(refs[0].linkText).toBe('client,createUser,deleteUser');
      expect(refs[0].importSpecifiers).toEqual(['default:client', 'named:createUser', 'named:deleteUser']);
    });

    it('extracts star imports (module path only)', () => {
      const doc = makeDoc(['```ts', "import * as utils from './helpers';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./helpers');
      expect(refs[0].linkText).toBe('');
    });

    it('handles import aliases — keeps original name', () => {
      const doc = makeDoc(['```typescript', "import { createUser as makeUser, Config as AppConfig } from './services';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs[0].linkText).toBe('createUser,Config');
    });

    it('extracts type imports', () => {
      const doc = makeDoc(['```typescript', "import type { UserConfig } from './types';", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].linkText).toBe('UserConfig');
    });

    it('skips non-relative imports (npm packages)', () => {
      const doc = makeDoc(['```typescript', "import express from 'express';", "import { useState } from 'react';", '```'].join('\n'));
      expect(extractor.extract(doc).filter((r) => r.kind === 'import')).toHaveLength(0);
    });

    it('extracts require statements', () => {
      const doc = makeDoc(['```js', "const { readFile } = require('./utils/fs');", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('./utils/fs');
      expect(refs[0].linkText).toBe('readFile');
    });

    it('extracts default require', () => {
      const doc = makeDoc(['```js', "const config = require('./config');", '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].linkText).toBe('');
      expect(refs[0].importSpecifiers).toEqual(['module:*']);
    });

    it('extracts Python from-imports', () => {
      const doc = makeDoc(['```python', 'from myapp.services import create_user, delete_user', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('myapp.services');
      expect(refs[0].linkText).toBe('create_user,delete_user');
      expect(refs[0].language).toBe('python');
    });

    it('extracts Go single import', () => {
      const doc = makeDoc(['```go', 'import "fmt"', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('fmt');
      expect(refs[0].language).toBe('go');
    });

    it('extracts Go grouped imports', () => {
      const doc = makeDoc(['```go', 'import (', '  "fmt"', '  "net/http"', ')', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.value)).toEqual(['fmt', 'net/http']);
    });

    it('handles multiple imports in one block', () => {
      const doc = makeDoc(
        ['```typescript', "import { UserService } from './services/user';", "import { Config } from './config';", '```'].join('\n')
      );
      const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
      expect(refs).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Function call extraction
  // -------------------------------------------------------------------------
  describe('function call extraction', () => {
    it('extracts standalone function calls with correct arity', () => {
      const doc = makeDoc(['```typescript', 'const user = createUser(name, email);', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('createUser');
      expect(refs[0].linkText).toBe('2');
      expect(refs[0].argumentNames).toEqual(['name', 'email']);
    });

    it('counts zero arguments', () => {
      const doc = makeDoc(['```typescript', 'initialize();', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('initialize');
      expect(refs[0].linkText).toBe('0');
    });

    it('handles nested parentheses in arguments', () => {
      const doc = makeDoc(['```javascript', 'processData(transform(input), callback(x));', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      const processRef = refs.find((r) => r.value === 'processData');
      expect(processRef).toBeDefined();
      expect(processRef!.linkText).toBe('2');
      expect(processRef!.argumentNames).toBeUndefined();
    });

    it('handles multi-line arguments', () => {
      const doc = makeDoc(['```typescript', 'createUser(', '  name,', '  email,', '  role,', ');', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      expect(refs).toHaveLength(1);
      expect(refs[0].value).toBe('createUser');
      expect(refs[0].linkText).toBe('3');
    });

    it('skips method calls (preceded by dot)', () => {
      const doc = makeDoc(['```javascript', 'user.save();', 'console.log("hello");', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      const names = refs.map((r) => r.value);
      expect(names).not.toContain('save');
      expect(names).not.toContain('log');
    });

    it('skips language keywords and built-ins', () => {
      const doc = makeDoc(['```javascript', 'if (true) {}', 'for (const x of list) {}', 'new Date();', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      const names = refs.map((r) => r.value);
      expect(names).not.toContain('if');
      expect(names).not.toContain('for');
      expect(names).not.toContain('Date');
    });

    it('skips function definitions', () => {
      const doc = makeDoc(['```typescript', 'function handleRequest(req, res) {', '  return res;', '}', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      expect(refs.filter((r) => r.value === 'handleRequest')).toHaveLength(0);
    });

    it('skips constructor calls (new keyword)', () => {
      const doc = makeDoc(['```typescript', 'const service = new UserService();', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'function-call');
      expect(refs.filter((r) => r.value === 'UserService')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Config key extraction
  // -------------------------------------------------------------------------
  describe('config key extraction', () => {
    it('extracts keys from typed object assignment', () => {
      const doc = makeDoc(
        ['```typescript', 'const config: ServerConfig = {', '  port: 3000,', '  host: "localhost",', '  timeout: 5000,', '};', '```'].join(
          '\n'
        )
      );
      const refs = extractor.extract(doc).filter((r) => r.kind === 'config-keys');
      expect(refs).toHaveLength(1);
      expect(refs[0].linkText).toBe('ServerConfig');
      const keys = refs[0].value.split(',');
      expect(keys).toContain('port');
      expect(keys).toContain('host');
      expect(keys).toContain('timeout');
    });

    it('extracts keys from generic function call', () => {
      const doc = makeDoc(['```typescript', 'configure<AppOptions>({', '  debug: true,', '  logLevel: "info",', '});', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'config-keys');
      expect(refs).toHaveLength(1);
      expect(refs[0].linkText).toBe('AppOptions');
      const keys = refs[0].value.split(',');
      expect(keys).toContain('debug');
      expect(keys).toContain('logLevel');
    });

    it('skips untyped object assignments', () => {
      const doc = makeDoc(['```javascript', 'const config = {', '  port: 3000,', '};', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'config-keys');
      expect(refs).toHaveLength(0);
    });

    it('only operates on JS/TS code blocks', () => {
      const doc = makeDoc(['```python', 'config: ServerConfig = {', '  "port": 3000,', '}', '```'].join('\n'));
      const refs = extractor.extract(doc).filter((r) => r.kind === 'config-keys');
      expect(refs).toHaveLength(0);
    });

    it('handles nested objects — only top-level keys extracted', () => {
      const doc = makeDoc(
        [
          '```typescript',
          'const opts: AppConfig = {',
          '  db: {',
          '    host: "localhost",',
          '    port: 5432,',
          '  },',
          '  cache: true,',
          '};',
          '```',
        ].join('\n')
      );
      const refs = extractor.extract(doc).filter((r) => r.kind === 'config-keys');
      expect(refs).toHaveLength(1);
      const keys = refs[0].value.split(',');
      expect(keys).toContain('db');
      expect(keys).toContain('cache');
      expect(keys).not.toContain('host');
      expect(keys).not.toContain('port');
    });
  });

  // -------------------------------------------------------------------------
  // General behaviour
  // -------------------------------------------------------------------------
  it('ignores code outside fenced blocks', () => {
    const doc = makeDoc("import { Foo } from './bar';\ncreateUser(a, b);");
    expect(extractor.extract(doc)).toHaveLength(0);
  });

  it('ignores unsupported language tags', () => {
    const doc = makeDoc(['```html', '<div>hello</div>', '```'].join('\n'));
    expect(extractor.extract(doc)).toHaveLength(0);
  });

  it('handles multiple code blocks in one document', () => {
    const doc = makeDoc(['```typescript', "import { A } from './a';", '```', '', '```python', 'from b import B', '```'].join('\n'));
    const refs = extractor.extract(doc).filter((r) => r.kind === 'import');
    expect(refs).toHaveLength(2);
    expect(refs[0].language).toBe('typescript');
    expect(refs[1].language).toBe('python');
  });
});
