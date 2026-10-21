import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { rewriteMarkdown, syncDocumentation } from './sync-docs.mjs'

const source = {
  title: 'Example Project',
  description: 'Example networking documentation.',
  repository: 'example/project',
  branch: 'main',
  path: 'docs',
  slug: 'example-project',
  entry: 'guide/start.md'
}
const commit = 'a'.repeat(40)
const image = Buffer.from([0, 255, 1, 128, 2])
const fixture = {
  'index.md': '---\nlayout: home\nhero:\n  actions:\n    - text: Start\n      link: /guide/start\n---\n[Start](guide/start.md)\n',
  'guide/start.md': '---\nlayout: home\nsidebar: false\n---\n# Getting Started\n\n[Home](../index.md)\n[Next](/guide/next#details)\n![Diagram](../images/diagram.png)\n[Download](../files/example.txt)\n',
  'guide/next.md': '# Next Steps\n\n## Details\n\n[Start](/guide/start)\n',
  'images/diagram.png': image,
  'files/example.txt': 'Example download\n',
  '.vitepress/config.ts': 'excluded',
  'package.json': '{}',
  'package-lock.json': '{}',
  'node_modules/example/index.md': 'excluded',
  'dist/index.md': 'excluded',
  'build/file.txt': 'excluded',
  '.github/workflows/pages.yml': 'excluded'
}
const nestedFixture = {
  ...fixture,
  'guide/fundamentals/tcp-ip.md': '---\ntitle: "TCP/IP"\n---\n# Networking\n',
  'guide/fundamentals/client-server.md': '# Client-Server Architecture\n',
  'guide/java-nio/index.md': '# Java NIO\n\n[Buffers](buffers.md)\n',
  'guide/java-nio/buffers.md': '# Buffers\n\n[Overview](index.md)\n',
  'guide/java-nio/channels.md': '# Channels\n',
  'guide/java-nio/examples/blocking-server.md': '# Blocking TCP Server\n',
  'guide/java-nio/examples/non-blocking-server.md': '# Non-blocking TCP Server\n',
  'guide/implementation/proxy-server.md': 'Proxy server notes.\n\n## Implementation\n\nBuild the proxy.\n'
}
const navigation = {
  sidebar: [
    { text: 'Introduction', link: 'guide/start.md' },
    {
      text: 'NIO Tutorial', link: 'guide/java-nio/index.md', collapsed: false,
      items: [
        { text: 'Channel API', link: 'guide/java-nio/channels.md' },
        { text: 'Buffer API', link: 'guide/java-nio/buffers.md' },
        {
          text: 'Server Examples', collapsed: true,
          items: [{ text: 'Async Server', link: 'guide/java-nio/examples/non-blocking-server.md' }]
        }
      ]
    },
    {
      text: 'Networking Basics', collapsed: true,
      items: [{ text: 'TCP/IP Protocol', link: 'guide/fundamentals/tcp-ip.md' }]
    }
  ]
}
const configuredFixture = { ...nestedFixture, 'docs.navigation.json': JSON.stringify(navigation) }
const navigationLinks = items => items.flatMap(item => [
  ...(item.link ? [item.link] : []), ...navigationLinks(item.items ?? [])
])

function fetchFixture(files = fixture, fail = false) {
  return async url => {
    if (fail) return new Response('Unavailable', { status: 503 })
    if (url.includes('/commits/')) return Response.json({ sha: commit })
    if (url.includes('/git/trees/')) {
      return Response.json({
        truncated: false,
        tree: Object.keys(files).map(file => ({ path: `docs/${file}`, type: 'blob', mode: '100644' }))
      })
    }
    const file = decodeURIComponent(url.split(`/${commit}/docs/`)[1])
    assert.ok(Object.hasOwn(files, file), `Unexpected fetch: ${url}`)
    return new Response(files[file])
  }
}

