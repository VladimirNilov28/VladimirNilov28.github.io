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
        !/^[\w.-]+\/[\w.-]+$/.test(source.repository) ||
        typeof source.branch !== 'string' || !source.branch ||
        !safePath(source.path) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.slug) ||
        ['main', 'guides', 'assets', 'public', 'index', '404'].includes(source.slug) ||
        slugs.has(source.slug)) {
      throw new Error(`Invalid or duplicate documentation source: ${JSON.stringify(source)}`)
    }
    slugs.add(source.slug)
  }
}

const encodePath = path => path.split('/').map(encodeURIComponent).join('/')
const pageUrl = (slug, file) => `/${slug}/${encodePath(file)}`
  .replace(/(?:^|\/)index\.md$/, '/').replace(/\.md$/, '')

function rewriteUrl(url, file, source, files) {
  if (!url || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(url)) return url
  const [, pathname, suffix = ''] = url.match(/^([^?#]*)(.*)$/)
  if (!pathname) return pageUrl(source.slug, file) + suffix
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
  const candidates = [target, target.replace(/\.html$/, '.md'), `${target}.md`,
    target ? `${target}/index.md` : 'index.md']
  const match = candidates.find(candidate => files.has(candidate))
  if (!match) throw new Error(`${source.repository}:${file}: missing link or image target: ${url}`)
  return (match.endsWith('.md')
    ? pageUrl(source.slug, match)
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

function pageTitle(markdown, file, source) {
  if (file === 'index.md') return source.title
  const title = markdown.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ??
    markdown.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1]
  return title ?? posix.basename(file, '.md').replace(/[-_]/g, ' ')
}

export async function syncDocumentation({ directory = root, sources, fetcher = fetch } = {}) {
  sources ??= JSON.parse(await readFile(join(directory, 'docs.sources.json'), 'utf8'))
  validateSources(sources)
  const generated = join(directory, 'docs/_generated')
  const publicAssets = join(directory, 'docs/public/_generated')
  const clean = () => Promise.all([generated, publicAssets].map(path => rm(path, { recursive: true, force: true })))
  await clean()
  const manifest = { rewrites: {}, sidebar: {}, projects: [] }
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
      if (!files.has('index.md')) throw new Error(`${source.repository}: ${source.path}/index.md is required`)
      const pages = []
      const assets = []
      for (const file of [...files.keys()].sort()) {
        const data = await request(`https://raw.githubusercontent.com/${source.repository}/${commit.sha}/${encodePath(`${source.path}/${file}`)}`)
        const isMarkdown = file.endsWith('.md')
        const destination = join(isMarkdown ? generated : publicAssets, source.slug, file)
        await mkdir(dirname(destination), { recursive: true })
        if (isMarkdown) {
          const markdown = data.toString('utf8')
          await writeFile(destination, rewriteMarkdown(markdown, file, source, files))
          const link = pageUrl(source.slug, file)
          pages.push({ text: pageTitle(markdown, file, source), link })
          manifest.rewrites[`_generated/${source.slug}/${file}`] = `${source.slug}/${file}`
        } else {
          await writeFile(destination, data)
          assets.push(`/_generated/${source.slug}/${encodePath(file)}`)
        }
      }
      pages.sort((a, b) => Number(b.link === `/${source.slug}/`) - Number(a.link === `/${source.slug}/`) ||
        a.link.localeCompare(b.link))
      manifest.sidebar[`/${source.slug}/`] = [{ text: source.title, items: pages }]
      manifest.projects.push({ ...source, commit: commit.sha, pages, assets })
      console.log(`Imported ${source.repository}@${commit.sha.slice(0, 7)}: ${pages.length} pages, ${assets.length} assets`)
    }
    const guideLinks = manifest.projects.map(source =>
      `- [${source.title}](/${source.slug}/) ([source](https://github.com/${source.repository}))`).join('\n')
    await writeFile(join(generated, 'guides.md'), `${guideLinks}\n`)
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
