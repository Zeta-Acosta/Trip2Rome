# Trip2Rome Codebase Review

## Overview

Trip2Rome is a zero-dependency PWA for planning trips to Rome, built with vanilla JS, Leaflet.js, and localStorage. The codebase is well-structured for a single-file app — 2,580 lines of JS inside an IIFE with `'use strict'`, organized into clear sections with ~244 functions.

## What's Working Well

- **Clean architecture for its scale.** IIFE encapsulation, strict mode, clear section headers, and descriptive function names make the monolith navigable.
- **Thoughtful battery management** in live tracking (app.js:1094-1264): adaptive accuracy based on movement, auto-stop when backgrounded for 5 min, throttled rendering at 1/sec.
- **Offline-first done right.** The SW uses cache-first for tiles, network-first for app files, and a transparent pixel fallback for missing tiles (sw.js:62-64). Tile pre-download respects OSM's 2 req/sec policy.
- **Good XSS prevention.** `escapeHtml()` at app.js:1400-1404 uses DOM-based escaping and is consistently applied to user-generated content.
- **Accessibility baseline** exists — `aria-pressed`, `aria-live` region for tracking status, semantic buttons.

## Recommendations

### 1. Security: API Key Exposure in Browser (High Priority)

app.js:2119 — The Gemini API key is passed as a URL query parameter. app.js:2178-2184 — The Anthropic call uses `anthropic-dangerous-direct-browser-access`. Both keys are stored in plain-text localStorage.

Keys are visible in browser network tabs, service worker logs, and any analytics that capture URLs. Any XSS (even from a browser extension) can exfiltrate them.

**Fix:** Add a warning in the UI that keys are stored client-side and users should use restricted/low-quota keys. Ideally, proxy API calls through a simple edge function (Cloudflare Worker, Vercel Edge) to keep keys server-side. For Gemini specifically, move the key to a request header instead of the URL.

### 2. Firebase Collaboration Has No Authentication (High Priority)

app.js:1668-1693 — `createSharedTrip()` writes directly to `/trips/{6-char-code}.json` with no auth. Anyone who guesses a trip code can read/modify/delete trip data. The 6-char alphanumeric space (~700M combinations) is brute-forceable.

**Fix:** At minimum, document that users should configure Firebase Security Rules. Consider adding Firebase Anonymous Auth — it's free and adds a layer of protection without requiring accounts.

### 3. Sync Race Condition — Last Write Wins Silently

app.js:1759-1771 — `syncToFirebase()` PATCHes the full location set. If two users edit different locations simultaneously, the last PATCH overwrites the other's changes.

**Fix:** Sync individual locations by ID: `PATCH /trips/{code}/locations/{locId}.json`. This makes concurrent edits to different locations conflict-free.

### 4. Event Listener Accumulation

app.js:663-760 — `setupDragReorder()` attaches `touchmove`, `mousemove`, `touchend`, and `mouseup` listeners to the list element every time `renderList()` is called in day view. These are never removed.

**Fix:** Use event delegation on a stable parent, or remove previous listeners before re-attaching.

### 5. No Data Export/Backup

All data lives in localStorage with no export mechanism. Clearing browser data loses everything (unless using Firebase collaboration).

**Fix:** Add "Export as JSON" and "Import JSON" buttons (~20 lines each). Download locations, trip dates, and day orders as a `.json` file.

### 6. Duplicate Sort Logic

Location sorting (by date → time → name) is duplicated in three places: `renderList()` (line 557), `drawRoute()` (line 847), `openRouteInGoogleMaps()` (line 912).

**Fix:** Extract a `sortLocationsChronologically(locs)` helper.

### 7. Silent localStorage Error Handling

Multiple `catch (e) { /* ignore */ }` blocks (lines 186, 203, 1411, 1425, 1432, 1437). Users won't know when storage is full.

**Fix:** Catch quota exceeded errors: `if (e.name === 'QuotaExceededError') showToast('Storage full');`

### 8. Service Worker Cache Versioning is Manual

sw.js:1 — `CACHE_NAME = 'trip2rome-v7'` must be manually bumped on every deploy. Forgetting causes stale code.

**Fix:** Generate the version from git hash or build timestamp in a deployment pipeline.

### 9. AI Response Validation

app.js:2136-2138 and 2198-2200 — AI responses are parsed as JSON and rendered as cards without schema validation. Unexpected fields or malformed data could cause runtime errors.

**Fix:** Validate AI response structure before rendering: check that `name` is a string, `lat`/`lng` are numbers within Italy's bounds, `category` is a known value.

### 10. No Automated Tests

No tests exist. The pure utility functions (`haversine`, `formatDistance`, `formatDate`, `escapeHtml`, `generateTripCode`, `buildSyncPayload`) are the lowest-friction starting point for adding tests.

### 11. Consider ES Modules for Future Growth

At 2,580 lines the single file is manageable but approaching the limit. If adding features, consider splitting into native ES modules (`<script type="module">`) — no build tools required.

## Priority Order

1. **Firebase auth rules + API key warning** — security
2. **Per-location Firebase sync** — data integrity
3. **Data export/import** — data loss prevention
4. **Event listener cleanup** — memory leaks
5. Everything else — maintainability
