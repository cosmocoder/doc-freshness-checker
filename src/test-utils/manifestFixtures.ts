export const PEP621_PYPROJECT_FIXTURES = [
  {
    name: 'core and optional dependency arrays',
    content: `[project]
name = "example"
dependencies = [
  "fastapi>=0.100,<1",
  "uvicorn==0.30.1", # server
  # "ghost>=9" ]
  "typing_extensions[docs]===4.8; python_version < '3.13'",
  "direct_dep @ https://example.com/archive.whl#sha256=abc",
]

[project.optional-dependencies]
test = ["pytest==8.3.0", "httpx[http2]>=0.27"]
docs = [
  # "ghost-optional==9" ]
  "sphinx!=7",
  "mkdocs_material==9.5",
]
`,
    dependencies: {
      fastapi: 'any',
      uvicorn: '0.30.1',
      typing_extensions: '4.8',
      direct_dep: 'any',
      pytest: '8.3.0',
      httpx: 'any',
      sphinx: 'any',
      mkdocs_material: '9.5',
    },
  },
  {
    name: 'inline arrays with whitespace, pins, and canonical collisions',
    content: `[project]
dependencies = [" space_pkg [x] ==3.0 ", "paren_pkg (==4.0)", "compatible_pkg (~= 2.0)", "foo_bar==1.0", "foo-bar==2.0", "reverse-name==2.0", "reverse_name==1.0", "same.name==5.0", "same_name==5.0", "epoch_pkg==2!4.2", "date_pkg==2024.01"]
`,
    dependencies: {
      space_pkg: '3.0',
      paren_pkg: '4.0',
      compatible_pkg: '2.0',
      foo_bar: 'any',
      'foo-bar': 'any',
      'reverse-name': 'any',
      reverse_name: 'any',
      'same.name': '5.0',
      same_name: '5.0',
      epoch_pkg: '2!4.2',
      date_pkg: '2024.01',
    },
  },
  {
    name: 'array-of-table boundary after optional dependencies',
    content: `[project]
dependencies = ["core_pkg==1.0"]

[project.optional-dependencies]
test = ["optional_pkg==2.0"]

[[tool.demo]]
tags = ["ghost==9"]
`,
    dependencies: {
      core_pkg: '1.0',
      optional_pkg: '2.0',
    },
  },
  {
    name: 'multiline project strings before dependencies',
    content: `[project]
description = """
[not-a-real-section]
"ghost==9"
"""
readme = '''
dependencies = ["evil==9.9.9"]
'''
dependencies = ["requests==2.0"]
`,
    dependencies: {
      requests: '2.0',
    },
  },
] as const;
