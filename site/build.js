/**
 * Builds the public website: landing page, blog and legal pages.
 *
 * The Angular app is served from app.html under /dashboard (see firebase.json). These
 * pages are plain static HTML on purpose: they load without the app bundle and without
 * the location prompt the app raises on start-up, and crawlers get the whole content on
 * the first request.
 *
 * Runs after `ng build` (see `npm run build`) and writes into the same output folder.
 *
 * - site/pages      one HTML file per page, with a front matter block (see parsePage)
 * - site/partials   shared pieces, included with {{> name}}
 * - site/templates  frames for articles and legal pages; the page body lands in {{content}}
 * - site/media      images copied as they are to /media
 *
 * Pages can also print {{variable}} (see VARS) and {{icon name "classes"}}.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const postcss = require('postcss');
const tailwindcss = require('@tailwindcss/postcss');
const { version } = require('../package.json');

const SITE_DIR = __dirname;
const OUT_DIR = path.join(SITE_DIR, '..', 'dist', 'trackingfy', 'browser');
const SITE_URL = 'https://trackingfy.web.app';
const OG_IMAGE = '/media/og-image.png';

/** Paths served by the Angular app. Keep in sync with app.routes.ts and firebase.json. */
const APP_ROUTES = ['/dashboard', '/history', '/settings', '/activity/'];

/** Values any page or partial can print with {{name}}. */
const VARS = {
  siteUrl: SITE_URL,
  appPath: '/dashboard',
  repoUrl: 'https://github.com/David-TheBridgeDev/Trackingfy',
  releasesUrl: 'https://github.com/David-TheBridgeDev/Trackingfy/releases/latest',
  creatorUrl: 'https://dramos.dev',
  // Owner details for the legal pages. The ID number is published partially masked.
  ownerName: 'David Ramos',
  ownerNif: '**0401**T',
  contactUrl: 'https://dramos.dev',
  version,
  year: String(new Date().getFullYear()),
};

/**
 * Runs before anything paints, on the landing page only.
 *
 * The Android app loads the live site root (capacitor.config.ts `server.url`), and PWAs
 * installed before the landing existed still open "/". Neither should land on a
 * marketing page, so both go straight to the app. When Capacitor serves the bundled
 * assets instead (a local debug build), every unknown path falls back to index.html, the
 * landing itself, so there it has to jump to app.html or it would loop.
 */
const APP_REDIRECT = `(function(){var w=window,c=w.Capacitor,n=!!(w.androidBridge||(c&&c.isNativePlatform&&c.isNativePlatform())),s=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;if(n||s)location.replace(n&&location.hostname==='localhost'?'/app.html':'/dashboard')})();`;

/**
 * Also runs before paint, on every page: follows the theme chosen in the app (same
 * storage key) or the system one, and tags the platform so the pages can show the
 * download option that fits without a layout jump.
 */
const HEAD_SCRIPT = `(function(){var d=document.documentElement,u=navigator.userAgent,t;try{t=localStorage.getItem('trackingfy_theme')}catch(e){}if(t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches)d.classList.add('dark');if(/Android/i.test(u))d.classList.add('is-android');else if(/iPhone|iPad|iPod/i.test(u)||(/Macintosh/.test(u)&&navigator.maxTouchPoints>1))d.classList.add('is-ios')})();`;

/** Outline icons (24px grid), printed with {{icon name "classes"}}. */
const ICONS = {
  'arrow-right': 'M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3',
  'arrow-up-right': 'm4.5 19.5 15-15m0 0H8.25m11.25 0v11.25',
  archive:
    'm20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
  chart:
    'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  check: 'm4.5 12.75 6 6 9-13.5',
  chevron: 'm19.5 8.25-7.5 7.5-7.5-7.5',
  clock: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  cloud:
    'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
  code: 'M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5',
  'credit-card':
    'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z',
  download:
    'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3',
  globe:
    'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418',
  list: 'M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  lock: 'M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z',
  map: 'M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z',
  menu: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5',
  moon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  'no-symbol': 'M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636',
  offline:
    'm3 3 8.735 8.735m0 0a.374.374 0 1 1 .53.53m-.53-.53.53.53m0 0L21 21M14.652 9.348a3.75 3.75 0 0 1 0 5.304m2.121-7.425a6.75 6.75 0 0 1 0 9.546m2.121-11.667c3.808 3.807 3.808 9.98 0 13.788m-9.546-4.242a3.733 3.733 0 0 1-1.06-2.122m-1.061 4.243a6.75 6.75 0 0 1-1.625-6.929m-.496 9.05c-3.068-3.067-3.664-7.67-1.79-11.334M12 12h.008v.008H12V12Z',
  pencil:
    'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125',
  phone:
    'M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
  photo:
    'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z',
  play: 'M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  swap: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5',
  'user-minus':
    'M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z',
  x: 'M6 18 18 6M6 6l12 12',
};

