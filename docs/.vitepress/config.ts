import { defineConfig } from 'vitepress'
import importedDocs from '../_generated/manifest.json'

export default defineConfig({
  lang: 'en-US',
  title: 'Vladimir Nilov',
  description: 'Vladimir Nilov: software engineering projects and technical guides.',
  base: '/',
  cleanUrls: true,
  appearance: true,
  srcExclude: ['_generated/guides.md'],
  rewrites: importedDocs.rewrites,
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
