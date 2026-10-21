import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const excluded = new Set([
  '.git', '.github', '.vitepress', 'node_modules', 'dist', 'build', 'out',
  'coverage', '.cache', 'package.json', 'package-lock.json', '.DS_Store'
])

function safePath(path) {
  return typeof path === 'string' && path !== '' && !path.includes('\\') &&
    !path.startsWith('/') && path.split('/').every(part => part && part !== '.' && part !== '..')
}

function validateSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('docs.sources.json must contain at least one source')
  }
  const slugs = new Set()
  for (const source of sources) {
    if (!source || typeof source.title !== 'string' || !source.title.trim() ||
        typeof source.description !== 'string' || !source.description.trim() ||
        !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
        typeof source.branch !== 'string' || !source.branch ||
        !safePath(source.path) || !safePath(source.entry) || !source.entry.endsWith('.md') ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.slug) ||
        ['main', 'guides', 'assets', 'public', 'index', '404'].includes(source.slug) ||
        slugs.has(source.slug)) {
      throw new Error(`Invalid or duplicate documentation source: ${JSON.stringify(source)}`)
    }
    slugs.add(source.slug)
  }
}

const encodePath = path => path.split('/').map(encodeURIComponent).join('/')
const originalPageUrl = (slug, file) => `/${slug}/${encodePath(file)}`
  .replace(/(?:^|\/)index\.md$/, '/').replace(/\.md$/, '')
const pageUrl = (source, file) => file === source.entry || file === 'index.md'
  ? `/${source.slug}/`
  : originalPageUrl(source.slug, file)

function addRewrite(manifest, from, to) {
  const route = path => path.replace(/(?:\/index)?\.md$/, '').replace(/\/$/, '')
  if (Object.values(manifest.rewrites).some(path => route(path) === route(to))) {
    throw new Error(`Conflicting generated documentation route: ${to}`)
  }
  manifest.rewrites[from] = to
}

function redirectMarkdown(to) {
  const head = [
    ['meta', { 'http-equiv': 'refresh', content: `0; url=${to}` }],
    ['meta', { name: 'robots', content: 'noindex' }],
    ['link', { rel: 'canonical', href: to }],
    ['script', {}, `location.replace(${JSON.stringify(to)} + location.search + location.hash)`]
  ]
  return `---\nlayout: page\ntitle: Redirecting\nsearch: false\nhead: ${JSON.stringify(head)}\n---\n\n[Continue to the documentation](${to}).\n`
}