async function temporaryRoot(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portfolio-docs-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('imports pages and binary assets, excludes tooling, generates all navigation and removes stale files', async t => {
  const directory = await temporaryRoot(t)
  const options = { directory, sources: [source], fetcher: fetchFixture() }
  const manifest = await syncDocumentation(options)
  assert.equal(manifest.projects[0].pages.length, 2)
  assert.equal(manifest.projects[0].assets.length, 2)
  assert.equal(manifest.rewrites['_generated/example-project/guide/start.md'], 'example-project/index.md')
  assert.equal(manifest.rewrites['_generated/_redirects/example-project.md'], 'example-project/guide/start.md')
  assert.deepEqual(navigationLinks(manifest.sidebar['/example-project/']), [
    '/example-project/', '/example-project/guide/next'
  ])
  await assert.rejects(readFile(join(directory, 'docs/_generated/example-project/index.md')), { code: 'ENOENT' })
  assert.deepEqual(manifest.redirects, [{ from: '/example-project/guide/start', to: '/example-project/' }])
  const page = await readFile(join(directory, 'docs/_generated/example-project/guide/start.md'), 'utf8')
  assert.ok(page.includes('[Home](/example-project/)'))
  assert.ok(page.includes('[Next](/example-project/guide/next#details)'))
  assert.ok(page.includes('![Diagram](/_generated/example-project/images/diagram.png)'))
  assert.ok(page.includes('[Download](/_generated/example-project/files/example.txt)'))
  assert.deepEqual(await readFile(join(directory, 'docs/public/_generated/example-project/images/diagram.png')), image)
  assert.deepEqual((await readdir(join(directory, 'docs/_generated/example-project'))).sort(), ['guide'])
  await assert.rejects(readFile(join(directory, 'docs/_generated/guides.md')), { code: 'ENOENT' })
  const cards = await readFile(join(directory, 'docs/_generated/guide-cards.md'), 'utf8')
  assert.ok(cards.includes('<a class="project-card guide-card" href="/example-project/">'))
  assert.ok(cards.includes(source.description))
  assert.ok(!cards.includes('/guides/'))
  await writeFile(join(directory, 'docs/_generated/stale.md'), 'obsolete')
  await writeFile(join(directory, 'docs/public/_generated/old.png'), image)
  await syncDocumentation(options)
  await assert.rejects(readFile(join(directory, 'docs/_generated/stale.md')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(directory, 'docs/public/_generated/old.png')), { code: 'ENOENT' })
})

test('supports multiple projects and removes projects deleted from configuration', async t => {
  const directory = await temporaryRoot(t)
  const second = { ...source, title: 'Second', repository: 'example/second', slug: 'second' }
  const manifest = await syncDocumentation({ directory, sources: [source, second], fetcher: fetchFixture() })
  assert.equal(manifest.projects.length, 2)
  assert.ok(manifest.sidebar['/second/'])
  const cards = await readFile(join(directory, 'docs/_generated/guide-cards.md'), 'utf8')
  assert.equal((cards.match(/class="project-card guide-card"/g) ?? []).length, 2)
  assert.ok(cards.includes('href="/second/"'))
  await syncDocumentation({ directory, sources: [source], fetcher: fetchFixture() })
  await assert.rejects(readFile(join(directory, 'docs/_generated/second/guide/start.md')), { code: 'ENOENT' })
  assert.ok((await readFile(join(directory, 'docs/_generated/guide-cards.md'), 'utf8')).includes('Example Project'))
  assert.ok(!(await readFile(join(directory, 'docs/_generated/guide-cards.md'), 'utf8')).includes('Second'))
})

test('rewrites common Markdown, reference, HTML and frontmatter links without changing code or external URLs', () => {
  const files = new Map(Object.keys(fixture).map(file => [file, {}]))
  const input = [
    '[Relative](../guide/next.md?view=full#details)',
    '[Prefixed](/example-project/guide/next)',
    '[Source prefix](/docs/guide/next)',
    '[Project root](/example-project)',
    '[Source root](/docs/)',
    '[Current page](?view=full)',
    '[Reference][next]',
    '[next]: /guide/next "Next"',
    '<a href="/guide/next">Next</a>',
    '<img src="/images/diagram.png" alt="Diagram">',
    '[External](https://example.com/missing)',
    '[Anchor](#local)',
    '`[Example](/missing)`',
    '```md',
    '[Example](/missing)',
    '```',
    '~~~markdown',
    '![Example](/missing.png)',
    '~~~'
  ].join('\n')
  const result = rewriteMarkdown(input, 'guide/start.md', source, files)
  assert.ok(result.includes('(/example-project/guide/next?view=full#details)'))
  assert.ok(result.includes('[next]: /example-project/guide/next "Next"'))
  assert.ok(result.includes('href="/example-project/guide/next"'))
  assert.ok(result.includes('src="/_generated/example-project/images/diagram.png"'))
  assert.ok(result.includes('[Project root](/example-project/)'))
  assert.ok(result.includes('[Source root](/example-project/)'))
  assert.ok(result.includes('[Current page](/example-project/?view=full)'))
  assert.ok(result.includes('[External](https://example.com/missing)'))
  assert.ok(result.includes('[Anchor](#local)'))
  assert.ok(result.includes('`[Example](/missing)`'))
  assert.ok(result.includes('```md\n[Example](/missing)\n```'))
  assert.ok(result.includes('~~~markdown\n![Example](/missing.png)\n~~~'))
  assert.equal(rewriteMarkdown('---\nhero:\n  link: "/guide/next#details" # Keep this\n---',
    'index.md', source, files),
  '---\nhero:\n  link: "/example-project/guide/next#details" # Keep this\n---')
})

for (const [mode, files] of [['automatic', nestedFixture], ['configured', configuredFixture]]) {
test(`VitePress builds ${mode} nested navigation, rewritten routes, relative links and unchanged assets`, async t => {
  const directory = await temporaryRoot(t)
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n')
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
  const manifest = await syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(files) })
  await mkdir(join(directory, 'docs/.vitepress'), { recursive: true })
  await mkdir(join(directory, 'docs/main'), { recursive: true })
  await writeFile(join(directory, 'docs/index.md'), '# Website\n')
  await writeFile(join(directory, 'docs/main/index.md'), '# Home\n\n## Guides\n\n<!--@include: ../_generated/guide-cards.md-->\n')
  await copyFile(fileURLToPath(new URL('../docs/.vitepress/config.ts', import.meta.url)),
    join(directory, 'docs/.vitepress/config.ts'))
  const vitepress = fileURLToPath(new URL('../node_modules/vitepress/bin/vitepress.js', import.meta.url))
  await promisify(execFile)(process.execPath, [vitepress, 'build', join(directory, 'docs')], { timeout: 60_000 })
  const output = join(directory, 'docs/.vitepress/dist')
  const page = await readFile(join(output, 'example-project/index.html'), 'utf8')
  assert.ok(page.includes('<h1 id="getting-started"'))
  assert.ok(page.includes('class="VPSidebar'))
  assert.ok(!page.includes('class="VPHome') && !page.includes('class="VPHero'))
  assert.ok(page.includes('rel="canonical" href="/example-project/"'))
  assert.ok(page.includes('href="/example-project/guide/next#details"'))
  assert.ok(page.includes('src="/_generated/example-project/images/diagram.png"'))
  assert.ok(page.includes('href="/_generated/example-project/files/example.txt"'))
  for (const item of manifest.projects[0].pages) {
    assert.ok(page.includes(`href="${item.link}"`))
  }
  assert.deepEqual(await readFile(join(output, '_generated/example-project/images/diagram.png')), image)
  assert.equal(await readFile(join(output, '_generated/example-project/files/example.txt'), 'utf8'), 'Example download\n')
  await assert.rejects(readFile(join(output, 'guides/index.html')), { code: 'ENOENT' })
  assert.ok(!page.includes('href="/main/#guides"'))
  assert.ok(!page.includes('href="/guides/"'))
  const alias = await readFile(join(output, 'example-project/guide/start.html'), 'utf8')
  assert.ok(alias.includes('http-equiv="refresh" content="0; url=/example-project/"'))
  assert.ok(alias.includes('rel="canonical" href="/example-project/"'))
  assert.ok(!alias.includes('<h1 id="getting-started"'))
  const cards = await readFile(join(output, 'main/index.html'), 'utf8')
  assert.ok(cards.includes('class="project-card guide-card" href="/example-project/"'))
  const chunks = join(output, 'assets/chunks')
  const searchFile = (await readdir(chunks)).find(name => name.startsWith('@localSearchIndexroot.'))
  const search = await readFile(join(chunks, searchFile), 'utf8')
  assert.ok(search.includes('/example-project/#'))
  assert.ok(!search.includes('/example-project/guide/start'))
  assert.ok(!search.includes('hero') && !search.includes('Redirecting'))
  for (const item of manifest.projects[0].pages) {
    const path = item.link === '/example-project/' ? 'example-project/index.html' :
      `${item.link.slice(1).replace(/\/$/, '/index')}.html`
    const html = await readFile(join(output, path), 'utf8')
    assert.ok(html.includes(`rel="canonical" href="${item.link}"`))
    for (const link of navigationLinks(manifest.sidebar['/example-project/'])) {
      assert.ok(html.includes(`href="${link}"`), `Missing nested navigation ${link} in ${path}`)
    }
    assert.ok(search.includes(item.link), `Missing search entry: ${item.link}`)
  }
  const overview = await readFile(join(output, 'example-project/guide/java-nio/index.html'), 'utf8')
  assert.ok(overview.includes('href="/example-project/guide/java-nio/buffers"'))
  const buffers = await readFile(join(output, 'example-project/guide/java-nio/buffers.html'), 'utf8')
  assert.ok(buffers.includes('href="/example-project/guide/java-nio/"'))
  if (mode === 'configured') {
    assert.ok(page.includes('NIO Tutorial') && page.includes('Server Examples'))
    assert.ok(page.indexOf('Channel API') < page.indexOf('Buffer API'))
  }
  await mkdir(join(directory, 'scripts'), { recursive: true })
  await copyFile(fileURLToPath(new URL('./check-docs.mjs', import.meta.url)),
    join(directory, 'scripts/check-docs.mjs'))
  await promisify(execFile)(process.execPath, [join(directory, 'scripts/check-docs.mjs')], { timeout: 30_000 })
})
}