const PARTIALS = new Map();
const TEMPLATES = new Map();

const read = (file) => fs.readFileSync(file, 'utf8');
const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (html) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const canonical = (pagePath) => SITE_URL + pagePath;
const formatDate = (iso) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );

function icon(name, className = 'h-5 w-5') {
  const d = ICONS[name];
  if (!d) throw new Error(`Unknown icon "${name}"`);
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

function render(html, vars) {
  return html
    .replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) => {
      if (!PARTIALS.has(name)) throw new Error(`Unknown partial "${name}"`);
      return render(PARTIALS.get(name), vars);
    })
    .replace(/\{\{icon ([\w-]+)(?: "([^"]*)")?\s*\}\}/g, (_, name, className) => icon(name, className))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => {
      if (vars[key] === undefined) throw new Error(`Unknown variable "{{${key}}}"`);
      return vars[key];
    });
}

/**
 * A page file starts with a block of `key: value` lines between `---` fences:
 * path, title (for <title>), description and updated are required; heading, template
 * (article | page), date, category, cover, short and noindex are optional.
 */
function parsePage(file) {
  const match = read(file).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: missing front matter`);

  const page = { source: path.relative(SITE_DIR, file), body: match[2] };
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) page[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  for (const key of ['path', 'title', 'description', 'updated']) {
    if (!page[key]) throw new Error(`${page.source}: front matter needs "${key}"`);
  }
  page.noindex = page.noindex === 'true';
  page.heading ??= page.title;
  page.updatedHuman = formatDate(page.updated);

  if (page.template === 'article') {
    if (!page.date || !page.category || !page.cover) {
      throw new Error(`${page.source}: articles need "date", "category" and "cover"`);
    }
    const words = stripTags(page.body).split(' ').length;
    page.readingTime = String(Math.max(1, Math.round(words / 200)));
    page.dateHuman = formatDate(page.date);
  }
  return page;
}

function blogCard(post, headingTag) {
  return `
<article class="reveal group relative flex flex-col overflow-hidden rounded-[28px] border border-line bg-surface transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_60px_-30px_rgba(0,0,0,0.35)]">
  <div class="aspect-[16/10] overflow-hidden border-b border-line">${render(`{{> ${post.cover}}}`, VARS)}</div>
  <div class="flex flex-1 flex-col p-6 sm:p-7">
    <p class="eyebrow">${escapeHtml(post.category)}</p>
    <${headingTag} class="mt-3 text-xl font-black leading-snug tracking-tight text-balance">
      <a href="${post.path}" class="after:absolute after:inset-0 group-hover:underline decoration-accent decoration-2 underline-offset-4">${escapeHtml(post.heading)}</a>
    </${headingTag}>
    <p class="mt-3 text-sm leading-relaxed text-muted">${escapeHtml(post.description)}</p>
    <p class="mt-auto flex items-center gap-2 pt-6 text-xs font-semibold text-muted">
      <time datetime="${post.date}">${post.dateHuman}</time><span aria-hidden="true">·</span><span>${post.readingTime} min de lectura</span>
    </p>
  </div>
</article>`;
}

function extractFaq(html) {
  const faq = [];
  const pattern = /<details[^>]*data-faq[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  for (const [, question, answer] of html.matchAll(pattern)) {
    faq.push({ question: stripTags(question), answer: stripTags(answer) });
  }
  return faq;
}

function breadcrumbs(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, itemPath], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: canonical(itemPath),
    })),
  };
}

function structuredData(page, html) {
  const url = canonical(page.path);
  const organization = {
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Trackingfy',
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/icons/web-app-manifest-512x512.png`,
  };
  const website = {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    url: `${SITE_URL}/`,
    name: 'Trackingfy',
    inLanguage: 'es',
    publisher: { '@id': organization['@id'] },
  };
  const graph = [];

  if (page.path === '/') {
    graph.push(organization, website, {
      '@type': 'SoftwareApplication',
      name: 'Trackingfy',
      url: `${SITE_URL}/`,
      description: page.description,
      applicationCategory: 'SportsApplication',
      operatingSystem: 'Android, Web',
      softwareVersion: version,
      downloadUrl: VARS.releasesUrl,
      isAccessibleForFree: true,
      license: 'https://opensource.org/licenses/MIT',
      image: SITE_URL + OG_IMAGE,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      publisher: { '@id': organization['@id'] },
    });
    const faq = extractFaq(html);
    if (faq.length) {
      graph.push({
        '@type': 'FAQPage',
        mainEntity: faq.map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      });
    }
  } else if (page.template === 'article') {
    graph.push(
      {
        '@type': 'BlogPosting',
        headline: page.heading,
        description: page.description,
        datePublished: page.date,
        dateModified: page.updated,
        inLanguage: 'es',
        mainEntityOfPage: url,
        image: SITE_URL + OG_IMAGE,
        author: organization,
        publisher: organization,
      },
      breadcrumbs([
        ['Inicio', '/'],
        ['Blog', '/blog'],
        [page.heading, page.path],
      ]),
    );
  } else if (!page.noindex) {
    graph.push(
      {
        '@type': page.path === '/blog' ? 'CollectionPage' : 'WebPage',
        name: page.heading,
        url,
        inLanguage: 'es',
        isPartOf: { '@id': website['@id'] },
      },
      breadcrumbs([
        ['Inicio', '/'],
        [page.heading, page.path],
      ]),
    );
  }

  if (!graph.length) return '';
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
}

