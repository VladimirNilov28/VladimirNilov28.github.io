import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { rewriteMarkdown, syncDocumentation } from './sync-docs.mjs'

const source = {
  title: 'Example Project',
  repository: 'example/project',
  branch: 'main',
  path: 'docs',
  slug: 'example-project'
}
const commit = 'a'.repeat(40)
const image = Buffer.from([0, 255, 1, 128, 2])
const fixture = {
  'index.md': '---\nlayout: home\nhero:\n  actions:\n    - text: Start\n      link: /guide/start\n---\n[Start](guide/start.md)\n',
  'guide/start.md': '# Getting Started\n\n[Home](../index.md)\n[Next](/guide/next#details)\n![Diagram](../images/diagram.png)\n[Download](../files/example.txt)\n',
  'guide/next.md': '# Next Steps\n\n## Details\n',
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
  assert.equal(manifest.projects[0].pages.length, 3)
  assert.equal(manifest.projects[0].assets.length, 2)
  assert.equal(manifest.rewrites['_generated/example-project/index.md'], 'example-project/index.md')
  assert.deepEqual(manifest.sidebar['/example-project/'][0].items.map(page => page.link), [
    '/example-project/', '/example-project/guide/next', '/example-project/guide/start'
  ])
  assert.equal(await readFile(join(directory, 'docs/_generated/example-project/index.md'), 'utf8'),
    fixture['index.md'].replace('link: /guide/start', 'link: /example-project/guide/start')
      .replace('(guide/start.md)', '(/example-project/guide/start)'))
  const page = await readFile(join(directory, 'docs/_generated/example-project/guide/start.md'), 'utf8')
  assert.ok(page.includes('[Home](/example-project/)'))
  assert.ok(page.includes('[Next](/example-project/guide/next#details)'))
  assert.ok(page.includes('![Diagram](/_generated/example-project/images/diagram.png)'))
  assert.ok(page.includes('[Download](/_generated/example-project/files/example.txt)'))
  assert.deepEqual(await readFile(join(directory, 'docs/public/_generated/example-project/images/diagram.png')), image)
  assert.deepEqual((await readdir(join(directory, 'docs/_generated/example-project'))).sort(), ['guide', 'index.md'])
  assert.ok((await readFile(join(directory, 'docs/_generated/guides.md'), 'utf8')).includes('[Example Project](/example-project/)'))
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
  await syncDocumentation({ directory, sources: [source], fetcher: fetchFixture() })
  await assert.rejects(readFile(join(directory, 'docs/_generated/second/index.md')), { code: 'ENOENT' })
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
  assert.ok(result.includes('[Current page](/example-project/guide/start?view=full)'))
  assert.ok(result.includes('[External](https://example.com/missing)'))
  assert.ok(result.includes('[Anchor](#local)'))
  assert.ok(result.includes('`[Example](/missing)`'))
  assert.ok(result.includes('```md\n[Example](/missing)\n```'))
  assert.ok(result.includes('~~~markdown\n![Example](/missing.png)\n~~~'))
  assert.equal(rewriteMarkdown('---\nhero:\n  link: "/guide/next#details" # Keep this\n---',
    'index.md', source, files),
  '---\nhero:\n  link: "/example-project/guide/next#details" # Keep this\n---')
})

test('VitePress builds rewritten routes, relative links, navigation and unchanged static assets', async t => {
  const directory = await temporaryRoot(t)
  await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
  const manifest = await syncDocumentation({ directory, sources: [source], fetcher: fetchFixture() })
  await mkdir(join(directory, 'docs/.vitepress'), { recursive: true })
  await mkdir(join(directory, 'docs/guides'), { recursive: true })
  await writeFile(join(directory, 'docs/guides/index.md'), '# Guides\n\n<!--@include: ../_generated/guides.md-->\n')
  await writeFile(join(directory, 'docs/.vitepress/config.mjs'), `export default ${JSON.stringify({
    base: '/', cleanUrls: true,
    srcExclude: ['_generated/guides.md'],
    rewrites: manifest.rewrites,
    themeConfig: { sidebar: manifest.sidebar }
  })}`)
  const vitepress = fileURLToPath(new URL('../node_modules/vitepress/bin/vitepress.js', import.meta.url))
  await promisify(execFile)(process.execPath, [vitepress, 'build', join(directory, 'docs')], { timeout: 60_000 })
  const output = join(directory, 'docs/.vitepress/dist')
  const page = await readFile(join(output, 'example-project/guide/start.html'), 'utf8')
  assert.ok(page.includes('href="/example-project/guide/next#details"'))
  assert.ok(page.includes('src="/_generated/example-project/images/diagram.png"'))
  assert.ok(page.includes('href="/_generated/example-project/files/example.txt"'))
  for (const item of manifest.projects[0].pages) {
    assert.ok(page.includes(`href="${item.link}"`))
  }
  assert.deepEqual(await readFile(join(output, '_generated/example-project/images/diagram.png')), image)
  assert.equal(await readFile(join(output, '_generated/example-project/files/example.txt'), 'utf8'), 'Example download\n')
  assert.ok((await readFile(join(output, 'guides/index.html'), 'utf8')).includes('href="/example-project/"'))
  await readFile(join(output, 'example-project/index.html'))
})

test('network errors fail synchronization and discard previous and partial generated files', async t => {
  const directory = await temporaryRoot(t)
  await mkdir(join(directory, 'docs/_generated'), { recursive: true })
  await writeFile(join(directory, 'docs/_generated/manifest.json'), '{}')
  await assert.rejects(syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(fixture, true) }), /503/)
  await assert.rejects(readFile(join(directory, 'docs/_generated/manifest.json')), { code: 'ENOENT' })
})

test('missing landing pages, broken links and images, unsafe paths and truncated responses fail explicitly', async t => {
  const directory = await temporaryRoot(t)
  const sync = files => syncDocumentation({ directory, sources: [source], fetcher: fetchFixture(files) })
  await assert.rejects(sync({ 'guide/start.md': '# Start' }), /index.md is required/)
  await assert.rejects(sync({ 'index.md': '[Missing](/missing)' }), /missing link or image target/)
  await assert.rejects(sync({ 'index.md': '![Missing](missing.png)' }), /missing link or image target/)
  await assert.rejects(sync({ 'index.md': '[Outside](../README.md)' }), /escapes documentation/)
  await assert.rejects(sync({ 'index.md': '# Home', '../outside.md': '# Unsafe' }), /Unsafe source path/)
  await assert.rejects(syncDocumentation({ directory, sources: [{ ...source, slug: 'main' }], fetcher: fetchFixture() }), /Invalid/)
  await assert.rejects(syncDocumentation({ directory, sources: [source, source], fetcher: fetchFixture() }), /duplicate/)
  await assert.rejects(syncDocumentation({
    directory, sources: [source],
    fetcher: async url => Response.json(url.includes('/commits/') ? { sha: commit } : { truncated: true, tree: [] })
  }), /Incomplete tree/)
})
