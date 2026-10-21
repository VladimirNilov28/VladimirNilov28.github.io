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

- `/main/`: short introduction, featured projects, and generated cards linking
  directly to every imported documentation project.
- `/tcp-proxy-from-scratch/`: the upstream Introduction chapter in the standard
  documentation layout, with guides below `/tcp-proxy-from-scratch/guide/`.
- `/tcp-proxy-from-scratch/guide/introduction`: compatibility redirect to the
  canonical project root, preserving query strings and fragments.
- `/`: static HTML meta-refresh redirect to `/main/`, with a fallback link
  that also works without JavaScript.

The site uses `base: '/'` for `https://VladimirNilov28.github.io`, clean URLs,
and VitePress local search. The root redirect is excluded from search results.
The standard theme supplies typography, navigation,
and light/dark mode. `docs/.vitepress/theme/style.css` adds only a responsive
project-card layout using the theme's color variables.

## Documentation aggregation

`docs.sources.json` lists public source repositories, branches, documentation
paths (without leading or trailing slashes), titles, descriptions, entry chapters,
and unique URL slugs.
Add another entry to import another project; no submodules or source-repository
changes are needed. Each source must specify an existing Markdown `entry`, such
as `"entry": "guide/introduction.md"`, and a short plain-text `description` for
the homepage card. An upstream `index.md` is not required.

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

VitePress rewrites the selected entry chapter directly to `/<slug>/index.html`
and other chapters to `/<slug>/...`. The entry content is imported once; an
upstream root `index.md` is not imported unless explicitly selected as the entry.
Imported chapters always use the standard documentation layout and sidebar,
regardless of upstream layout settings. The entry's original URL becomes a
static redirect with a canonical link, `noindex`, and `search: false`; it is not
listed in the sidebar or duplicated in search.

Local Markdown, reference, HTML, and
frontmatter links are resolved against the original documentation tree and
rewritten to project-scoped routes; image and download links target the
generated static assets. Fenced and inline code examples are left unchanged.
External URLs are not rewritten or checked. Links outside the selected source
directory are rejected: include the referenced files within that directory.

Source `.vitepress`, `.github` (including workflows), package manifests and
lockfiles, `node_modules`, and common build/cache directories are excluded.
The central configuration and theme remain authoritative. The script also
generates the homepage guide cards from the source list, a sidebar entry for
every canonical imported page, and a manifest
recording imported revisions, routes, and compatibility redirects. Links to
the entry chapter or upstream `index.md` point directly to the project root.

### Organizing upstream documentation

Keep content and an optional `docs.navigation.json` inside the documentation
root specified by `path` in `docs.sources.json`. For example:

```text
docs/
├── docs.navigation.json          # optional
├── guide/
│   ├── introduction.md           # configured entry chapter
│   ├── fundamentals/
│   │   ├── tcp-ip.md
│   │   └── client-server.md
│   └── java-nio/
│       ├── index.md              # section overview
│       ├── buffers.md
│       └── examples/
│           ├── blocking-server.md
│           └── non-blocking-server.md
└── images/
    └── diagram.png
```

Without a navigation file, every imported Markdown page appears once in a
directory-based, expandable sidebar. The configured entry appears first at
the project root. Within each directory, pages come before subdirectories;
both are sorted by their case-sensitive source paths, independently of locale
or GitHub tree ordering. Groups are expanded by default. Page titles come from
a `title:` frontmatter field, then an H1 heading, then the filename with hyphens
and underscores replaced by spaces. A directory's title uses the same readable
name fallback unless it contains `index.md`: that page supplies the group's
title and clickable overview link, without a duplicate child entry.

Nested `index.md` pages keep directory URLs such as
`/<slug>/guide/java-nio/`. The documentation-root `index.md` retains its
existing special behavior: it is omitted unless selected as `entry`, and links
to it resolve to `/<slug>/`. The entry chapter always serves at `/<slug>/`,
even if it is a nested `index.md`, with a redirect from its original URL.
For searchable chapters, include a Markdown heading and descriptive content.

### Controlling navigation titles and chapter order

Create `docs.navigation.json` at the documentation root to override the
automatic order, titles, nesting, and expansion state:

```json
{
  "sidebar": [
    { "text": "Introduction", "link": "guide/introduction.md" },
    {
      "text": "Fundamentals",
      "collapsed": false,
      "items": [
        { "text": "TCP/IP", "link": "guide/fundamentals/tcp-ip.md" },
        { "text": "Client-Server", "link": "guide/fundamentals/client-server.md" }
      ]
    },
    {
      "text": "Java NIO",
      "link": "guide/java-nio/index.md",
      "collapsed": false,
      "items": [
        { "text": "Buffers", "link": "guide/java-nio/buffers.md" },
        {
          "text": "Examples",
          "collapsed": true,
          "items": [
            { "text": "Blocking Server", "link": "guide/java-nio/examples/blocking-server.md" },
            { "text": "Non-blocking Server", "link": "guide/java-nio/examples/non-blocking-server.md" }
          ]
        }
      ]
    }
  ]
}
```

The top-level object supports only `sidebar`, an array. Each sidebar item supports:

