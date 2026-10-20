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
npm run docs:check
npm run docs:preview
```

The static site is generated in `docs/.vitepress/dist/`. Preview serves that
build locally.

## Site structure

- `/main/`: short introduction, featured project cards, and a link to guides.
- `/guides/`: automatically generated list of imported documentation projects.
- `/tcp-proxy-from-scratch/`: upstream `docs/index.md`, with guides below
  `/tcp-proxy-from-scratch/guide/`.
- `/`: static HTML meta-refresh redirect to `/main/`, with a fallback link
  that also works without JavaScript.

The site uses `base: '/'` for `https://VladimirNilov28.github.io`, clean URLs,
and VitePress local search. The root redirect is excluded from search results.
The standard theme supplies typography, navigation,
and light/dark mode. `docs/.vitepress/theme/style.css` adds only a responsive
project-card layout using the theme's color variables.

## Documentation aggregation

`docs.sources.json` lists public source repositories, branches, documentation
paths (without leading or trailing slashes), titles, and unique URL slugs.
Add another entry to import another project; no submodules or source-repository
changes are needed. Every source must contain `index.md`.

```sh
npm run docs:sync
npm test
```

Development and production builds automatically synchronize first. A failed
download, missing landing page, or unresolved local link/image stops the
command. Each branch is resolved to a commit before downloading, so all files
in one project come from the same revision. Synchronization requires network
access to GitHub's public API and raw-content host; unauthenticated API rate
limits apply. Preview uses the existing build and does not synchronize.

The dependency-free Node.js script removes stale generated files on each run.
Markdown is stored under `docs/_generated/<slug>/`; binary assets and other
downloads are copied unchanged to `docs/public/_generated/<slug>/`. Both
directories are ignored by Git. Do not edit them manually.

VitePress rewrites generated Markdown paths to `/<slug>/...`, preserving
`index.md` as the project landing page. Local Markdown, reference, HTML, and
frontmatter links are resolved against the original documentation tree and
rewritten to project-scoped routes; image and download links target the
generated static assets. Fenced and inline code examples are left unchanged.
External URLs are not rewritten or checked. Links outside the selected source
directory are rejected: include the referenced files within that directory.

Source `.vitepress`, `.github` (including workflows), package manifests and
lockfiles, `node_modules`, and common build/cache directories are excluded.
The central configuration and theme remain authoritative. The script also
generates the guides listing, a sidebar entry for every imported page, and a
manifest recording imported revisions and routes.

After building, `npm run docs:check` checks generated pages and assets, sidebar
coverage, and local rendered links, anchors, and images. `npm test` uses local
fixtures to cover asset preservation, URL rewriting, exclusions, multiple
projects, stale-file cleanup, and explicit failures without network access.

`docs/public/.nojekyll` is copied into the build output so GitHub Pages can
serve it without Jekyll processing. Publish the contents of
`docs/.vitepress/dist/`, not the source directory.

## GitHub Pages deployment

`.github/workflows/pages.yml` installs dependencies with `npm ci` on Node.js 24,
runs synchronization tests, builds the complete site with `npm run docs:build`,
and checks generated links, assets, and navigation with `npm run docs:check`.
Synchronization or validation failures stop deployment.

Pull requests targeting `main` only build and validate. Pushes to `main`
deploy automatically. Manual runs are available through **Actions > Build and
deploy documentation > Run workflow**; select `main` to deploy. Manual runs
on other branches validate without uploading or deploying a Pages artifact.

Deployments use the `github-pages` environment and a shared concurrency group,
so only one deployment runs at a time without cancelling an active deployment.
The workflow defaults to `contents: read`; only the deployment job has
`pages: write` and `id-token: write`. Source documentation is fetched publicly,
without a personal access token or repository secrets.

Required repository settings:

- **Settings > Pages > Build and deployment > Source:** select **GitHub Actions**.
- **Settings > Actions > General:** enable Actions and allow the GitHub-owned
  actions used by the workflow. The default workflow token can remain read-only;
  deployment permissions are declared explicitly in the deployment job.
- **Settings > Environments > github-pages:** restrict deployment branches to
  `main`. Configure required reviewers only if deployments should wait for
  manual approval.

The published site will be available at `https://VladimirNilov28.github.io/`.