test('automatic navigation mirrors directories with entry first, overview links, titles and deterministic ordering', async t => {
  const directory = await temporaryRoot(t)
  const sync = files => syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(files) })
  const manifest = await sync(nestedFixture)
  const items = manifest.sidebar['/example-project/'][0].items
  assert.deepEqual(items[0], { text: 'Getting Started', link: '/example-project/' })
  assert.equal(items[1].text, 'guide')
  const guide = items[1].items
  assert.deepEqual(guide.map(item => item.text), ['Next Steps', 'fundamentals', 'implementation', 'Java NIO'])
  assert.deepEqual(guide[1].items.map(item => item.text), ['Client-Server Architecture', 'TCP/IP'])
  assert.equal(guide[2].items[0].text, 'proxy server')
  assert.deepEqual(guide[3], {
    text: 'Java NIO', link: '/example-project/guide/java-nio/', collapsed: false,
    items: [
      { text: 'Buffers', link: '/example-project/guide/java-nio/buffers' },
      { text: 'Channels', link: '/example-project/guide/java-nio/channels' },
      {
        text: 'examples', collapsed: false, items: [
          { text: 'Blocking TCP Server', link: '/example-project/guide/java-nio/examples/blocking-server' },
          { text: 'Non-blocking TCP Server', link: '/example-project/guide/java-nio/examples/non-blocking-server' }
        ]
      }
    ]
  })
  const links = navigationLinks(manifest.sidebar['/example-project/'])
  assert.equal(new Set(links).size, manifest.projects[0].pages.length)
  const reversed = await sync(Object.fromEntries(Object.entries(nestedFixture).reverse()))
  assert.deepEqual(reversed, manifest)
})