function rewriteUrl(url, file, source, files) {
  if (!url || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(url)) return url
  const [, pathname, suffix = ''] = url.match(/^([^?#]*)(.*)$/)
  if (!pathname) return pageUrl(source, file) + suffix
  let target = decodeURIComponent(pathname)
  if (target.startsWith('/')) {
    target = target.slice(1)
    for (const prefix of [`${source.slug}/`, `${source.path}/`]) {
      if (target === prefix.slice(0, -1)) {
        target = ''
        break
      }
      if (target.startsWith(prefix)) {
        target = target.slice(prefix.length)
        break
      }
    }
  } else {
    target = posix.join(posix.dirname(file), target)
  }
  target = posix.normalize(target).replace(/\/$/, '')
  if (target === '.') target = ''
  if (target.startsWith('../') || target === '..' || target.includes('\\')) {
    throw new Error(`${source.repository}:${file}: link escapes documentation: ${url}`)
  }
  const candidates = [!target || /^index\.(?:md|html)$/.test(target) ? source.entry : target,
    target.replace(/\.html$/, '.md'), `${target}.md`,
    target ? `${target}/index.md` : 'index.md']
  const match = candidates.find(candidate => files.has(candidate))
  if (!match) throw new Error(`${source.repository}:${file}: missing link or image target: ${url}`)
  return (match.endsWith('.md')
    ? pageUrl(source, match)
    : `/_generated/${source.slug}/${encodePath(match)}`) + suffix
}

export function rewriteMarkdown(markdown, file, source, files) {
  const rewrite = value => {
    const angled = value.startsWith('<') && value.endsWith('>')
    const url = angled ? value.slice(1, -1) : value
    const result = rewriteUrl(url, file, source, files)
    return angled ? `<${result}>` : result
  }
  let fence
  let frontmatter = false
  return markdown.split('\n').map((line, index) => {
    if (index === 0 && line.trim() === '---') {
      frontmatter = true
      return line
    }
    if (frontmatter) {
      if (line.trim() === '---') frontmatter = false
      return line.replace(/^(\s*(?:link|src|image|href):\s*)(["']?)([^"' \t]+)\2(\s*(?:#.*)?)$/,
        (_, start, quote, url, end) => `${start}${quote}${rewrite(url)}${quote}${end}`)
    }
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined
      return line
    }
    if (fence || /^(?: {4}|\t)/.test(line)) return line
    return line.split(/(`+[^`]*`+)/).map((part, index) => {
      if (index % 2) return part
      return part
        .replace(/(!?\[[^\]\n]*\]\(\s*)(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)/g,
          (_, start, url) => start + rewrite(url))
        .replace(/^(\s{0,3}\[[^\]]+\]:\s*)(<[^>\n]+>|\S+)/,
          (_, start, url) => start + rewrite(url))
        .replace(/(\b(?:href|src)\s*=\s*)(["'])(.*?)\2/g,
          (_, start, quote, url) => `${start}${quote}${rewrite(url)}${quote}`)
    }).join('')
  }).join('\n')
}

function pageTitle(markdown, file) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const rawTitle = frontmatter?.[1].match(/^title:\s*(.+?)\s*$/m)?.[1]
  const title = rawTitle?.replace(/^["'](.*)["']$/, '$1') ??
    markdown.slice(frontmatter?.[0].length ?? 0).match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]
  return title ?? posix.basename(file, '.md').replace(/[-_]/g, ' ')
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const directoryOf = file => posix.dirname(file) === '.' ? '' : posix.dirname(file)
const within = (file, directory) => !directory || file.startsWith(`${directory}/`)

function automaticNavigation(pages, source, base = '') {
  const tree = { pages: [], groups: new Map() }
  for (const page of pages) {
    const relative = base ? page.file.slice(base.length + 1) : page.file
    let node = tree
    for (const directory of relative.split('/').slice(0, -1)) {
      if (!node.groups.has(directory)) node.groups.set(directory, { pages: [], groups: new Map() })
      node = node.groups.get(directory)
    }
    node.pages.push(page)
  }
  const build = node => [
    ...node.pages.sort((a, b) => compare(a.file, b.file)).map(({ text, link }) => ({ text, link })),
    ...[...node.groups].sort(([a], [b]) => compare(a, b)).map(([name, child]) => {
      const overview = child.pages.find(page => posix.basename(page.file) === 'index.md')
      if (overview) child.pages = child.pages.filter(page => page !== overview)
      return {
        text: overview?.text ?? name.replace(/[-_]/g, ' '),
        ...(overview ? { link: overview.link } : {}),
        collapsed: false,
        items: build(child)
      }
    })
  ]
  const entry = pages.find(page => page.file === source.entry)
  if (entry) {
    return [
      { text: entry.text, link: entry.link },
      ...automaticNavigation(pages.filter(page => page !== entry), source, base)
    ]
  }
  return build(tree)
}

function navigationSidebar(configuration, pages, source) {
  if (configuration === undefined) return automaticNavigation(pages, source)
  const fail = message => {
    throw new Error(`${source.repository}: docs.navigation.json: ${message}`)
  }
  let navigation
  try {
    navigation = JSON.parse(configuration)
  } catch (error) {
    fail(`invalid JSON: ${error.message}`)
  }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!object(navigation) || Object.keys(navigation).some(key => key !== 'sidebar') ||
      !Array.isArray(navigation.sidebar)) fail('expected an object containing only a sidebar array')
  const byFile = new Map(pages.map(page => [page.file, page]))
  const referenced = new Set()
  const groups = []
  const parse = (items, location) => items.map((item, index) => {
    const at = `${location}[${index}]`
    if (!object(item) || Object.keys(item).some(key => !['text', 'link', 'items', 'collapsed'].includes(key)) ||
        typeof item.text !== 'string' || !item.text.trim() ||
        (!Object.hasOwn(item, 'link') && !Object.hasOwn(item, 'items')) ||
        (Object.hasOwn(item, 'items') && !Array.isArray(item.items)) ||
        (Object.hasOwn(item, 'collapsed') &&
          (typeof item.collapsed !== 'boolean' || !Object.hasOwn(item, 'items')))) {
      fail(`${at}: expected text, a Markdown link and/or items array, and optional boolean collapsed for groups`)
    }
    const result = { text: item.text }
    const files = []
    if (Object.hasOwn(item, 'link')) {
      if (!safePath(item.link) || /[?#:%\x00-\x1f]/.test(item.link) || !item.link.endsWith('.md')) {
        fail(`${at}.link: expected a documentation-root-relative .md path without traversal, URL encoding, query or fragment`)
      }
      if (!byFile.has(item.link)) fail(`${at}.link: page does not exist or is not imported: ${item.link}`)
      if (referenced.has(item.link)) fail(`${at}.link: duplicate page reference: ${item.link}`)
      referenced.add(item.link)
      files.push(item.link)
      result.link = byFile.get(item.link).link
    }
    if (item.items !== undefined) {
      const children = parse(item.items, `${at}.items`)
      result.items = children.map(child => child.item)
      files.push(...children.flatMap(child => child.files))
      if (item.collapsed !== undefined) result.collapsed = item.collapsed
      if (files.length) {
        let directory = directoryOf(files[0])
        while (!files.every(file => within(file, directory))) directory = directoryOf(directory)
        groups.push({ item: result, directory, pages: [] })
      }
    }
    return { item: result, files }
  })
  const sidebar = parse(navigation.sidebar, 'sidebar').map(node => node.item)
  const remaining = []
  // Children precede parents; ties go to the first configured group.
  groups.sort((a, b) => b.directory.split('/').length - a.directory.split('/').length ||
    b.directory.length - a.directory.length)
  for (const page of pages) {
    if (referenced.has(page.file)) continue
    const group = groups.find(group => within(page.file, group.directory))
    if (group) group.pages.push(page)
    else remaining.push(page)
  }
  for (const group of groups) {
    group.item.items.push(...automaticNavigation(group.pages, source, group.directory))
  }
  return [...sidebar, ...automaticNavigation(remaining, source)]
}

export async function syncDocumentation({ directory = root, sources, fetcher = fetch } = {}) {
  sources ??= JSON.parse(await readFile(join(directory, 'docs.sources.json'), 'utf8'))
  validateSources(sources)
  const generated = join(directory, 'docs/_generated')
  const publicAssets = join(directory, 'docs/public/_generated')
  const clean = () => Promise.all([generated, publicAssets].map(path => rm(path, { recursive: true, force: true })))
  await clean()
  const manifest = { rewrites: {}, sidebar: {}, projects: [], redirects: [] }
  try {
    const request = async (url, json = false) => {
      const response = await fetcher(url, {
        headers: { 'User-Agent': 'vitepress-docs-sync', ...(json ? { Accept: 'application/vnd.github+json' } : {}) },
        signal: AbortSignal.timeout(30_000)
      })
      if (!response.ok) throw new Error(`GitHub fetch failed (${response.status}): ${url}`)
      return json ? response.json() : Buffer.from(await response.arrayBuffer())
    }
    for (const source of sources) {
      const api = `https://api.github.com/repos/${source.repository}`
      const commit = await request(`${api}/commits/${encodeURIComponent(source.branch)}`, true)
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error(`Invalid commit for ${source.repository}`)
      const tree = await request(`${api}/git/trees/${commit.sha}?recursive=1`, true)
      if (tree.truncated || !Array.isArray(tree.tree)) throw new Error(`Incomplete tree for ${source.repository}`)
      const files = new Map()
      for (const entry of tree.tree) {
        if (!entry.path.startsWith(`${source.path}/`) || entry.type !== 'blob') continue
        const file = entry.path.slice(source.path.length + 1)
        if (!safePath(file)) throw new Error(`Unsafe source path: ${entry.path}`)
        if (file.split('/').some(part => excluded.has(part))) continue
        if (!['100644', '100755'].includes(entry.mode)) throw new Error(`Unsupported source file: ${entry.path}`)
        files.set(file, entry)
      }
      if (!files.has(source.entry)) throw new Error(`${source.repository}: entry page ${source.path}/${source.entry} is required`)
      const pages = []
      const assets = []
      let navigation
      const download = file => request(`https://raw.githubusercontent.com/${source.repository}/${commit.sha}/${encodePath(`${source.path}/${file}`)}`)
      if (files.has('docs.navigation.json')) {
        navigation = (await download('docs.navigation.json')).toString('utf8')
        files.delete('docs.navigation.json')
      }
      for (const file of [...files.keys()].sort()) {
        if (file === 'index.md' && file !== source.entry) continue
        const data = await download(file)
        const isMarkdown = file.endsWith('.md')
        const destination = join(isMarkdown ? generated : publicAssets, source.slug, file)
        await mkdir(dirname(destination), { recursive: true })
        if (isMarkdown) {
          const markdown = data.toString('utf8')
          await writeFile(destination, rewriteMarkdown(markdown, file, source, files))
          const link = pageUrl(source, file)
          pages.push({ file, text: pageTitle(markdown, file), link })
          addRewrite(manifest, `_generated/${source.slug}/${file}`,
            `${source.slug}/${file === source.entry ? 'index.md' : file}`)
        } else {
          await writeFile(destination, data)
          assets.push(`/_generated/${source.slug}/${encodePath(file)}`)
        }
      }
      if (source.entry !== 'index.md') {
        const from = originalPageUrl(source.slug, source.entry)
        const to = `/${source.slug}/`
        const file = `_generated/_redirects/${source.slug}.md`
        await mkdir(join(generated, '_redirects'), { recursive: true })
        await writeFile(join(directory, 'docs', file), redirectMarkdown(to))
        addRewrite(manifest, file, `${source.slug}/${source.entry}`)
        manifest.redirects.push({ from, to })
      }
      pages.sort((a, b) => Number(b.file === source.entry) - Number(a.file === source.entry) ||
        compare(a.link, b.link))
      manifest.sidebar[`/${source.slug}/`] = [{ text: source.title, items: navigationSidebar(navigation, pages, source) }]
      manifest.projects.push({
        ...source, commit: commit.sha,
        pages: pages.map(({ text, link }) => ({ text, link })), assets
      })
      console.log(`Imported ${source.repository}@${commit.sha.slice(0, 7)}: ${pages.length} pages, ${assets.length} assets`)
    }
    const escape = text => text.replace(/[&<>"']/g, character =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
    const guideCards = manifest.projects.map(source =>
      `  <a class="project-card guide-card" href="/${source.slug}/">\n    <h3>${escape(source.title)}</h3>\n    <p>${escape(source.description)}</p>\n  </a>`).join('\n')
    await writeFile(join(generated, 'guide-cards.md'), `<div class="project-grid">\n${guideCards}\n</div>\n`)
    await writeFile(join(generated, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    return manifest
  } catch (error) {
    await clean()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await syncDocumentation()
  } catch (error) {
    console.error(`Documentation synchronization failed: ${error.message}`)
    process.exitCode = 1
  }
}