function head(page, html, assets) {
  const url = canonical(page.path);
  const image = SITE_URL + OG_IMAGE;
  const jsonLd = structuredData(page, html);
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    page.path === '/' ? `<script>${APP_REDIRECT}</script>` : '',
    `<script>${HEAD_SCRIPT}</script>`,
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}">`,
    page.noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`,
    '<meta property="og:site_name" content="Trackingfy">',
    '<meta property="og:locale" content="es_ES">',
    `<meta property="og:type" content="${page.template === 'article' ? 'article' : 'website'}">`,
    `<meta property="og:title" content="${escapeHtml(page.heading)}">`,
    `<meta property="og:description" content="${escapeHtml(page.description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Trackingfy: graba tus rutas sin regalar tus datos">',
    page.template === 'article' ? `<meta property="article:published_time" content="${page.date}">` : '',
    page.template === 'article' ? `<meta property="article:modified_time" content="${page.updated}">` : '',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#0d0d0e" media="(prefers-color-scheme: dark)">',
    '<link rel="icon" href="/icons/favicon.ico" sizes="any">',
    '<link rel="icon" type="image/png" sizes="96x96" href="/icons/favicon-96x96.png">',
    '<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<link rel="alternate" type="application/rss+xml" title="Blog de Trackingfy" href="/feed.xml">',
    `<link rel="stylesheet" href="${assets.css}">`,
    `<script src="${assets.js}" defer></script>`,
    jsonLd ? `<script type="application/ld+json">${jsonLd}</script>` : '',
  ];
  return tags.filter(Boolean).join('\n    ');
}

function layout(page, content, vars, assets) {
  const body = `<a href="#contenido" class="skip-link">Saltar al contenido</a>
    ${render('{{> header}}', vars)}
    <main id="contenido">
${content}
    </main>
    ${render('{{> footer}}', vars)}`;

  return `<!doctype html>
<html lang="es">
  <head>
    ${head(page, content, assets)}
  </head>
  <body class="min-h-dvh bg-canvas font-sans text-ink antialiased">
    ${body}
  </body>
</html>
`;
}

/** Fails the build on internal links to pages, anchors or files that do not exist. */
function checkLinks(rendered) {
  const byPath = new Map(rendered.map(({ page, html }) => [page.path, html]));
  const broken = [];

  for (const { page, html } of rendered) {
    for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) {
      const [target, hash] = href.split('#');
      const targetPath = target || page.path;
      const exists =
        byPath.has(targetPath) ||
        APP_ROUTES.some((route) => targetPath === route || targetPath.startsWith(route)) ||
        fs.existsSync(path.join(OUT_DIR, targetPath));
      const anchorOk = !hash || !byPath.has(targetPath) || byPath.get(targetPath).includes(`id="${hash}"`);
      if (!exists || !anchorOk) broken.push(`${page.source}: ${href}`);
    }
  }
  if (broken.length) throw new Error(`Broken internal links:\n  ${broken.join('\n  ')}`);
}

