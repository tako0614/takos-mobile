# Takos Mobile

Tauri-first mobile client shell for Takos.

The shell is a client for an existing Takos host URL. Creating and managing a
host remains a Takosumi/operator responsibility; this client does not advertise
a host-creation action until an official immutable Takos release and complete
bootstrap path are available.

Mobile-specific UI is intentionally selective. Mature host screens stay on the
connected Takos host and are opened through route handoff / in-app browser;
native UI is reserved for compact previews, quick capture/actions, device-backed
flows, and deep-link handling. Remote push remains feature-off until the
build supplies a gateway URL; native/store readiness additionally requires the
provider configuration and physical-device evidence listed below.

Current surface:

- URL / QR payload entry
- mobile route deep links such as `takos://open?path=/chat`, including
  pending route open after sign-in when the payload includes `host_url`
- recent Takos host list for reconnecting without retyping URLs, with shared
  remove / clear controls
- signed return/deep-link payload handling for connecting an existing host
- host discovery through the standalone shared Mobile Kit foundation
- OIDC PKCE sign-in, session restore, refresh, and sign-out through the
  foundation controller, using the host-advertised client id and explicit
  Takos API scopes
- connected host URL copy through the shared clipboard text seam
- signed-in home summary for workspace/app/unread counts and recent
  chat-message preview with tapped host-route handoff
- signed-in notification inbox backed by `/api/notifications`, with keyset
  Load more, tapped host-route handoff, host notification handoff, and
  per-notification / bulk mark-read actions
- signed-in notification settings backed by `/api/notifications/preferences`
  and `/settings`, with mute controls and in-app / email / push channel toggles
- signed-in quick chat composer that can continue a recent host-backed thread
  or create a new one, stores the user message, starts a run, and then offers a
  hosted chat handoff with Bearer fetch SSE run streaming, automatic polling
  fallback, assistant answer preview, compact transcript, run status refresh,
  and cancel controls
- signed-in recent chat cards with a compact conversation preview and inline
  thread expansion, Load older, hosted handoff, and inline reply composer for
  continuing a thread without leaving the mobile client
- signed-in active chat list so the quick composer and hosted handoff are not
  limited to the top three preview threads
- signed-in full-thread native transcript browser for any active chat, with
  latest/older message windows, message count, host handoff, and inline reply
  composer
- signed-in agent task preview backed by `/api/spaces/:spaceId/agent-tasks`,
  with task status, priority, latest-run status, host chat handoff, and inline
  Start / Done / Block status controls
- signed-in quick agent task creation backed by
  `POST /api/spaces/:spaceId/agent-tasks`, with priority controls, automatic
  task thread creation, and host chat handoff after create
- signed-in memory preview backed by `/api/spaces/:spaceId/memories`, with
  memory type/category/importance, host memory handoff, and inline delete
  controls
- signed-in quick memory capture backed by `POST /api/spaces/:spaceId/memories`,
  with type/category controls and host memory handoff after save
- signed-in installed-app list backed by Takosumi Capsule records, joined by
  exact Capsule owner id to authorized, resolved `interface.ui.surface@1`
  launcher records from `/api/apps`; `InterfaceBinding(ui.open)` is required,
  and Capsules without one remain installed but not launchable
- signed-in Git URL Capsule setup backed by the public Source → source sync Run
  → Capsule → plan Run → approval/apply flow, with an explicit mobile plan
  review before apply and one canonical `{ url, ref, path }` Git pointer
- signed-in Capsule lifecycle preview backed by
  `/api/spaces/:spaceId/capsules` and `/sources`, with Source ref updates,
  reviewed Run apply, and destroy-Run creation
- signed-in shortcuts that open the connected host's workspace, chat, apps, and
  notifications through the native browser handoff instead of rebuilding those
  full host screens in native UI
- shared Mobile Kit shell UI with Takos-specific metrics, shortcuts, and
  palette
- shared Mobile Kit app bootstrap; `src/main.tsx` is
  mostly typed product config
