# Bliss One — Project Context

This file exists so that any future Claude Code session (even after this chat history is
lost) can pick up exactly where the previous session left off. Read this first.

## Who / How

- User: Praveen Saini (mis@teambgmjaipur.com), MIS department, Bliss Gems & Minerals.
- Communicate in Hindi/Hinglish. Messages are often typo-heavy/garbled — interpret
  charitably from context rather than asking for clarification on every typo.
- Work directly on the `main` branch. No feature-branch workflow in normal use.
- Every commit message ends with the Co-Authored-By / Claude-Session trailer given in
  that session's system reminder (it changes per session — use the current one, don't
  reuse an old trailer verbatim).
- After every push: verify the GitHub Actions deploy (`firebase-hosting-merge.yml`
  workflow, via `list_workflow_runs`) reaches `status: completed` /
  `conclusion: success` before telling the user it's live. Report the live URL.
- When asked for "link" with no other context, give the Bliss One hub link:
  https://bliss-gems-one.web.app/
- Must stay on the Firebase **Spark (free)** plan — no paid features/APIs.
- **Standing rule, explicitly repeated by the user multiple times — treat as inviolable:**
  any change must be scoped ONLY to what was explicitly asked. Never touch, reset, or
  "clean up" existing Users, Doers, Roles, or any other data as a side effect of an
  unrelated change. Never let a change crash the app or lose data — test the actual
  change (jsdom/vm harness at minimum) before pushing, specifically checking that
  existing records/users/roles still load and behave exactly as before. If a change
  risks touching shared data (Universal Users, appRoles, localStorage keys, Firestore
  collections) beyond its own narrow feature, stop and confirm with the user first
  instead of assuming it's fine.
- `bliss-gems-one.web.app` itself is blocked by this environment's agent proxy, so you
  cannot browse the live site directly. Verify changes via: (a) jsdom unit tests, (b) a
  local `python3 -m http.server` serving `public/` + Playwright screenshots, (c) GitHub
  Actions deploy status as the source of truth for "is it actually live".

## The three apps (all in `public/`, all on one Firebase Hosting site)

1. **Bliss One hub** — `public/index.html` — https://bliss-gems-one.web.app/
   App launcher/dashboard; embeds the other two apps in an iframe when opened inline.
2. **Parcel Dispatch & Return** — `public/parcel-dispatched/index.html` —
   https://bliss-gems-one.web.app/parcel-dispatched/
3. **Trip Expense app** — `public/trip-expense-app/index.html` —
   https://bliss-gems-one.web.app/trip-expense-app/

## Shared architecture

- **Universal Users** = the shared "Doer" login system (simple username/password, not
  Firebase Auth), stored in the Firestore collection `universal_users`, synced live
  across all three apps (each app has its own `pdStartUsersSync()`/equivalent
  `onSnapshot` listener on that same collection). Session key differs per app but the
  underlying user record is shared.
- **`appRoles`** — a field on each Universal User doc, keyed by app-slug, storing a role
  string:
  - `appRoles['trip-expense-app']` → `sales` / `admin` / `accounts` / `director`
  - `appRoles['parcel-dispatched']` → `admin` / `director` (gates that app's Analytics
    Dashboard)
  - `appRoles['bliss-one']` → `admin` / `director` (lets a Staff-Login user get Bliss One
    hub admin access — Manage/Universal Users panels — **without** needing a separate
    Firebase email/password account; this was built specifically to route around
    recurring Firebase Auth pain: forgotten passwords, "email already in use", and a
    Firestore-rules bootstrap deadlock described below).
  - Editable either from Bliss One hub's Universal Users table (`APP_ROLE_OPTIONS` maps
    app-slug → dropdown options) or from each app's own Manage panel.
- **Bliss One hub's admin access has three independent, non-exclusive paths**
  (`refreshAdminAuthStatus()` in `public/index.html`):
  1. `superAdminUnlocked` — the 10-tap secret gesture (see below) + password.
  2. Real Firebase Auth login where `users/{uid}` doc has `role: admin|director`.
  3. Staff Login (`pdLoggedUserId()`) where the Universal User doc has
     `appRoles['bliss-one']` = admin/director.
