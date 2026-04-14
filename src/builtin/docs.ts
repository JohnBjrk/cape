import { join, resolve } from "node:path";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import type { CommandDef, SubcommandDef } from "../cli.ts";
import type { Runtime } from "../runtime/types.ts";
import type { ParsedArgs } from "../parser/types.ts";
import { discoverPlugins } from "../loader/discover.ts";
import { FRAMEWORK_DOCS } from "../embedded-docs.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocsConfig {
  /**
   * Custom doc pages to include in `docs serve`.
   * Use `file` (relative to CWD) for source/dev mode.
   * Use `content` (inline markdown) for pages that must work from a compiled binary.
   */
  pages?: Array<
    | { title: string; file: string; content?: never }
    | { title: string; content: string; file?: never }
  >;
}

interface NavPage {
  title: string;
  path: string;
}

interface NavSection {
  title: string;
  pages: NavPage[];
}

interface Nav {
  cliName: string;
  sections: NavSection[];
}

// Each entry in the doc map holds either a path to read from disk, or
// inline content already in memory (used when running from a compiled binary).
type DocEntry = { kind: "file"; path: string } | { kind: "inline"; content: string };
type DocMap = Record<string, DocEntry>;

// ---------------------------------------------------------------------------
// Framework docs directory — only valid when running from source.
// The binary case uses embedded strings from embedded-docs.ts instead.
// ---------------------------------------------------------------------------

const FRAMEWORK_DOCS_DIR = join(import.meta.dir, "../../docs");

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function createDocsCommand(
  cliName: string,
  codePluginDirs: string[],
  docsConfig: DocsConfig | undefined,
): CommandDef {
  return {
    name: "docs",
    description: "Browse documentation",
    subcommands: [serveSubcommand(cliName, codePluginDirs, docsConfig)],
  };
}

// ---------------------------------------------------------------------------
// docs serve
// ---------------------------------------------------------------------------

