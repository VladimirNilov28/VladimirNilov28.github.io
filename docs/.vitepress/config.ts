import { defineConfig, type HeadConfig } from 'vitepress'
import importedDocs from '../_generated/manifest.json'

export default defineConfig({
  lang: 'en-US',
  title: 'Vladimir Nilov',
  description: 'Vladimir Nilov: software engineering projects and technical guides.',
  base: '/',
  cleanUrls: true,
  appearance: true,
  srcExclude: ['_generated/guides.md', '_generated/guide-cards.md'],
  rewrites: importedDocs.rewrites,
  transformPageData(pageData) {
    if (!importedDocs.projects.some(project =>
      pageData.filePath.startsWith(`_generated/${project.slug}/`))) return
    pageData.frontmatter.layout = 'doc'
    pageData.frontmatter.sidebar = true
    const canonical = '/' + pageData.relativePath.replace(/(?:^|\/)index\.md$/, '/').replace(/\.md$/, '')
    const head: HeadConfig[] = pageData.frontmatter.head ?? []
    pageData.frontmatter.head = [
      ...head.filter(([tag, attributes]) =>
        tag !== 'link' || attributes.rel !== 'canonical'),
      ['link', { rel: 'canonical', href: canonical }]
    ]
  },
  themeConfig: {
    sidebar: importedDocs.sidebar,
    logoLink: '/main/',
    nav: [
      { text: 'Home', link: '/main/' },
      { text: 'Guides', link: '/guides/' }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/VladimirNilov28' }
    ],
    search: {
      provider: 'local'
    }
  }
})