- **Secret Super Admin gesture** (same pattern in hub + Parcel Dispatch + Trip Expense):
  a small transparent button `#secretAdminIcon` (~22px circle, bottom-right corner,
  `background:transparent;color:transparent`), tap it **10 times within 2.5s** to open a
  password modal. This is the FINAL design after three escalating attempts at a fully
  invisible/blind-typed password field all failed on the user's real phone (root cause
  never fully confirmed — likely mobile keyboard-suppression heuristics). User explicitly
  chose to revert to this reliable-but-slightly-visible version — **do not re-attempt
  blind/invisible entry** unless the user asks again.
- **Cross-app Super Admin propagation**: when the hub opens an app inline (same-origin
  iframe), it calls that app's `silentUnlockSuperAdmin()` via `contentWindow` if the
  hub's own Super Admin is already unlocked — avoids asking for the password twice.
- **Firestore rules gotcha (confirmed real bug, already fixed)**: listing/querying a
  collection requires the caller to already be admin; a single-document `get()` by UID
  does not have that restriction. The original "first signup becomes admin" bootstrap did
  a `collection('users').limit(1).get()` query, which failed for every signup (not just
  non-first ones), leaving Firebase Auth accounts with no Firestore profile at all. Fixed
  by using a single sentinel doc `app_config/first_admin_bootstrap` instead of a
  collection query. If you see "Missing or insufficient permissions" errors again on a
  `users` or similar collection, suspect the same pattern (list/query requiring
  pre-existing privilege) before assuming user error.