test('explicit navigation preserves custom hierarchy, order and collapse states and appends unlisted pages', async t => {
  const directory = await temporaryRoot(t)
  const manifest = await syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(configuredFixture) })
  const items = manifest.sidebar['/example-project/'][0].items
  assert.deepEqual(items.slice(0, 3).map(item => item.text), ['Introduction', 'NIO Tutorial', 'Networking Basics'])
  assert.equal(items[1].link, '/example-project/guide/java-nio/')
  assert.equal(items[1].collapsed, false)
  assert.deepEqual(items[1].items.map(item => item.text), ['Channel API', 'Buffer API', 'Server Examples'])
  assert.equal(items[1].items[2].collapsed, true)
  assert.deepEqual(items[1].items[2].items.map(item => item.text), ['Async Server', 'Blocking TCP Server'])
  assert.equal(items[2].collapsed, true)
  assert.deepEqual(items[2].items.map(item => item.text), ['TCP/IP Protocol', 'Client-Server Architecture'])
  assert.equal(items[3].text, 'guide')
  assert.deepEqual(items[3].items.map(item => item.text), ['Next Steps', 'implementation'])
  const links = navigationLinks(items)
  assert.equal(new Set(links).size, links.length)
  assert.deepEqual([...links].sort(), manifest.projects[0].pages.map(page => page.link).sort())
  assert.ok(!manifest.projects[0].assets.some(asset => asset.endsWith('docs.navigation.json')))
  await assert.rejects(readFile(join(directory, 'docs/public/_generated/example-project/docs.navigation.json')), { code: 'ENOENT' })
})

