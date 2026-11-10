# CLAUDE.md — Ig Optimizer

Working guide for AI coding sessions. Read this before changing code.

## Project

Chrome MV3 extension for instagram.com (desktop web). Goal: follow friends' events without the feed being flooded by recommendations, ads and public pages.
Owner works in Russian; **all UI text, code comments and docs are in English**.

## Rules

- Vanilla JS, no build step, no dependencies. Extension code lives only in `extension/` (loaded via **Load unpacked**); docs stay in the project root and never go into `extension/`.
- `extension/manifest.json` has a `key` that pins the extension ID to `ckfohpnjgmkddabiaaheleebdjjbmohn` regardless of folder path. Never remove or change it: storage (hidden posts, groups, settings) is bound to the ID.
- Every change: bump `version` in `extension/manifest.json` (semver) and add an entry to `CHANGELOG.md`.
- Settings toggles live in `chrome.storage.sync`; user data (lists) lives in `chrome.storage.local`.
- Never mutate Instagram's text nodes. Mark elements with `data-igo-*` attributes and style via `content.css`; inject only own elements (`.igo-bar`, `.igo-group`).
- Every new option: add to `opts` in `content.js`, to `defaults` in `popup.js`, and a toggle in `popup.html`.
- After editing, run `node --check extension/content.js extension/background.js extension/popup.js`.

## Architecture

`content.js` (document_start, all instagram.com pages):
- `MutationObserver` → `run()` once per animation frame. `run()` is idempotent: redirect, scan suggested, process articles, follow list, `<time>` elements, videos.
- `setInterval(autoLoad, 800)` keeps the infinite feed loading.
- `apply()` syncs `<html>` classes with options: `igo-on`, `igo-dates`, `igo-show-hidden`, `igo-hide-publics`.

`background.js`: rebuilds dynamic `declarativeNetRequest` block rules (one per image file name) from `hiddenMedia`, skipping posts in `unblocked` (`storage.session`, posts the user expanded). Rebuilds are serialized in a promise queue.

### Storage keys

| Area | Key | Shape |
|---|---|---|
| sync | `onlyFollowing`, `dates`, `noLoop`, `showHidden`, `hidePublics` | boolean |
| local | `hidden` | `string[]` post shortcodes |
| local | `hiddenMedia` | `{ [shortcode]: string[] }` image file names |
| local | `userGroups` | `{ [username]: 'publics' \| 'friends' }` |
| session | `unblocked` | `string[]` shortcodes expanded this session |

### DOM attributes

| Attribute | Meaning |
|---|---|
| `data-igo-hidden` | Suggested / sponsored block (hidden when `igo-on`) |
| `data-igo-user-hidden` | Post hidden by the user (collapsed, or removed when `showHidden` is off) |
| `data-igo-expanded` | Hidden post expanded in this tab |
| `data-igo-public` | Post by a Publics author, home feed only |
| `data-igo-feed` | Feed list container (its padding-bottom is forced to 0) |
| `data-igo-date` | Formatted date shown via `::after` on `<time>` |

## Instagram facts (verified on the live site, Nov 2026)

- **Feed** = `<article>` elements; the post shortcode is found in any `a[href]` matching `/(p|reel|tv)/<code>`. The author is the first `/<username>/` link with text.
- **Following feed**: `https://www.instagram.com/?variant=following`.
- **Post date from shortcode**: decode base64url (`A-Za-z0-9-_`) of the first 11 chars to a BigInt media ID; `(id >> 23) + 1314220021721` = ms timestamp.
- **Virtualized feed**: the list container sets inline `padding-bottom` (~375–600 px per post it considers unrendered). Posts with 0 px height (hidden) leave huge blank gaps → overridden by CSS `!important`.
- **Loading more** is triggered by `scroll` events on `window`; a synthetic `window.dispatchEvent(new Event('scroll'))` works. `AUTO_LIMIT` (60) stops auto-loading if no visible post appears, until the user scrolls again (prevents endless suggested-post fetching at the end of the Following feed).
- **Images**: one file name per image across all `srcset` sizes, e.g. `895342664_17914902900481429_686271838211386224_n.jpg`; the signed query string varies. Post media path contains `t51.<n>-15`, profile pictures `t51.<n>-19` and `alt="<user>'s profile picture"`.
- **Media info API** (JSON only, no image download): `GET /api/v1/media/<mediaId>/info/` with header `x-ig-app-id: 936619743392459`, same-origin with cookies. `items[0].carousel_media || [items[0]]` → `image_versions2.candidates[].url`. Used to backfill `hiddenMedia`, 1 request / 1.5 s, stops on 401/403/429.
- **Following / Followers dialog**: `[role=dialog]`, URL `/<user>/following/`. Each row is a flex `div` with 3 children: avatar, names, button box. The group `<select>` is inserted before the button box.
- **Videos**: Instagram restarts videos itself; `play` after `ended` without user input (pointer/key in the last 1 s) is paused.

## Manual test checklist

1. Home → redirects to `?variant=following`; no "Suggested for you" posts.
2. Hide a post → strip with Expand / Unhide; reload → images of that post are blocked (DevTools Network: `net::ERR_BLOCKED_BY_CLIENT`).
3. Toggle "Show hidden posts" off → hidden posts disappear, feed keeps loading without blank space.
4. Profile → Following → set a user to Publics → their posts vanish from the feed with "Hide publics" on.
5. Comments and posts show `09 Nov 2026, 14:32`-style dates; videos stop after one play.