- **Testing convention**: for every change, run a jsdom + `vm.runInContext` test (scripts
  live in the session's scratchpad, not the repo — recreate as needed) that loads the
  actual HTML file's inline `<script>` blocks into a stubbed `window`/`firebase` context,
  then asserts DOM state after calling app functions directly. For anything visual,
  cross-iframe, or touch/focus-related, additionally use Playwright against a local
  `python3 -m http.server` in `public/` (Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-sandbox`). Known jsdom/vm
  quirks: top-level `let`/`const` inside `vm.runInContext` code are NOT exposed as
  `context.propertyName` — set them via another `vm.runInContext` call in the same
  context; a Firebase Auth stub's `currentUser` must be a getter, not a plain property,
  to reflect later mutations; `indexedDB` must be stubbed for anything touching the hub's
  saved-apps list.

## Parcel Dispatch & Return — specifics

- Two modules, top-level tabs: **📦 PARCEL DISPATCH** / **↩ PARCEL RETURN**
  (`dispatchTabBtn`/`returnTabBtn`, `switchModule()`). Each module has a list view and a
  form view (`dispatchListView`/`dispatchFormView`, `returnListView`/`returnFormView`),
  shown/hidden via `showDispatchFormView()`/`closeDispatchForm()` and the Return
  equivalents.
- **Dispatch has a 6-stage mandatory sequential lock system** (`STAGE_SEQUENCE`, each
  stage lists its field IDs): 1. Basic Dispatch & Preparation → 2. Weight & Checking →
  3. Noting → 4. Recheck & Packing → 5. Final Packing → 6. Courier/Shipping Dispatch. A
  stage must have all its fields filled (`stageComplete`) before it can be locked
  (`lockCurrentStage`, auto-called by `autoLockCompletedStage`); the next stage only
  becomes editable once the previous one is locked (`previousStagesLocked`). Locks live
  in `localStorage[APPROVAL_LOCK_KEY]`, keyed by `parcelId`.
  - `canEditField()` currently gives the Doer who locked a stage a **self-correction
    grace window**: they can still edit that stage until the *next* stage also locks;
    after that, only `unlockStageAsAdmin()` (Admin/Super Admin) can reopen it.
  - **OPEN QUESTION as of the last session**: the user flagged this grace window as
    possibly unwanted ("normal doer bhi pichla fill kiya hua edit kar sakta hai" — a
    normal Doer can still edit a previously-filled section). I asked whether to remove
    the self-correction window entirely so any locked stage needs Admin Unlock
    immediately, even for the Doer who locked it. **Awaiting the user's answer** — do not
    change `canEditField()` until they respond.
- **Analytics Dashboard** (renamed from a generic "Dashboard"): gated to Admin/Director
  only via `parcelDashboardAccessAllowed()` (`superAdminUnlocked` OR the logged-in Doer's
  `appRoles['parcel-dispatched']` is admin/director). Role is settable either from the
  hub's Universal Users table or from this app's own Manage → Universal Users tab (a
  small inline "Analytics Dashboard:" dropdown per user card,
  `setParcelDashboardRole()`).
  - It is a **separate page/view**, not inline on the records list: `#dashboardView` is
    a sibling of `#dispatchModule`/`#returnModule` inside `#pdMainContent`. Reached via a
    nav button (`#openDashboardBtnWrap` / `#openDashboardBtn`) placed directly below the
    PARCEL DISPATCH/PARCEL RETURN tabs (visible from either tab), shown/hidden by
    `refreshDashboardButtonVisibility()` (called from `renderHistory()`,
    `renderReturnHistory()`, and `renderDashboard()` itself). `showDashboardView()` opens
    it (hides both modules, calls `renderDashboard()`); `closeDashboardView()` returns to
    whichever module was open before (`pdDashboardReturnModule`).
  - Contents (`renderDashboard()`): stat tiles for a Today/This Week/All Time range
    (`#dashboardRange`) — Dispatched, Pending, Top Courier, Most Active Party, Stuck
    24h+ (always overall, not range-limited), Returns; then three sub-sections, each
    calling its own render function:
    - **Stage-wise Pending Breakdown** (`renderStagePendingBreakdown`) — for every
      currently-pending record, finds the first unlocked stage in `STAGE_SEQUENCE` and
      counts by stage. Live snapshot, no date range — shows the real bottleneck.
    - **Courier-wise Spend** (`renderCourierSpendBreakdown`) — own independent filters
      (courier dropdown, month quick-pick, from/to date) separate from the main
      Today/Week/All range, because accounting needs arbitrary custom periods.
    - **Party-wise Spend** (`renderPartySpendBreakdown`) — identical pattern to
      Courier-wise Spend, grouped by `shipTo` (party) instead of courier.
  - Possible future additions discussed but not yet built (ask before adding more, the
    dashboard shouldn't get overloaded): Doer-wise performance, average turnaround time,
    month-over-month spend trend, daily/weekly trend chart, return-rate %, top N parties
    by volume, courier on-time vs delayed.

## Bliss One hub — specifics

- **Manage — Users** panel merges what used to be separate "Staff Accounts" (Firebase
  Auth admins) and "Universal Users" (Doers) into one modal with tabs
  (`setHubAdminPanelsVisible()`, `umShowTab()`), reachable via any of the 3 admin-access
  paths described above.
- Universal Users table columns: Name, Username, Mobile, **Email**, Password, Status,
  **App Access/Role** (per-app checkbox + role dropdown — only apps with a role system,
  i.e. `trip-expense-app` and `parcel-dispatched`, get the extra dropdown; other apps
  just get the access checkbox), **Bliss One Role** (dedicated dropdown, always
  rendered, values No Access/Admin/Director), Action.
- **Bulk Import**: `UU_BULK_IMPORT_SAMPLE` (hardcoded from an uploaded staff-list PDF) +
  `uuFillBulkImportSample()` / `uuBulkImportEmails()` — matches existing Universal Users
  by exact case-insensitive name and backfills their email field; reports unmatched names
  separately. Does not create new users.

## Known unresolved / pending items (as of this file's last update)

1. **Stage-lock self-correction window** (see above) — awaiting user's yes/no on removing
   it entirely.
2. **Feature Access Control** (per-Doer, per-section/feature visibility toggles within
   Parcel Dispatch, e.g. hiding specific stage sections or Notification Control from
   specific Doers) — a concrete proposal was given once but the user moved on to other
   requests without confirming. Do not build without re-confirming scope first.
3. Hitesh Dusad's email was requested at one point (to set up his `appRoles['bliss-one']`
   access) — check whether it was ever provided/added before asking again.

## Style reminders specific to this project

- These are small internal ops tools for a gems/minerals trading business — keep changes
  scoped and pragmatic, mirror existing patterns (e.g. new spend-breakdown sections
  should look and behave exactly like Courier-wise Spend, not reinvent the UI).
- Firestore/localStorage dual-storage pattern is used throughout (localStorage as the
  fast/offline source of truth for rendering, Firestore for cross-device sync) — when
  adding a new data-driven section, read from `localStorage` the same way existing
  sections do, not directly from Firestore.
