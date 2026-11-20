# Aprimo Builder Tools (Chrome extension)

> **Community-built and maintained tools, not core Aprimo functionality. Use at your own risk.**
> Some tools change data in Aprimo (rules, record versions); try them on a sandbox site first.

A Chrome extension that adds an **External Builder Tools (Experimental)** section to the bottom of Aprimo's
Administration menu, with three tools that use each person's own Aprimo sign-in:

- **Rules Manager**: browse, search, edit and create DAM rules, with their logic in view.
- **Job Log Search**: search and filter DAM maintenance jobs (System → Jobs), including by record ID.
- **Bulk Versioning**: drop updated files and add each as a new version of the matching record
  (ported from [Aprimo Admin Tools](https://github.com/ViraniAJ/aprimo-admin-tool)).

**Install:** download or clone this repository, open `chrome://extensions`, turn on **Developer mode**, click
**Load unpacked** and pick the `extension/` folder. Then follow the one-time Aprimo setup under
[Chrome extension](#chrome-extension) below. The extension ID is fixed (`dalgokbanekaibeabfhhhijlggnniimn`), so the
redirect URL to register in Aprimo is the same for everyone:
`https://dalgokbanekaibeabfhhhijlggnniimn.chromiumapp.org/`.

(The project was first called "Aprimo Rules Manager"; the local folder may still have that name.)

Browse, search, edit and create Aprimo DAM rules through the DAM REST API (`/rules`, `/rule/{id}`).
It comes in two forms that share the same UI:

| | **Chrome extension** (`extension/`) | **Local web app** (`server.js` + `public/`) |
|---|---|---|
| Credentials | Each user's own Aprimo sign-in (SSO) | One service account (client credentials) |
| Runs | In Chrome; a **Rules** button on DAM pages opens it over the DAM | `npm start`, then <http://localhost:4317> |
| Permissions | The signed-in user's Aprimo rights | The service user's rights |
| Backups before edit/delete | Extension storage (Settings > Download backups) | `backups/` folder |

## Features

- **List view with the logic inline.** Every rule shows its IF conditions and THEN actions in plain language,
  with field and classification IDs resolved to names. *Compact* mode keeps each line to one row; hover a
  rule's logic to see all of it, with reference XML formatted. *Full logic* mode shows everything inline.
- **Search and filters.** Search covers names, condition and action text, reference expressions, field names
  and the name of whoever last modified the rule. Filter by target, trigger, enabled state, action type,
  condition type, **Modified by** (the last person to change a rule) and **Modified within** (today, 7, 30 or
  90 days). Each row shows who last modified it; hover that line to see who created it. Aprimo keeps only
  the *last* modifier, not the full history.
- **Enable/disable** from the list with the toggle.
- **Edit** in a side panel. Conditions and actions are edited as JSON, with a live readable preview, an
  "Insert field ID" picker, and *+ Add* templates for every condition and action type.
  **Review changes** shows a diff before saving.
- **Create** a rule from scratch, or **Duplicate as new** from an existing one. New rules start disabled.
- **Delete**, which requires typing the rule name. **Export** the visible rules as JSON.

Keyboard: `/` focuses search, `Esc` closes the editor, `Cmd/Ctrl+S` saves.

---

## Chrome extension

### 1. One-time Aprimo setup (an Aprimo admin)

In Aprimo, go to **Administration > Integration > Registrations > New**. This needs Security or System
Administration domain rights.

- **OAuth Flow Type:** Authorization Code with PKCE
- **Redirect URL:** `https://dalgokbanekaibeabfhhhijlggnniimn.chromiumapp.org/`
  (the extension ID is fixed by the `key` in `manifest.json`, so this URL is the same on every machine)
- **Enable Refresh Token:** recommended, e.g. 8 hours, so users are not asked to sign in every hour
- Save, then note the **Client ID** and **Client Secret**. Changes can take up to 15 minutes to apply.

Aprimo's documented PKCE token request includes the client secret, so the extension sends it when one is set.
In a browser extension, that secret is readable by anyone who has the extension. The sign-in itself still
requires each user's own Aprimo login. Use this registration for this tool only.

### 2. Preset the settings (optional)

Copy `extension/app/defaults.example.json` to `extension/app/defaults.json` and fill in the tenant and client
ID (and the secret, if needed). Users then only have to click **Sign in**. Without this file, each user enters
them once in **Settings**.

### 3. Install

Run `npm run build:ext` whenever `public/` changes. It copies the shared UI into `extension/app/`.

**For a pilot (a few people):** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
and choose the `extension/` folder. There are no automatic updates; to update, replace the folder and click
the reload icon.

**For a team, without the Chrome Web Store:** see [Distribution](#distribution).

### External Builder Tools (inside Aprimo)

The extension adds a section **External Builder Tools (Experimental)** at the bottom of Aprimo's Administration menu
(`content/aprimo-nav.js`). Each tool opens in Aprimo's admin layout at `#/management/home?arm=<tool>`, with a line under
the heading: "Community-built and maintained tool, not core Aprimo functionality. Use at your own risk." (the same text is
the tooltip on the menu section and its items). Old Rules Manager links
(`#/management/rulesDamUi?arm=manager`) redirect to the new place.

- **Rules Manager** (`app/index.html`): see above.
- **Job Log Search** (`app/jobs.html`): searches DAM maintenance jobs (the System → Jobs log) through the public
  `GET /maintenancejobs` API. Read-only. Filters: date range (UTC), status chips with counts, job type, people vs.
  system jobs, creator name or email, find by job ID, **record / object ID** (jobs whose targets include that object;
  with or without dashes; the API can't filter by target, so it reads the targets of jobs matching the other filters, up to
  2,000 jobs, with progress and Stop), and an extra Aprimo search condition. The generated search
  expression is shown and copyable. A job's detail panel shows its message, actions (including which rule ran),
  and targets with their errors, linking to the DAM record. Exports CSV (up to 5,000 jobs).
  Notes verified on ps1: `Type` must be matched by full name (the tool uses `Type = "*.<Type>, *"`); system jobs are
  created by `Operator` and the built-in `Administrator`; the creator is returned only with
  `select-maintenancejob: createdby`. The DAM's **Application log** has no public API (its page uses internal
  postbacks), so it isn't covered.
  Rule jobs link to their rule: the rule name opens Aprimo's own rule page (`/System/Rules/<name>`; Aprimo's page is
  keyed by name, not ID), and a **Rules Manager** link opens it in the Rules Manager by ID (`…?arm=rules-manager&rule=<id>`).
- **Bulk Versioning** (`app/bulk.html`): ported from
  [Aprimo Admin Tools](https://github.com/ViraniAJ/aprimo-admin-tool) (BSD-3-Clause; its licence is in
  `tools-src/bulk-versioning/LICENSE`). Pick classifications, drop updated files or a folder, and each file is matched by
  name to the record whose master file has the same or a similar name (ignoring markers like `_v2`, `final`, sizes,
  counters). Review the matches, then version one at a time or all at once; each file is uploaded and added as a new
  version of the record's master file. Unmatched files can be exported as a zip, or created as new **draft** records
  after a confirmation. Writes to Aprimo: it uploads files and changes records, so try it on a sandbox first.
  `app/bulk.html?mode=preview` is the same tool as **Bulk Previews** (adds each file as a preview on the master file's
  current version); it isn't in the menu yet.
  The React source is in `tools-src/bulk-versioning/src` and is built into `extension/app/bulk/` with
  `npm run build:tools` (esbuild + Tailwind); the built files are part of the extension, so rebuild after changing the
  source. Only `aprimo.tsx` and `main.tsx` differ from the original: the extension page (`app/bulk-boot.js`) sets up the
  site and sign-in like the other tools and hands the tool a token bridge (same site rules, "Use my open DAM tab" or
  "Sign in with Aprimo", a fresh token per request and one retry on 401). Uploads go to `https://{tenant}.aprimo.com/uploads`;
  checked on ps1 that this accepts the DAM-tab token. The tool's colour variables are prefixed `--bv-` so they never
  clash with the extension's own.

### Using it

> **Standalone views are switched off** (`extension/features.js` → `standaloneViews: false`). The manager is used
> only from Administration → Content Administration → **Rules Manager - Experimental**; the floating ⚙︎ Rules
> button on DAM pages is hidden and the toolbar icon opens that Administration page (in a new tab, for the current
> tab's site). Set `standaloneViews: true` and reload the extension to bring them back; their code is unchanged.


- **Inside Aprimo's Administration:** go to Administration → Content Administration → **Rules Manager -
  Experimental** (right after "Rules"). It opens in Aprimo's own admin layout, in place of Aprimo's rules screen,
  at `#/management/rulesDamUi?arm=manager`, so Back, Refresh and bookmarks work. Clicking "Rules" or anything
  else in the menu brings Aprimo's own screens back. Inside Aprimo the manager uses an Aprimo look (`extension/app/aprimo-theme.css`: Roboto, teal
  accent, white card table, checkbox-style Enabled column, uppercase text buttons), measured from Aprimo's own
  rules screen. The link is added by the extension
  (`content/aprimo-nav.js`, anchored on Aprimo's `data-automation-id` attributes); if an Aprimo release renames
  those, the link disappears until the script is updated, and nothing else in Aprimo is affected.
- On any `*.dam.aprimo.com` page, a **⚙︎ Rules** button appears in the bottom-right corner. Click it to open the
  manager over the DAM, or Shift+click to open it in a new tab. The toolbar icon also opens it in a tab.
- On first use, click **Sign in to {tenant}**. Aprimo's login page (or your SSO) opens in a popup, and after
  that the token refreshes on its own. Tokens are kept in memory only (`chrome.storage.session`), so closing
  the browser signs you out.
- **Only the site in your open tab:** the manager never remembers a site. It uses the Aprimo tab you opened it
  from (the **Rules** button, or the toolbar icon on that tab), and only while a tab of that site is open **in the same Chrome window** as the manager (Aprimo tabs in other windows are ignored):
  - every request first checks that the site has an open tab;
  - when the site's last tab closes, the manager disconnects, clears the rules from the screen and forgets
    that site's sign-in (it reconnects on its own if you open the site again);
  - opened from a non-Aprimo tab, it uses the one open Aprimo site, asks which if several are open, or tells
    you to open one first;
  - while more than one Aprimo site is open in that window, an amber banner and a highlighted site badge name the site this
    window works on, enable/disable toggles ask for confirmation, and save/delete confirmations list the other
    open sites.
- **Settings** has the sign-in mode, read-only mode, the client ID for the current site (for "Sign in with
  Aprimo", each site has its own registration), *Sign out* and *Download backups*.

### Sign-in modes

Every tool shows which sign-in it's actually using next to the site and version: **Via client ID …** (your
registration's client ID) or **Via your current session** (amber: a token taken from an open Aprimo tab). It's read from
the current token's `client_id` (DAM tab tokens are issued to Aprimo's
own `DamUI` client); hover it, or open Settings, for the user, client ID and token expiry.

- **Sign in with Aprimo (recommended):** Authorization Code with PKCE through `chrome.identity`. This is the
  sign-in method Aprimo supports for interactive use.
- **Use my open DAM tab (experimental):** reuses the bearer token the DAM web page already sends to Aprimo
  APIs, so it needs no registration. It depends on how the Aprimo UI works internally, so it may stop working
  after an Aprimo release, and it has not been tried against a real tenant. Tokens are only captured while
  this mode is selected.

---

## Local web app

1. Register a **Client Credentials** integration in Aprimo whose user can manage rules.
2. `cp .env.example .env` and fill in `APRIMO_DOMAIN`, `APRIMO_CLIENT_ID` and `APRIMO_CLIENT_SECRET`.
3. Start it with `npm start`, then open <http://localhost:4317>.

To try it on sample data instead, run `npm run mock`. Set `READ_ONLY=1` in `.env` to block every write.

---

## Distribution

You don't need the Chrome Web Store. A plain "click this link to install" for an extension outside the store
is blocked by Chrome on Windows and macOS unless IT allows it by policy. Your options:

1. **Load unpacked.** Best for a handful of admins. No Google involvement, but Developer mode must be on and
   there are no automatic updates.
2. **Self-host, installed by IT policy (recommended for a team).** No Google involvement, and automatic updates.
   - Pack the extension with the key in `keys/`, so the ID stays `dalgokbanekaibeabfhhhijlggnniimn`:

     ```bash
     "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension="$PWD/extension" --pack-extension-key="$PWD/keys/extension-key.pem"
     ```

   - Host `extension.crx` and an `updates.xml` on an internal HTTPS server:

     ```xml
     <?xml version='1.0' encoding='UTF-8'?>
     <gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
       <app appid='dalgokbanekaibeabfhhhijlggnniimn'>
         <updatecheck codebase='https://YOUR-HOST/aprimo-rules/extension.crx' version='0.1.0' />
       </app>
     </gupdate>
     ```

   - IT force-installs it through Intune, Group Policy or Jamf with the Chrome policy `ExtensionInstallForcelist`
     set to `dalgokbanekaibeabfhhhijlggnniimn;https://YOUR-HOST/aprimo-rules/updates.xml`. Alternatively,
     `ExtensionInstallSources` lets users install it themselves from that URL. Bump `version` in
     `manifest.json` and `updates.xml` to push an update.
3. **Chrome Web Store, unlisted.** Only people with the link can find it, but it still goes through Google's
   review. The store assigns its own extension ID, so the `key` field has to come out of the manifest and the
   Aprimo redirect URL has to change to the new ID. A "private" listing restricted to your organisation is only
   available if you use Google Workspace.

Microsoft Edge can load the same folder unpacked, and it supports the same force-install policies.

**Keep `keys/extension-key.pem` safe and out of git.** It determines the extension ID, and you need it to sign
every update. `.gitignore` already excludes it, along with `.env` and `backups/`.

---

## Development

- `npm run fake-aprimo` starts a fake tenant at <http://localhost:4318>. It serves PKCE and client-credentials
  tokens and HAL rule endpoints that page 4 rules at a time. The extension UI runs at
  `/ext/app/index.html` with a stand-in for the Chrome APIs (`dev/chrome-shim.js`).
- To point the local server at the fake tenant, set `APRIMO_API_BASE` and `APRIMO_TOKEN_URL`.
- The fake tenant also serves the job log (`dev/fake-jobs.js`) and what Bulk Versioning needs (`dev/fake-bulk.js`:
  classifications, record search, segmented uploads, record update/create). `GET /dev/bulk-log` lists the versions,
  previews and records it was asked to add. Bulk Versioning runs at `/ext/app/bulk.html?tenant=fake`.
- Saves follow the API's documented pattern. `PUT /rule/{id}` sends the rule's fields, plus `conditions` and
  `actions` as `{ addOrUpdate: [...], remove: [indexes] }`, where `index` is each item's position.

## Releases

Each change bumps `version` in `extension/manifest.json` (also shown in every tool's header), is committed and pushed,
then published with `npm run release -- "what changed"`. That creates a GitHub release `v<version>` with a zip of
`extension/` to load unpacked. Keep `keys/` out of every commit and zip (it's in `.gitignore`).

## Not yet verified

- Neither form has been run against a real Aprimo tenant. The fake tenant follows the published OpenAPI spec,
  but real responses may differ in detail. Start on a sandbox tenant, or with read-only mode on.
- The extension's background worker, the DAM-page button and the real `chrome.identity` popup have not been run
  inside Chrome. Only the extension page itself was tested, using the stand-in.
- Rules marked *internal* can only be edited by Aprimo operators.