test('empty explicit navigation includes all pages automatically and index entries retain their canonical root', async t => {
  const directory = await temporaryRoot(t)
  const sync = config => syncDocumentation({
    directory, sources: [{ ...source, entry: 'index.md' }],
    fetcher: fetchFixture({
      'index.md': '# Welcome\n', 'section/index.md': '# Section\n', 'section/child.md': '# Child\n',
      ...(config === undefined ? {} : { 'docs.navigation.json': JSON.stringify(config) })
    })
  })
  const automatic = await sync()
  assert.deepEqual(await sync({ sidebar: [] }), automatic)
  assert.deepEqual(automatic.redirects, [])
  assert.deepEqual(navigationLinks(automatic.sidebar['/example-project/']), [
    '/example-project/', '/example-project/section/', '/example-project/section/child'
  ])
})

test('invalid navigation fails descriptively and removes partial generated output', async t => {
  const directory = await temporaryRoot(t)
  const cases = [
    ['{', /invalid JSON/],
    ['null', /sidebar array/],
    ['[]', /sidebar array/],
    ['{"sidebar": {}}', /sidebar array/],
    ['{"sidebar": [], "unknown": true}', /sidebar array/],
    ...[
      null, {}, { text: 'Only text' }, { text: '', link: 'guide/start.md' },
      { text: 'Unsupported', link: 'guide/start.md', icon: 'star' },
      { text: 'Wrong items', items: {} }, { text: 'Wrong link', link: 42 },
      { text: 'Wrong state', items: [], collapsed: 'false' },
      { text: 'Leaf state', link: 'guide/start.md', collapsed: true },
      { text: 'Nested invalid', items: [null] }
    ].map(item => [JSON.stringify({ sidebar: [item] }), /expected/]),
    ...[
      '../outside.md', 'guide/../../outside.md', '/guide/start.md', './guide/start.md',
      'guide\\start.md', 'https://example.com/page.md', 'guide/%2e%2e/start.md',
      'guide/start.md#start', 'guide/start.md?view=full', 'guide/start', 'guide//start.md'
    ].map(link => [JSON.stringify({ sidebar: [{ text: 'Unsafe', link }] }), /relative .md path/]),
    ...['missing.md', 'images/diagram.png.md', 'index.md'].map(link => [
      JSON.stringify({ sidebar: [{ text: 'Missing', link }] }), /page does not exist or is not imported/
    ]),
    [JSON.stringify({ sidebar: [
      { text: 'First', link: 'guide/start.md' },
      { text: 'Group', items: [{ text: 'Duplicate', link: 'guide/start.md' }] }
    ] }), /duplicate page reference/],
    [JSON.stringify({ sidebar: [{
      text: 'Overview', link: 'guide/java-nio/index.md',
      items: [{ text: 'Duplicate', link: 'guide/java-nio/index.md' }]
    }] }), /duplicate page reference/]
  ]
  for (const [configuration, error] of cases) {
    await assert.rejects(syncDocumentation({
      directory, sources: [source],
      fetcher: fetchFixture({ ...nestedFixture, 'docs.navigation.json': configuration })
    }), error, configuration)
    await assert.rejects(readFile(join(directory, 'docs/_generated/manifest.json')), { code: 'ENOENT' })
  }
})

test('network errors fail synchronization and discard previous and partial generated files', async t => {
  const directory = await temporaryRoot(t)
  await mkdir(join(directory, 'docs/_generated'), { recursive: true })
  await writeFile(join(directory, 'docs/_generated/manifest.json'), '{}')
  await assert.rejects(syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(fixture, true) }), /503/)
  await assert.rejects(readFile(join(directory, 'docs/_generated/manifest.json')), { code: 'ENOENT' })
})