- typed Tauri default product bridge factory from the shared Mobile Kit
  for deep links, opener, persistent store, Stronghold, local notifications,
  QR scanning, clipboard text writes, optional remote-push injection, and
  opener-backed call fallback
- Stronghold-backed secure token/session storage with a product-owned Android
  Keystore / iOS Keychain seed. Legacy product-scoped Tauri Store seeds are
  migration-only, are never used after native write failure, and are deleted
  after a later native read-back verifies the same value
- Tauri v2 deep-link, opener, clipboard-manager, path, store, Stronghold,
  local notification, and QR scanner plugin wiring
- Tauri v2 biometric plugin wiring exposed through a typed optional native
  authentication seam
- Tauri OS Information plugin wiring so mobile-only native capabilities are
  advertised only on iOS / Android runtimes
- biometric-gated restore for saved sessions on supported mobile runtimes
- typed optional seams for remote push token registration and call intents,
  with shared controller support for opt-in push host registration, token
  refresh re-registration, and tapped-notification host route handoff
- product-owned APNs/FCM native push plugin wiring: iOS performs session-bound
  APNs registration with separate display permission and token/event callbacks;
  Android uses the current FCM Firebase Installation ID (FID)
  register/unregister lifecycle and handles message/tap/registration-refresh
  callbacks. Both providers are unregistered on sign-out and register again on
  the next signed-in push request. iOS derives sandbox/production metadata from
  the signed `aps-environment`
  entitlement and fails closed when that entitlement is unavailable or invalid
- remote push host registration remains feature-off when the build-time gateway
  URL is absent, and release readiness still requires generated native projects,
  provider configuration, physical-device evidence, and an operator-ready
  gateway; the host-side product-neutral pusher dispatcher is implemented with
  event-id-only envelopes, a durable Queue/DLQ when bound, bounded
  `Retry-After`, SSRF-gated egress, rejected-key cleanup, transient retries,
  and stale-registration retention. Committed Agent completion/failure is the
  owner event for `run.completed` / `run.failed`; only those two categories
  default push on, without overwriting an existing user preference
- opener-backed call intent fallback for future room/call URLs; true
  incoming-call UI remains product-native plugin work
- product-local Notification Pusher adapter backed by
  `POST /api/notifications/pushers`. It registers `jp.takos.mobile`, the
  native APNs device token or FCM FID as the opaque `pushkey`,
  `event_id_only`, provider, and environment. The public gateway notify URL
  must be supplied at build time as
  `VITE_TAKOS_NOTIFICATION_PUSHER_GATEWAY_URL`; missing configuration keeps
  remote push explicitly feature-off, and non-loopback HTTP or
  credential-bearing URLs are rejected. The host operator must also include
  the public hostname in `TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS`; an
  empty allowlist rejects every public gateway registration
- the host defaults to HTTPS/public gateway URLs. Local Worker development can
  explicitly set `TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK=true` to use
  an HTTP loopback gateway such as `http://127.0.0.1:8787`; the exception does
  not allow credentials, fragments, remote HTTP, or LAN-private targets, and
  never receives the operator gateway bearer. Loopback is relative to the
  Worker process, so local-substrate `.test` DNS does not by itself make a
  browser/device-local gateway reachable
- product-local mobile tests for home summary, chat message windows, quick
  chat, notification inbox pagination, notification settings, and push
  registration payloads; shared mobile-kit tests cover push token refresh and
  notification events
- product-owned `src-tauri/app-icon.svg` plus generated Tauri desktop,
  Android, and iOS icon assets
- Tauri Android/iOS command scripts, Vite `TAURI_DEV_HOST` mobile dev host
  handling, and a mobile doctor for native readiness checks

Useful commands:

```sh
bun run mobile:check
bun run mobile:doctor
bun run mobile:native-release-check
bun run mobile:release-evidence-check
bun run mobile:release-check
bun run mobile:release-status
bun run mobile:repo-release-check
cd mobile && bun run test
cd mobile && bun run tauri:android:init
cd mobile && bun run tauri:android:dev
cd mobile && bun run tauri:ios:init
cd mobile && bun run tauri:ios:dev
cd mobile && bun run tauri:native-push:apply
cd mobile && bun run tauri:native-push:verify
cd mobile && bun run tauri:native-push:apply:release
cd mobile && bun run tauri:native-push:verify:release
```

