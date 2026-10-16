# Webmotors Plus

An unofficial Chrome extension that extends car search on [webmotors.com.br](https://www.webmotors.com.br). It adds the site's AI search to every page, lets you hide brands and models from a search, and adds a results tree with FIPE values and average asking prices.

The extension's interface is in Portuguese, like the site.

> Not affiliated with, endorsed by, or sponsored by Webmotors S.A. "Webmotors" is a trademark of its owner.

## Features

### AI search in the header

Webmotors only offers its natural-language search ("SUV automático até 100 mil em São Paulo") on the homepage. The extension adds the same search to the site header on every page.

- **Suggestions:** brand and model suggestions appear as you type, and forgiving spellings like `hrv` match HR-V.
- **Recent searches:** shared with the homepage bar.
- **Narrow headers:** when there isn't room, the bar shrinks to an icon button that opens it.
- **Homepage:** the header bar stays hidden while the homepage's own search bar is in view.

### Brand and model blacklist ("Lista negra")

The filter sidebar gets a "Lista negra" section for hiding whole brands, or single models, from the current search. There's no limit on entries.

- **Kept in the URL:** the list is stored as `excluir_marcas` / `excluir_modelos`. It survives reloads, pagination and filter changes, and a shared link carries it. A new search starts with an empty list.
- **Filtered results:** while the list is active, the extension renders the results itself, with exact totals and full pages of 47 cards. When the list is empty, the site's own results are left untouched.

### Results tree ("Explorar resultados")

A panel on the right summarizes the whole search across every result page, not just the current one:

```
Marca
└─ Modelo (n)
   └─ Ano
      └─ Versão: FIPE R$ … | Preço médio R$ …
```

- **Applying filters:** clicking a brand, model or version adds it to the current filters and keeps everything else.
- **Loading:** small searches are loaded in full up front. Larger ones load each model or year when you expand it.
- **Layout:** while the panel is open, the page widens so you keep as many cards per row as the site normally shows. Below 1072px the panel becomes a drawer.

### FIPE values

Each version row shows a FIPE value from one of these sources, in order:

1. **Official FIPE value:** the version is matched in the official FIPE table (veiculos.fipe.org.br). A match only counts if its price is within 2% of what Webmotors' own "% da FIPE" figures imply.
2. **Fallback API:** if the official API is unavailable, the [Parallelum FIPE API](https://deividfortuna.github.io/fipe/) is used instead.
3. **Estimate:** if no confident match is found, the row shows an estimate (`≈`) calculated from the listings' "% da FIPE".

## Installing

The extension isn't on the Chrome Web Store. Build it from source:

```sh
pnpm install
pnpm build
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select `.output/chrome-mv3`.

You need Node 22.12 or later and pnpm 11. Running `corepack enable` installs the pinned pnpm version for you.

## How it treats Webmotors

Webmotors is protected by a bot-detection service (PerimeterX/HUMAN). The extension aims to behave like an attentive human user, never like a scraper:

- **Your own session:** every Webmotors request is a same-origin call from the open tab, using your own session, just like the site's own requests.
- **Paced requests:**
  - At most one request at a time per tab, at least 1.2 s apart (2.5 s for background work).
  - All tabs share one budget of about 30 requests per 10 minutes.
  - Background work waits until the page has loaded and the tab is visible.
- **Reusing data:** the first results come from data the page already loaded. Responses are cached for 10 minutes, so a reload or coming back from an ad costs nothing.
- **Backing off:** if Webmotors blocks a request, every tab pauses for 5 minutes and says so. The extension never reloads the page and never interacts with a captcha. If you see one, solve it yourself.

The extension doesn't spoof fingerprints, hide automation, or bypass bot detection in any way.

## Privacy and permissions

- **No tracking:** no analytics, no telemetry, and no server of its own.
- **Network calls:**
  - `www.webmotors.com.br`, from the page itself, as described above.
  - The FIPE APIs. These only ever receive vehicle brand, model, year and fuel.
- **Stored data:** caches, the panel's open/closed state and the request budget stay in `chrome.storage` on your machine.

| Permission | Why |
|---|---|
| `storage` | Caches (FIPE table, brand/model list, recent search responses) and the panel state |
| `alarms` | Checks twice a day for a new FIPE reference month |
| `veiculos.fipe.org.br`, `fipe.parallelum.com.br` | FIPE lookups from the background service worker |

## Development

| Command | What it does |
|---|---|
| `pnpm build:dev` | Development build in `.output/chrome-mv3-dev` |
| `pnpm build` | Production build in `.output/chrome-mv3` |
| `pnpm zip` | Zips the production build |
| `pnpm typecheck` | TypeScript, strict mode |
| `pnpm test` | Unit tests (Vitest; offline, never call Webmotors) |

**Building and reloading:**
- Load the dev build unpacked in your normal Chrome profile.
- WXT's browser launcher is disabled on purpose: browsers started by automation tools get blocked by the site's bot protection.
- After rebuilding, reload the extension. On a dev build you can also run `window.dispatchEvent(new Event('wmp:dev-reload'))` in the console of any Webmotors page.

**Live testing:** keep it gentle. A handful of page loads at a normal pace is fine. Repeated reloads while the extension crawls large searches can get your session challenged.

**Stack:** [WXT](https://wxt.dev) (Manifest V3), [Preact](https://preactjs.com), TypeScript and [Fuse.js](https://www.fusejs.io). The injected interfaces render in shadow DOM and use the site's own design tokens.

```
src/
  entrypoints/   background worker and content scripts (header search, search page, router bridge)
  features/      header-search, blacklist, tree, fipe, search (data loading), search-page (layout)
  lib/           Webmotors client, request scheduler, rate limits, URL model, selectors
  ui/            shared components and design tokens
tests/           unit tests and fixtures
```

`src/lib/selectors.ts` holds every hook into the site's DOM. When Webmotors changes its markup, start there.

## License

[MIT](LICENSE)
