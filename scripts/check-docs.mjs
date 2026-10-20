import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = join(root, 'docs/.vitepress/dist')
const manifest = JSON.parse(await readFile(join(root, 'docs/_generated/manifest.json'), 'utf8'))
const errors = new Set()
let checkedLinks = 0
let checkedImages = 0
let checkedAssets = 0

async function outputFile(pathname) {
  const path = resolve(output, `.${decodeURIComponent(pathname)}`)
  assert.ok(path.startsWith(`${output}/`) || path === output, `Path escapes build output: ${pathname}`)
  const matches = []
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      if ((await stat(candidate)).isFile()) matches.push(candidate)
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }
  assert.ok(matches.length <= 1, `Conflicting output files for ${pathname}: ${matches.join(', ')}`)
  return matches[0]
}

async function htmlFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await htmlFiles(path))
    else if (entry.name.endsWith('.html')) files.push(path)
  }
  return files
}

for (const route of ['/', '/main/']) {
  assert.ok(await outputFile(route), `Missing central output page: ${route}`)
}
assert.ok(!await outputFile('/guides/'), 'Removed guides catalog must not be generated')

for (const project of manifest.projects) {
  const navigation = manifest.sidebar[`/${project.slug}/`].flatMap(group => group.items.map(item => item.link))
  assert.equal(new Set(navigation).size, navigation.length, `Duplicate sidebar entries: ${project.slug}`)
  const home = await readFile(join(output, 'main/index.html'), 'utf8')
  assert.ok(home.includes(`class="project-card guide-card" href="/${project.slug}/"`),
    `Missing direct homepage guide card: ${project.slug}`)
  for (const page of project.pages) {
    assert.ok(navigation.includes(page.link), `Missing sidebar entry: ${page.link}`)
    const file = await outputFile(page.link)
    assert.ok(file, `Missing imported output page: ${page.link}`)
    const html = await readFile(file, 'utf8')
    assert.ok(html.includes('class="VPSidebar'), `Missing documentation sidebar: ${page.link}`)
    assert.ok(!html.includes('class="VPHome') && !html.includes('class="VPHero'),
      `Unexpected documentation homepage layout: ${page.link}`)
    assert.ok(html.includes(`rel="canonical" href="${page.link}"`), `Missing canonical URL: ${page.link}`)
    for (const link of navigation) {
      assert.ok(html.includes(`href="${link}"`), `Missing rendered navigation link ${link} in ${page.link}`)
    }
  }
  for (const asset of project.assets) {
    assert.ok(await outputFile(asset), `Missing imported asset: ${asset}`)
  }
}

for (const redirect of manifest.redirects) {
  const file = await outputFile(redirect.from)
  assert.ok(file, `Missing legacy URL redirect: ${redirect.from}`)
  const html = await readFile(file, 'utf8')
  assert.ok(html.includes(`http-equiv="refresh" content="0; url=${redirect.to}"`))
  assert.ok(html.includes(`rel="canonical" href="${redirect.to}"`))
  assert.ok(html.includes('name="robots" content="noindex"'))
  assert.ok(!manifest.projects.some(project => project.pages.some(page => page.link === redirect.from)),
    `Redirect duplicated in navigation: ${redirect.from}`)
}

const unescape = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
const outputRoutes = new Set()
for (const file of await htmlFiles(output)) {
  const route = file.slice(output.length).replaceAll('\\', '/')
  const cleanRoute = route.replace(/(?:\/index)?\.html$/, '').replace(/\/$/, '')
  assert.ok(!outputRoutes.has(cleanRoute), `Duplicate clean output route: ${cleanRoute}`)
  outputRoutes.add(cleanRoute)
  const html = await readFile(file, 'utf8')
  for (const match of html.matchAll(/<(a|img|script|link)\b[^>]*?\b(href|src)="([^"]*)"/g)) {
    const [, tag, , raw] = match
    const url = new URL(unescape(raw), `https://portfolio.test${route}`)
    if (url.origin !== 'https://portfolio.test') continue
    if (tag === 'img') checkedImages++
    else if (tag === 'a') checkedLinks++
    else checkedAssets++
    const target = await outputFile(url.pathname)
    if (!target) {
      errors.add(`${route}: missing ${tag === 'img' ? 'image' : 'link'} ${raw}`)
    } else if (url.hash && target.endsWith('.html')) {
      const id = decodeURIComponent(url.hash.slice(1))
      const destination = await readFile(target, 'utf8')
      if (!destination.includes(`id="${id}"`) && !destination.includes(`name="${id}"`)) {
        errors.add(`${route}: missing anchor ${raw}`)
      }
    }
  }
}

const chunks = join(output, 'assets/chunks')
const searchFile = (await readdir(chunks)).find(file => file.startsWith('@localSearchIndexroot.'))
assert.ok(searchFile, 'Missing local search index')
const search = await readFile(join(chunks, searchFile), 'utf8')
for (const redirect of manifest.redirects) {
  assert.ok(!search.includes(redirect.from), `Redirect duplicated in search: ${redirect.from}`)
}

if (errors.size) {
  console.error([...errors].join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${manifest.projects.length} imported project(s), ${manifest.projects.reduce((count, project) => count + project.pages.length, 0)} imported pages and all sidebar entries.`)
  console.log(`Checked ${checkedLinks} internal links, ${checkedImages} images, and ${checkedAssets} script/style/head assets: no broken links or missing files.`)
  console.log(`Verified canonical routes, ${manifest.redirects.length} non-indexed redirects, direct guide cards, and no conflicting HTML paths.`)
}