function serveSubcommand(
  cliName: string,
  codePluginDirs: string[],
  docsConfig: DocsConfig | undefined,
): SubcommandDef {
  return {
    name: "serve",
    description: "Start a local docs server",
    schema: {
      flags: {
        port: { type: "number", default: 4000, description: "Port to listen on" },
        open: { type: "boolean", default: false, description: "Open in browser after starting" },
      },
    },
    async run(args: ParsedArgs, runtime: Runtime): Promise<void> {
      const port = (args.flags["port"] as number) ?? 4000;
      const open = (args.flags["open"] as boolean) ?? false;

      const { nav, docMap } = await buildNavAndMap(cliName, codePluginDirs, docsConfig);

      const html = buildHtml(cliName);

      const server = Bun.serve({
        port,
        async fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/") {
            return new Response(html, {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }

          if (url.pathname === "/api/nav") {
            return Response.json(nav);
          }

          if (url.pathname === "/api/doc") {
            const pathKey = url.searchParams.get("path") ?? "";
            const entry = docMap[pathKey];
            if (!entry) {
              return new Response("Not found", { status: 404 });
            }
            try {
              const raw = entry.kind === "file" ? await Bun.file(entry.path).text() : entry.content;
              // Strip golden test markers — they're meaningless in the browser
              const content = raw.replace(/<!--\s*golden:[^>]*-->\n?/g, "");
              return new Response(content, {
                headers: { "content-type": "text/plain; charset=utf-8" },
              });
            } catch {
              return new Response("Could not read file", { status: 500 });
            }
          }

          return new Response("Not found", { status: 404 });
        },
      });

      const url = `http://localhost:${server.port}`;
      runtime.output.success(`Docs server running at ${url}`);
      runtime.print("Press Ctrl+C to stop.");

      if (open) {
        const opener =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        await Bun.$`${opener} ${url}`.quiet().nothrow();
      }

      // Wait until the process is cancelled (SIGINT / SIGTERM)
      await new Promise<void>((resolve) => {
        runtime.signal.addEventListener("abort", () => {
          server.stop(true);
          resolve();
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Nav + doc map construction
// ---------------------------------------------------------------------------

async function buildNavAndMap(
  cliName: string,
  codePluginDirs: string[],
  docsConfig: DocsConfig | undefined,
): Promise<{ nav: Nav; docMap: DocMap }> {
  const docMap: DocMap = {};
  const sections: NavSection[] = [];

  // Framework docs: guide/ and api/ subdirectories
  const frameworkSections = await buildFrameworkSections(docMap);
  sections.push(...frameworkSections);

  // CLI custom pages declared in CliConfig.docs.pages
  if (docsConfig?.pages && docsConfig.pages.length > 0) {
    const pages: NavPage[] = [];
    for (let i = 0; i < docsConfig.pages.length; i++) {
      const entry = docsConfig.pages[i]!;
      const pathKey = `_cli/${i}`;
      docMap[pathKey] =
        entry.content !== undefined
          ? { kind: "inline", content: entry.content }
          : { kind: "file", path: resolve(process.cwd(), entry.file!) };
      pages.push({ title: entry.title, path: pathKey });
    }
    sections.push({ title: cliName, pages });
  }

  // Plugin docs: any plugin with a `docs` field in its manifest
  const pluginDirs = [
    join(process.cwd(), "commands"),
    join(homedir(), ".config", cliName, "plugins"),
    ...codePluginDirs,
  ];
  const discovered = await discoverPlugins(pluginDirs);
  const pluginPages: NavPage[] = [];
  for (const plugin of discovered) {
    if (!plugin.manifest.docs) continue;
    const pathKey = `_plugin/${plugin.manifest.name}`;
    docMap[pathKey] = { kind: "file", path: resolve(plugin.pluginDir, plugin.manifest.docs) };
    pluginPages.push({ title: plugin.manifest.name, path: pathKey });
  }
  if (pluginPages.length > 0) {
    sections.push({ title: "Plugins", pages: pluginPages });
  }

  return { nav: { cliName, sections }, docMap };
}

async function buildFrameworkSections(docMap: DocMap): Promise<NavSection[]> {
  const sections: NavSection[] = [];

  // Prefer reading from disk (dev / source-dependency mode). Fall back to the
  // strings baked into the binary by prebuild when the docs directory is absent.
  const useDisk = await Bun.file(join(FRAMEWORK_DOCS_DIR, "api/output.md")).exists();

  // Only api/ is embedded universally — guide docs are Cape-specific and
  // declared by the cape CLI itself via CliConfig.docs.pages.
  for (const { prefix, label } of [{ prefix: "api", label: "API Reference" }] as const) {
    const pages = useDisk
      ? await scanMarkdownDir(join(FRAMEWORK_DOCS_DIR, prefix), prefix, docMap)
      : loadEmbeddedSection(prefix, docMap);

    if (pages.length > 0) {
      sections.push({ title: label, pages });
    }
  }

  return sections;
}

/** Scan a directory for *.md files and register them in the doc map. */
async function scanMarkdownDir(dir: string, prefix: string, docMap: DocMap): Promise<NavPage[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const pages: NavPage[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    const stem = entry.slice(0, -3);
    const pathKey = `${prefix}/${stem}`;
    docMap[pathKey] = { kind: "file", path: join(dir, entry) };
    pages.push({ title: titleFromStem(stem), path: pathKey });
  }
  return pages;
}

/** Load framework docs from the embedded strings baked in at build time. */
function loadEmbeddedSection(prefix: string, docMap: DocMap): NavPage[] {
  const pages: NavPage[] = [];
  for (const [key, content] of Object.entries(FRAMEWORK_DOCS)) {
    if (!key.startsWith(`${prefix}/`)) continue;
    const stem = key.slice(prefix.length + 1);
    docMap[key] = { kind: "inline", content };
    pages.push({ title: titleFromStem(stem), path: key });
  }
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

/** Convert a filename stem like "output" or "commands" to a sidebar label. */
function titleFromStem(stem: string): string {
  return stem.charAt(0).toUpperCase() + stem.slice(1).replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// HTML shell
// ---------------------------------------------------------------------------

function buildHtml(cliName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${cliName} docs</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css">
  <style>
    /* ── Tokyo Night Dark palette ────────────────────────────────────────── */
    :root {
      --bg:          #1a1b26;
      --bg-dark:     #16161e;
      --bg-elevated: #1f2335;
      --border:      #292e42;
      --border-dim:  #1e2030;
      --text:        #c0caf5;
      --text-muted:  #787c99;
      --text-faint:  #3b4261;
      --blue:        #7aa2f7;
      --blue-dim:    #3d59a1;
      --red:         #f7768e;
      --mono:        "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      display: flex;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 15px; line-height: 1.6;
      color: var(--text); background: var(--bg);
    }

    /* ── Sidebar ─────────────────────────────────────────────────────────── */
    #sidebar {
      width: 256px; flex-shrink: 0;
      border-right: 1px solid var(--border);
      display: flex; flex-direction: column;
      overflow-y: auto;
      background: var(--bg-dark);
    }
    #sidebar-header {
      padding: 1.25rem 1rem 0.9rem;
      border-bottom: 1px solid var(--border);
    }
    #sidebar-title { font-size: 0.9rem; font-weight: 700; color: var(--text); }

    .nav-section { padding: 0.9rem 0 0.25rem; }
    .nav-section-title {
      font-size: 0.68rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--text-faint); padding: 0 1rem 0.35rem;
    }
    .nav-link {
      display: block;
      padding: 0.3rem 1rem 0.3rem 1.25rem;
      font-size: 0.875rem; color: var(--text-muted); text-decoration: none;
      border-left: 3px solid transparent;
      margin-right: 0.5rem; border-radius: 0 4px 4px 0;
    }
    .nav-link:hover { background: var(--bg-elevated); color: var(--text); }
    .nav-link.active {
      background: var(--bg-elevated); color: var(--blue);
      border-left-color: var(--blue); font-weight: 500;
    }

    /* ── Content ─────────────────────────────────────────────────────────── */
    #content { flex: 1; overflow-y: auto; padding: 2.5rem 3rem 5rem; }
    .prose { max-width: 720px; margin: 0 auto; }

    .prose h1 { font-size: 1.875rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text); }
    .prose h2 {
      font-size: 1.2rem; font-weight: 600;
      margin: 2.5rem 0 0.75rem; padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border); color: var(--text);
    }
    .prose h3 { font-size: 1.05rem; font-weight: 600; margin: 1.75rem 0 0.5rem; color: var(--text); }
    .prose h4 { font-size: 0.95rem; font-weight: 600; margin: 1.25rem 0 0.4rem; color: var(--text-muted); }
    .prose p { margin-bottom: 1rem; color: #a9b1d6; }
    .prose a { color: var(--blue); text-decoration: underline; text-decoration-color: var(--blue-dim); }
    .prose a:hover { text-decoration-color: var(--blue); }
    .prose code {
      background: var(--bg-elevated); color: var(--text);
      padding: 0.15em 0.4em; border-radius: 4px;
      font-family: var(--mono); font-size: 0.84em;
      border: 1px solid var(--border);
    }
    /* hljs handles pre background via .hljs class — we just set shape */
    .prose pre {
      border-radius: 8px; overflow-x: auto;
      margin: 1rem 0; border: 1px solid var(--border);
    }
    .prose pre code {
      background: none; border: none;
      display: block; padding: 1rem 1.25rem;
      font-size: 0.84em; white-space: pre; line-height: 1.65;
    }
    .prose table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.875rem; }
    .prose th {
      background: var(--bg-elevated); font-weight: 600;
      padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left;
      color: var(--text);
    }
    .prose td { padding: 0.45rem 0.75rem; border: 1px solid var(--border); vertical-align: top; color: #a9b1d6; }
    .prose tr:nth-child(even) td { background: var(--border-dim); }
    .prose ul, .prose ol { margin: 0.5rem 0 1rem 1.5rem; }
    .prose li { margin: 0.25rem 0; color: #a9b1d6; }
    .prose li code { font-size: 0.82em; }
    .prose hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
    .prose blockquote {
      border-left: 3px solid var(--blue-dim); padding: 0.5rem 1rem;
      margin: 1rem 0; color: var(--text-muted); background: var(--bg-elevated);
      border-radius: 0 4px 4px 0;
    }
    .prose blockquote p { margin-bottom: 0; }

    #loading { color: var(--text-muted); font-size: 0.875rem; padding: 3rem 0; }
    #doc-error { color: var(--red); padding: 1rem 0; }
  </style>
</head>
<body>
  <nav id="sidebar">
    <div id="sidebar-header">
      <div id="sidebar-title">docs</div>
    </div>
    <div id="nav-sections"></div>
  </nav>
  <main id="content">
    <div class="prose">
      <p id="loading">Loading…</p>
      <p id="doc-error" style="display:none"></p>
      <div id="doc-body" style="display:none"></div>
    </div>
  </main>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.0/marked.min.js"></script>
  <script>
    // Configure marked to use highlight.js for code blocks
    marked.use({
      renderer: {
        code(code, lang) {
          const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
          const highlighted = hljs.highlight(code, { language }).value;
          return '<pre><code class="hljs language-' + language + '">' + highlighted + '</code></pre>';
        },
      },
    });

    let nav = null;
    let activePath = null;

    async function loadNav() {
      const res = await fetch('/api/nav');
      nav = await res.json();

      document.getElementById('sidebar-title').textContent = nav.cliName + ' docs';
      document.title = nav.cliName + ' docs';

      const container = document.getElementById('nav-sections');
      container.innerHTML = '';

      for (const section of nav.sections) {
        const el = document.createElement('div');
        el.className = 'nav-section';

        const heading = document.createElement('div');
        heading.className = 'nav-section-title';
        heading.textContent = section.title;
        el.appendChild(heading);

        for (const page of section.pages) {
          const a = document.createElement('a');
          a.className = 'nav-link';
          a.href = '#' + encodeURIComponent(page.path);
          a.textContent = page.title;
          a.dataset.path = page.path;
          a.addEventListener('click', (e) => {
            e.preventDefault();
            navigate(page.path);
          });
          el.appendChild(a);
        }

        container.appendChild(el);
      }
    }

    function setActive(path) {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      const link = document.querySelector('.nav-link[data-path="' + CSS.escape(path) + '"]');
      if (link) link.classList.add('active');
    }

    async function loadPage(path) {
      const body = document.getElementById('doc-body');
      const loading = document.getElementById('loading');
      const errEl = document.getElementById('doc-error');

      body.style.display = 'none';
      errEl.style.display = 'none';
      loading.style.display = '';

      try {
        const res = await fetch('/api/doc?path=' + encodeURIComponent(path));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const md = await res.text();
        body.innerHTML = marked.parse(md);
        loading.style.display = 'none';
        body.style.display = '';
        document.getElementById('content').scrollTop = 0;
      } catch (e) {
        loading.style.display = 'none';
        errEl.textContent = 'Failed to load page: ' + e.message;
        errEl.style.display = '';
      }
    }

    function navigate(path) {
      if (path === activePath) return;
      activePath = path;
      history.pushState(null, '', '#' + encodeURIComponent(path));
      setActive(path);
      loadPage(path);
    }

    function pathFromHash() {
      const hash = location.hash.slice(1);
      return hash ? decodeURIComponent(hash) : null;
    }

    window.addEventListener('popstate', () => {
      const path = pathFromHash();
      if (path) { activePath = null; navigate(path); }
    });

    async function init() {
      await loadNav();
      const path = pathFromHash();
      if (path) {
        navigate(path);
      } else if (nav.sections.length > 0 && nav.sections[0].pages.length > 0) {
        navigate(nav.sections[0].pages[0].path);
      } else {
        document.getElementById('loading').style.display = 'none';
      }
    }

    init().catch(err => {
      document.getElementById('loading').textContent = 'Error: ' + err.message;
    });
  </script>
</body>
</html>`;
}