test('missing entry pages, broken links and images, unsafe paths and truncated responses fail explicitly', async t => {
  const directory = await temporaryRoot(t)
  const sync = files => syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(files) })
  await assert.rejects(sync({ 'index.md': '# Home' }), /entry page docs\/guide\/start.md is required/)
  const indexSource = { ...source, entry: 'index.md' }
  const syncIndex = files => syncDocumentation({ directory, sources: [indexSource], fetcher: fetchFixture(files) })
  await assert.rejects(syncIndex({ 'index.md': '[Missing](/missing)' }), /missing link or image target/)
  await assert.rejects(syncIndex({ 'index.md': '![Missing](missing.png)' }), /missing link or image target/)
  await assert.rejects(syncIndex({ 'index.md': '[Outside](../README.md)' }), /escapes documentation/)
  await assert.rejects(sync({ 'index.md': '# Home', '../outside.md': '# Unsafe' }), /Unsafe source path/)
  await assert.rejects(syncDocumentation({ directory, sources: [{ ...source, slug: 'main' }], fetcher: fetchFixture() }), /Invalid/)
  await assert.rejects(syncDocumentation({ directory, sources: [source, source], fetcher: fetchFixture() }), /duplicate/)
  await assert.rejects(syncDocumentation({
    directory, sources: [source],
    fetcher: async url => Response.json(url.includes('/commits/') ? { sha: commit } : { truncated: true, tree: [] })
  }), /Incomplete tree/)
})

test('entry chapters work without an upstream homepage and duplicate clean routes fail', async t => {
  const directory = await temporaryRoot(t)
  const manifest = await syncDocumentation({
    directory, sources: [source],
    fetcher: fetchFixture({ 'guide/start.md': '# Start\n\n[Root](/)\n[Chapter](/guide/start.md#start)' })
  })
  assert.equal(manifest.projects[0].pages.length, 1)
  const page = await readFile(join(directory, 'docs/_generated/example-project/guide/start.md'), 'utf8')
  assert.ok(page.includes('[Root](/example-project/)'))
  assert.ok(page.includes('[Chapter](/example-project/#start)'))
  for (const file of ['guide/next/index.md', 'guide/start/index.md']) {
    await assert.rejects(syncDocumentation({
      directory, sources: [source],
      fetcher: fetchFixture({ ...fixture, [file]: '# Duplicate' })
    }), /Conflicting generated documentation route/)
  }
})

test('nested index entries serve at the project root and retain a directory redirect', async t => {
  const directory = await temporaryRoot(t)
  const manifest = await syncDocumentation({
    directory, sources: [{ ...source, entry: 'guide/java-nio/index.md' }],
    fetcher: fetchFixture(nestedFixture)
  })
  assert.deepEqual(manifest.sidebar['/example-project/'][0].items[0], {
    text: 'Java NIO', link: '/example-project/'
  })
  assert.deepEqual(manifest.redirects, [{ from: '/example-project/guide/java-nio/', to: '/example-project/' }])
  const links = navigationLinks(manifest.sidebar['/example-project/'])
  assert.equal(links.filter(link => link === '/example-project/').length, 1)
  assert.ok(!links.includes('/example-project/guide/java-nio/'))
  const buffers = await readFile(join(directory, 'docs/_generated/example-project/guide/java-nio/buffers.md'), 'utf8')
  assert.ok(buffers.includes('[Overview](/example-project/)'))
})

test('navigation metadata cannot become a broken downloadable content link', async t => {
  const directory = await temporaryRoot(t)
  await assert.rejects(syncDocumentation({
    directory, sources: [source],
    fetcher: fetchFixture({
      ...configuredFixture, 'README.md': '# Metadata\n\n[Config](docs.navigation.json)\n'
    })
  }), /missing link or image target: docs.navigation.json/)
})

test('guide cards escape configured plain text and index entries need no alias', async t => {
  const directory = await temporaryRoot(t)
  const manifest = await syncDocumentation({
    directory, sources: [{ ...source, title: 'I/O & <Networking>', description: 'Read "chapters" & examples.', entry: 'index.md' }],
    fetcher: fetchFixture({ 'index.md': '# Introduction\n\nDocumentation.' })
  })
  assert.deepEqual(manifest.redirects, [])
  assert.deepEqual(manifest.projects[0].pages, [{ text: 'Introduction', link: '/example-project/' }])
  const cards = await readFile(join(directory, 'docs/_generated/guide-cards.md'), 'utf8')
  assert.ok(cards.includes('I/O &amp; &lt;Networking&gt;'))
  assert.ok(cards.includes('Read &quot;chapters&quot; &amp; examples.'))
})
