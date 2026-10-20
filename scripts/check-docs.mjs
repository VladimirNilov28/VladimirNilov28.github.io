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

async function outputFile(pathname) {
  const path = resolve(output, `.${decodeURIComponent(pathname)}`)
  assert.ok(path.startsWith(`${output}/`) || path === output, `Path escapes build output: ${pathname}`)
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    }
  }
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

for (const route of ['/', '/main/', '/guides/']) {
  assert.ok(await outputFile(route), `Missing central output page: ${route}`)
}

for (const project of manifest.projects) {
  const navigation = manifest.sidebar[`/${project.slug}/`].flatMap(group => group.items.map(item => item.link))
  for (const page of project.pages) {
    assert.ok(navigation.includes(page.link), `Missing sidebar entry: ${page.link}`)
    const file = await outputFile(page.link)
    assert.ok(file, `Missing imported output page: ${page.link}`)
    if (page.link !== `/${project.slug}/`) {
      const html = await readFile(file, 'utf8')
      for (const link of navigation) {
        assert.ok(html.includes(`href="${link}"`), `Missing rendered navigation link ${link} in ${page.link}`)
      }
    }
  }
  for (const asset of project.assets) {
    assert.ok(await outputFile(asset), `Missing imported asset: ${asset}`)
  }
}

const unescape = value => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
for (const file of await htmlFiles(output)) {
  const route = file.slice(output.length).replaceAll('\\', '/')
  const html = await readFile(file, 'utf8')
  for (const match of html.matchAll(/<(a|img)\b[^>]*?\b(href|src)="([^"]*)"/g)) {
    const [, tag, , raw] = match
    const url = new URL(unescape(raw), `https://portfolio.test${route}`)
    if (url.origin !== 'https://portfolio.test') continue
    if (tag === 'img') checkedImages++
    else checkedLinks++
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

if (errors.size) {
  console.error([...errors].join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${manifest.projects.length} imported project(s), ${manifest.projects.reduce((count, project) => count + project.pages.length, 0)} imported pages and all sidebar entries.`)
  console.log(`Checked ${checkedLinks} internal links and ${checkedImages} images: no broken links or missing files.`)
}