| Property | Meaning |
| --- | --- |
| `text` | Required, nonblank display title. |
| `link` | Existing imported `.md` file, relative to the documentation root (not the JSON item's parent). |
| `items` | Array of nested items; can be combined with `link` for a clickable section overview. |
| `collapsed` | Optional boolean on an item with `items`: `true` starts collapsed, `false` expanded. Omit it for VitePress's non-collapsible group behavior. |

Every item must have `link`, `items`, or both. Explicit array order and titles
are preserved, including the entry's position; put the entry first as shown
above. Unknown properties, wrong value types, invalid JSON, missing or excluded
pages, duplicate references (including group overview links), and conflicting
output routes stop synchronization with an error. Links must use literal
root-relative file paths without a leading slash, `.`/`..` segments, backslashes,
URL encoding, URL schemes, query strings, or fragments. The navigation file is
configuration only and is not published as a downloadable asset.

**Unlisted pages are never silently omitted.** Each configured group is
associated with the deepest common directory of all pages linked by that group
and its descendants. Unlisted pages are appended to the deepest matching
group, retaining their relative directory hierarchy and automatic ordering.
For equal directory scopes, the first group in depth-first traversal wins
(children before parents). Groups without any page references have no inferred
directory scope. Pages with no matching group are appended to the sidebar
using the automatic hierarchy. An empty `sidebar` array generates the complete
automatic navigation. To control the exact placement of a page or disambiguate
groups sharing a directory, reference it explicitly.

Link between chapters using ordinary Markdown paths relative to the current
page, for example `[Buffers](buffers.md)` from `guide/java-nio/index.md`,
`[Overview](index.md)` from `buffers.md`, or
`[Introduction](../introduction.md)` from that directory. Anchors and queries
are supported in chapter content, for example `[Details](buffers.md#details)`.
Keep relative image/download paths inside the documentation root. Chapter
links are rewritten to their existing canonical project URLs; sidebar labels
and ordering do not change routes.

Existing repositories need no navigation file or central VitePress changes.
Their pages, entry redirects, assets, search, and homepage cards continue to
use the same publishing pipeline and URLs; only the formerly flat sidebar
becomes hierarchical. Upstream repositories own content and optional navigation
metadata, not a theme, VitePress configuration, or separate deployment.

After building, `npm run docs:check` checks generated pages and assets, sidebar
coverage, canonical URLs, redirects, duplicate clean paths, and local rendered
links, anchors, images, scripts, and stylesheets. `npm test` uses local
fixtures to cover asset preservation, URL rewriting, exclusions, multiple
projects, stale-file cleanup, nested automatic/configured sidebars, unlisted
pages, navigation validation, and real VitePress builds without network access.

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
Accepted `repository_dispatch` events also synchronize, build, validate, and
deploy the complete website from `main`.

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

## Avoiding conflicts with standalone project Pages sites

The central user site owns documentation URLs such as
`https://vladimirnilov28.github.io/tcp-proxy-from-scratch/`. A separate Pages
deployment in `VladimirNilov28/tcp-proxy-from-scratch` claims that same URL prefix
and can override central HTML on direct requests. VitePress client navigation
can still load the central site's JavaScript page chunks, so refresh/back/forward
may appear inconsistent even when the central build and CSS are correct.

Investigation found the central site configured with `build_type: workflow`,
but the source repository still configured with `build_type: legacy`, publishing
`main` from `/`. Its README contains the reported "Documentation publishing"
section. Direct requests to the project root and chapter URLs returned GitHub's
"Site not found" HTML, while `/main/` served the central VitePress layout.
This is a conflicting server-side deployment, not a theme problem.

**Manual correction in the source repository, not the central repository:**
open **VladimirNilov28/tcp-proxy-from-scratch > Settings > Pages > Build and
deployment**, select **Deploy from a branch**, choose **None** in the branch
dropdown, and click **Save**. This disables only that repository's standalone
Pages site; it does not delete the repository, Markdown, or notification workflow.
Repeat for any future source repository with a Pages deployment at an imported
project's URL prefix. Merely unpublishing the current deployment is temporary if
branch publishing remains enabled.

Keep the central repository's Pages source set to **GitHub Actions**. After
disabling the source site, allow GitHub's routing/cache changes to propagate,
then rerun the central deployment workflow on `main` and verify a direct reload
of the project root and chapters. Do not change `base`, turn off clean URLs, add
SPA 404 fallbacks, or copy standalone-site assets to conceal the conflict.
See GitHub's [instructions for disabling a Pages site without deleting its repository](https://docs.github.com/en/pages/getting-started-with-github-pages/deleting-a-github-pages-site#deleting-your-site-by-changing-the-source).

## Rebuilding when source documentation changes

The same deployment workflow accepts only the `documentation-updated`
`repository_dispatch` event type. Before installing dependencies or building,
`scripts/validate-dispatch.mjs` checks that `client_payload.repository` exactly
matches a repository in `docs.sources.json`. Unsupported or missing repositories
fail the build job, preventing artifact upload and deployment. The dispatch
payload cannot choose a checkout ref, source URL, or build command; synchronization
continues to use the configured branches and paths.

A source repository can send the following request after a push to its
documentation branch (for the current source, `main`, filtered to `docs/**`):

```sh
gh api --method POST \
  repos/VladimirNilov28/VladimirNilov28.github.io/dispatches \
  --input - <<'JSON'
{
  "event_type": "documentation-updated",
  "client_payload": {
    "repository": "VladimirNilov28/tcp-proxy-from-scratch"
  }
}
JSON
```

In the source workflow, set `GH_TOKEN` from a secret such as
`${{ secrets.DOCS_DISPATCH_TOKEN }}`. Use a GitHub App installation token or a
fine-grained personal access token scoped to the **central** repository with
**Contents: write**, as required by GitHub's repository-dispatch API. The source
repository's default `GITHUB_TOKEN` cannot dispatch to a different repository.
Store credentials in Actions secrets and never print them. Documentation
downloads themselves remain public and unauthenticated.

GitHub authenticates the API request; the payload allowlist is an additional
restriction, not proof of the sender's repository identity. Limit access to the
dispatch credential accordingly. GitHub must find the receiving workflow on
the central repository's default branch (`main`). A successful API request
returns HTTP 204; monitor the central Actions run for build/deployment results.
