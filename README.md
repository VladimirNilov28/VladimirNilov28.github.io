# Vladimir Nilov's developer website

A minimal personal website built with VitePress 1.x and its standard theme.
All site content and the TypeScript configuration live in `docs/`.

## Development

Use Node.js 24 and npm 11 or newer. With nvm installed:

```sh
nvm use
npm ci
npm run docs:dev
```

The development server prints its local URL.

## Build and preview

```sh
npm run docs:build
npm run docs:preview
```

The static site is generated in `docs/.vitepress/dist/`. Preview serves that
build locally.

## Site structure

- `/main/`: introduction, featured project cards, and selected technical guides.
- `/guides/`: index of published project documentation on GitHub.
- `/`: static HTML meta-refresh redirect to `/main/`, with a fallback link
  that also works without JavaScript.

The site uses `base: '/'` for `https://VladimirNilov28.github.io`, clean URLs,
and VitePress local search. The standard theme supplies typography, navigation,
and light/dark mode. `docs/.vitepress/theme/style.css` adds only a responsive
project-card layout using the theme's color variables.

To add a guide, link published documentation from `docs/guides/index.md`, or
create a Markdown file under `docs/guides/` and link it from that index.

Deployment automation is intentionally not configured.