function write(relativePath, content) {
  const file = path.join(OUT_DIR, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function writeHashed(name, extension, content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
  const relativePath = `/site/${name}.${hash}.${extension}`;
  write(relativePath, content);
  return relativePath;
}

async function buildAssets() {
  const from = path.join(SITE_DIR, 'styles.css');
  const { css } = await postcss([tailwindcss({ base: SITE_DIR, optimize: { minify: true } })]).process(read(from), {
    from,
  });
  fs.rmSync(path.join(OUT_DIR, 'site'), { recursive: true, force: true });
  fs.cpSync(path.join(SITE_DIR, 'media'), path.join(OUT_DIR, 'media'), { recursive: true });
  return {
    css: writeHashed('site', 'css', css),
    js: writeHashed('site', 'js', read(path.join(SITE_DIR, 'scripts', 'site.js'))),
  };
}

function sitemap(pages) {
  const urls = pages
    .filter((page) => !page.noindex)
    .map((page) => `  <url><loc>${canonical(page.path)}</loc><lastmod>${page.updated}</lastmod></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

function feed(posts) {
  const items = posts.map(
    (post) => `    <item>
      <title>${escapeHtml(post.heading)}</title>
      <link>${canonical(post.path)}</link>
      <guid>${canonical(post.path)}</guid>
      <pubDate>${new Date(post.date).toUTCString()}</pubDate>
      <description>${escapeHtml(post.description)}</description>
    </item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Blog de Trackingfy</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Guías para grabar, arreglar y compartir tus rutas con Trackingfy.</description>
    <language>es</language>
${items.join('\n')}
  </channel>
</rss>
`;
}

/** Plain-text summary for AI assistants and answer engines (llmstxt.org). */
function llmsTxt(pages, posts) {
  const line = (page) => `- [${page.heading}](${canonical(page.path)}): ${page.description}`;
  const legal = pages.filter((page) => page.template === 'page');
  return `# Trackingfy

> ${pages.find((page) => page.path === '/').description}

Trackingfy is a free, open-source (MIT) GPS activity tracker for walking, running and cycling, available as a web app (${SITE_URL}${VARS.appPath}) and as an Android APK (${VARS.releasesUrl}). There are no accounts: activities are stored only on the user's device (IndexedDB), with backup export and import. The Android app keeps recording with the screen off and shows an interactive notification. Routes can be edited to add a forgotten opening stretch and shared as images (1:1, 3:4, 9:16, transparent background) or as route files. Source code: ${VARS.repoUrl}

## Guías

${posts.map(line).join('\n')}

## Legal

${legal.map(line).join('\n')}
`;
}

async function main() {
  if (!fs.existsSync(path.join(OUT_DIR, 'app.html'))) {
    console.warn('⚠️  No app.html in the output folder: run `ng build` first so /dashboard can be served.');
  }

  for (const file of fs.readdirSync(path.join(SITE_DIR, 'partials'))) {
    PARTIALS.set(path.basename(file, '.html'), read(path.join(SITE_DIR, 'partials', file)));
  }
  for (const file of fs.readdirSync(path.join(SITE_DIR, 'templates'))) {
    TEMPLATES.set(path.basename(file, '.html'), read(path.join(SITE_DIR, 'templates', file)));
  }

  const pages = fs
    .readdirSync(path.join(SITE_DIR, 'pages'), { recursive: true })
    .filter((file) => file.endsWith('.html'))
    .map((file) => parsePage(path.join(SITE_DIR, 'pages', file)))
    .sort((a, b) => a.path.localeCompare(b.path));
  const posts = pages
    .filter((page) => page.template === 'article')
    .sort((a, b) => b.date.localeCompare(a.date) || a.path.localeCompare(b.path));

  PARTIALS.set('blog-cards', posts.slice(0, 3).map((post) => blogCard(post, 'h3')).join(''));
  PARTIALS.set('blog-list', posts.map((post) => blogCard(post, 'h2')).join(''));
  PARTIALS.set(
    'footer-posts',
    posts.map((post) => `<li><a href="${post.path}">${escapeHtml(post.short || post.heading)}</a></li>`).join(''),
  );

  const assets = await buildAssets();
  const rendered = pages.map((page) => {
    const vars = { ...VARS, ...page };
    if (page.template === 'article') {
      vars.cover = render(`{{> ${page.cover}}}`, vars);
      vars.related = posts
        .filter((post) => post !== page)
        .slice(0, 2)
        .map((post) => blogCard(post, 'h3'))
        .join('');
    }

    let content = render(page.body, vars);
    if (page.template) {
      if (!TEMPLATES.has(page.template)) throw new Error(`${page.source}: unknown template "${page.template}"`);
      content = render(TEMPLATES.get(page.template), { ...vars, content });
    }
    return { page, html: layout(page, content, vars, assets) };
  });

  write('sitemap.xml', sitemap(pages));
  write('feed.xml', feed(posts));
  write('llms.txt', llmsTxt(pages, posts));
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  checkLinks(rendered);

  for (const { page, html } of rendered) {
    write(page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`, html);
  }

  console.log(`✅ Site: ${pages.length} pages written to ${path.relative(process.cwd(), OUT_DIR) || '.'}`);
}

main().catch((error) => {
  console.error(`❌ Site build failed: ${error.message}`);
  process.exit(1);
});