Remaining release work:

- keep native coverage focused on mobile-critical quick actions and route
  handoff, not full parity with every host list/settings/detail screen
- Android/iOS physical-device verification for the product-owned keystore,
  Stronghold seed migration, cold restart, biometric unlock cancellation,
  biometric changes, and app upgrades
- generated Android/iOS projects with the checked-in native integration applied:
  iOS Push Notifications entitlement (`development` for local/device
  development and `production` for release signing) plus Android
  `google-services.json` and Firebase Gradle configuration. The product init
  scripts now apply the non-secret Gradle/entitlement wiring automatically;
  provider configuration remains operator-owned
- operator-deployed pusher gateway with APNs/FCM provider credentials, a
  configured `VITE_TAKOS_NOTIFICATION_PUSHER_GATEWAY_URL`, and host-side
  registration/delivery readiness
- Android/iOS physical-device evidence for permission, initial/refreshed token
  or FID registration, sign-out provider unregistration, rejected-key cleanup,
  and foreground/background/terminated/tap delivery; builds without a gateway
  URL remain explicitly feature-off
- operator registration and live evidence for each host-specific public OIDC
  client, exact `takos://oauth/callback`, PKCE code exchange/refresh, first-user
  provisioning, scoped API access, and wrong-audience rejection
- product-native incoming-call adapter through the typed `callIntent` seam when
  Takos has a concrete call surface
- store signing, screenshots, and App Store / Play Store packaging

`mobile:doctor` validates the checked-in Tauri config, capabilities, plugin
permissions, Vite mobile dev host handling, and local native toolchain
readiness. Java, Android SDK, NDK, Android Rust targets, macOS/Xcode iOS
readiness, and iOS Rust targets are reported as warnings unless the script is
run with `--strict-native-env`. `mobile:native-release-check` runs that strict
native doctor and production native-push wiring verification, so it is expected
to fail until the generated Android/iOS projects, production
`aps-environment`, SDKs, and Rust mobile targets are in place.
`mobile:release-evidence-check` validates
`mobile/release/mobile-release-evidence.json` (or
`MOBILE_RELEASE_EVIDENCE_FILE`) for store signing, uploaded artifact,
screenshot, device smoke, native-security scenarios, remote-push backend, and
remote-push physical-device evidence, plus mobile OIDC code exchange,
first-user provisioning, scope enforcement, and rejection evidence.
`mobile:release-check` runs both checks and then requires status parity, so the
strict gate cannot pass while the full status model still sees native provider,
generated wiring, implementation, or evidence blockers. The status reporter
additionally keeps missing product-owned remote-push client/backend
implementation as repository blockers.
`mobile:release-status` prints a short blocker summary without failing, so it
is the quickest way to see what remains before the strict release gate can pass.
`release:repo-check` uses the same full evidence/status model but fails only
`repo`-classified blockers. Before that status check, it verifies that the
hosted native-preflight workflow pins the adjacent standalone mobile-kit checkout at its
current committed HEAD, that the required mobile-kit files exist in the pinned
commit, and that local mobile-kit changes are committed. A mismatch is reported
as `source-ref-pending`; it remains a repository blocker until the standalone mobile-kit
change is committed and pushed and the workflow is updated to that immutable
40-character commit. This offline check proves only `local-committed-parity`;
it deliberately reports remote reachability as `not-checked`. Successful
`actions/checkout` of the exact ref from the public mobile-kit origin in the
hosted workflow is the separate live proof that the pin was actually pushed.
It is suitable for Linux CI because missing Xcode,
Android SDKs, generated projects, provider configuration, signing, store upload,
and physical-device evidence remain visible without being misreported as source
failures. `.github/workflows/mobile-native-preflight.yml` separately generates
and compiles unsigned debug projects on hosted Android/iOS toolchains. Its dummy
Firebase JSON exists only to compile the Android debug graph and is never release
configuration or store evidence.
