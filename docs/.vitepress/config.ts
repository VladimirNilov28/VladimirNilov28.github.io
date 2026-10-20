import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'en-US',
  title: 'Vladimir Nilov',
  description: 'Vladimir Nilov: software engineering projects and technical guides.',
  base: '/',
  cleanUrls: true,
  themeConfig: {
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
