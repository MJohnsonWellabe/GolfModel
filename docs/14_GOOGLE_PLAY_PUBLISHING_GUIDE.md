# 14_GOOGLE_PLAY_PUBLISHING_GUIDE.md

# Johnson's Golf
## Google Play Store Publishing Guide
Version 1.0

---

# Purpose

This document is a complete, start-to-finish walkthrough for taking Johnson's
Golf from "a Vite web app that runs in a browser" to "a real Android app
installed from the Google Play Store."

It assumes you have never published an Android app before and have never used
Android Studio. Every step is written in order. Steps that require a decision
specific to this project (an app ID, a privacy policy URL, etc.) are called
out explicitly as **PROJECT DECISION** or **BLOCKER** so they don't get lost
in the generic instructions.

As of today, Johnson's Golf is a plain client-side web app:

- Built with Vite + TypeScript + Babylon.js 9 (see `package.json`).
- `npm run build` runs `tsc --noEmit && vite build` and produces a static
  `dist/` folder. There is no server-side code.
- There is no Capacitor, Cordova, or TWA wrapper in the repo today, no
  `manifest.json`, and no service worker — the app is not currently a PWA.
- It uses Firebase (`firebase` in `package.json`) for Google sign-in
  (`GoogleAuthProvider` / `signInWithPopup` / `signInWithRedirect` in
  `src/firebase/FirebaseClient.ts`) and a Firebase Realtime Database profile
  store (`/profiles/{uid}`) for cloud saves, cosmetics, and tournament data.
  There is no email/password sign-in wired up despite being listed as a
  future requirement in `docs/09_PRODUCT_REQUIREMENTS.md` — only Google
  sign-in exists in code today. This matters later for the Data Safety form.
- There is no privacy policy page anywhere in this repo. See the Blockers
  section at the end — this **will** stop you from publishing until it's
  fixed.

None of that is a problem. It just means the very first decision is *how* to
turn a WebGL canvas game into something the Play Store accepts.

---

# 1. How to Get This App Into an Android Package

The Play Store does not accept a URL or a folder of HTML/JS/CSS. It accepts a
signed `.aab` (Android App Bundle) — a real Android application binary. There
are two realistic ways to produce one from this codebase.

## 1.1 Recommended path: Capacitor

[Capacitor](https://capacitorjs.com) wraps the built `dist/` output in a
native Android project that renders it inside a native WebView, packaged as a
normal Android app. This is the recommended path for Johnson's Golf because:

- It's the standard, well-documented way to ship a Vite/TypeScript web app as
  a native Android app today.
- It produces a real `.aab` with a real Android app icon, splash screen, and
  app identity — exactly what Play Store review expects to see, and exactly
  what a canvas/WebGL game needs (a dedicated full-screen WebView, not a
  browser chrome).
- It does not require you to stand up public HTTPS hosting first. Everything
  can be built and tested locally, then packaged.
- It gives you a path to native APIs later (haptics, native share, in-app
  purchases, push notifications) without re-architecting anything, since
  Capacitor plugins bridge straight into the existing TypeScript code.
- Babylon.js/WebGL performs correctly inside a Capacitor WebView on modern
  Android (which uses the system Chrome WebView component) — this is a
  well-trodden combination for 3D/WebGL games.

The rest of this guide uses Capacitor.

## 1.2 Alternative: Trusted Web Activity (TWA) via Bubblewrap

A Trusted Web Activity is a thin Android wrapper that opens your *hosted*
website full-screen with no browser chrome, verified as yours via a Digital
Asset Links file. Google's `bubblewrap` CLI generates the Android project and
`.aab` for you.

This is lighter-weight than Capacitor, but only if you're willing to do this
*first*:

1. Turn Johnson's Golf into an actual installable PWA (add a
   `manifest.json`, icons, and a service worker — none of which exist in this
   repo today).
2. Deploy it to a public HTTPS domain you control (GitHub Pages, which
   `docs/04_TECHNICAL_ARCHITECTURE.md` already lists as the current
   deployment target, would work).
3. Host a `/.well-known/assetlinks.json` file proving you own both the site
   and the Android app's signing key.

Only consider this path if you specifically want the game to also work as an
installable website independent of the Play Store, and you're comfortable
maintaining the asset-links file in sync every time you re-sign the app. For
a WebGL canvas game whose only goal right now is "get it on the Play Store,"
Capacitor is more predictable, has fewer moving parts to keep in sync, and is
what the rest of this guide assumes.

---

# 2. Prerequisites

Do these once, before touching any code.

## 2.1 A Google account

Any Gmail-based Google account works. You'll use it to sign into both the
Play Console and Android Studio. If you want to keep this project's business
identity separate from a personal Gmail, create a dedicated Google account
for it now — the Play Console account is very hard to transfer later.

## 2.2 Google Play Console developer account

1. Go to <https://play.google.com/console/signup>.
2. Sign in with the Google account from 2.1.
3. Choose an account type:
   - **Individual (personal)** — you publish as yourself. Faster to set up,
     but Google's newer identity-verification rules mean you'll upload a
     government ID and proof of address either way.
   - **Organization** — you publish as a registered business/company (needs a
     D-U-N-S number or local business registration). Slower to set up but
     looks more professional on the store listing and is exempt from the
     "12 testers for 14 days" closed-testing gate described in section 8
     (that gate currently applies only to *personal* accounts created after
     November 13, 2023).
   - **PROJECT DECISION**: for a first solo release, Individual is the
     pragmatic default. Pick Organization only if you already have a
     registered business you want as the public developer name.
4. Pay the one-time **$25 USD** registration fee. This is not a subscription
   — you pay it once, ever, per developer account.
5. Complete identity verification: Google will ask for a government-issued ID
   (passport, driver's license, or national ID), proof of address (a recent
   utility bill or bank statement), and sometimes a live selfie check.
   Verification typically completes within a few hours to two business days,
   but budget a few days of slack before you need to submit the app, since
   incomplete or mismatched documents can bounce and require resubmission.
6. Set up 2-Step Verification on the Google account — Google now requires
   this before you can upload apps.

You cannot do anything else in this guide until this account exists and
identity verification has cleared.

## 2.3 Android Studio

1. Download and install Android Studio from
   <https://developer.android.com/studio> (Windows, macOS, or Linux).
2. On first launch, let the Setup Wizard install the Android SDK, an Android
   SDK Platform (accept the latest stable one it suggests), and the Android
   SDK Build-Tools. This also installs the `keytool` and `gradle` tooling
   you'll need later.
3. You don't need to create a new project in Android Studio yet — Capacitor
   will generate one for you in step 3.3.

## 2.4 Node.js

Already present for this project (Vite/TypeScript require it) — no action
needed. Confirm with `node -v` in a terminal; anything Node 18+ is fine for
current Capacitor tooling.

---

# 3. Wrapping the Web App with Capacitor

Run these from the project root (`/home/user/GolfModel`). None of this has
been run yet — the repo has no `android/` folder and no Capacitor config
today.

## 3.1 Install Capacitor

```
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android
```

## 3.2 Initialize Capacitor

```
npx cap init
```

It will prompt for an app name and an app ID. Answer with the values decided
in section 4 below — do not accept placeholder defaults, because the app ID
becomes permanent the moment you publish (section 4.1 explains why).

- App name: `Johnson's Golf`
- Package ID: your chosen reverse-domain ID, e.g. `com.johnsonsgolf.app`
  (see section 4.1 for how to pick this for real)

This creates a `capacitor.config.ts` (or `.json`) file in the project root.

## 3.3 Point Capacitor at the built output

Open the generated `capacitor.config.ts` and confirm `webDir` is set to
`dist` — that's the folder `npm run build` already produces via `vite build`,
so no build config changes are needed:

```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.johnsonsgolf.app',
  appName: "Johnson's Golf",
  webDir: 'dist'
};

export default config;
```

## 3.4 Build the web app, then add the Android platform

Capacitor needs a `dist/` folder to exist before it can copy it into the
native project:

```
npm run build
npx cap add android
```

This generates a full native Android Studio project inside a new `android/`
folder in the repo. This folder should be committed to git (it's normal,
even required, for Capacitor projects to check in the native platform
folders) — with one exception noted in section 5.2 (never commit the
keystore or its passwords).

## 3.5 The sync step — required after every build

Any time you change the web app and want to test or ship the native app, you
must rebuild and resync:

```
npm run build
npx cap sync android
```

`cap sync` copies the fresh `dist/` output and any Capacitor plugin/native
dependency changes into the `android/` project. Forgetting this step is the
single most common Capacitor mistake — the Android app will keep shipping
whatever was in `dist/` the last time you synced, silently.

## 3.6 Open and run in Android Studio

```
npx cap open android
```

This opens the generated `android/` project in Android Studio. From there you
can run the app on an emulator or a plugged-in Android phone (enable USB
debugging in the phone's Developer Options) to see Johnson's Golf running as
a real Android app before you worry about signing or the Play Store at all.
Do this now, before proceeding — confirm the game actually loads, the canvas
renders, and touch controls work inside the WebView. WebGL games can behave
differently inside a WebView than in a full Chrome browser tab, so this is
worth verifying early.

---

# 4. App Identity

## 4.1 Application ID (package name) — PROJECT DECISION, permanent

The Application ID (e.g. `com.johnsonsgolf.app`) is Android's unique,
permanent identifier for this app. It:

- **Can never change after you publish.** If you ever change it, the Play
  Store treats it as a brand-new, unrelated app — you lose all reviews,
  install counts, rankings, and the ability to push an update to existing
  installs. There is no rename operation.
- Must be reverse-domain style: lowercase letters, digits, and underscores,
  segments separated by dots, first segment typically a domain you control
  reversed (`com.yourcompany.appname`), each segment starting with a letter.
- Does not need to literally be a domain you own — plenty of solo/indie
  developers use `com.<theirname>.<appname>` or `com.<appname>.app` when they
  don't have a company domain. It just needs to be globally unique on the
  Play Store and something you're willing to commit to forever.

There is no existing Application ID anywhere in this repo (no `android/`
folder, no Capacitor config exist yet) — you are choosing it fresh. Suggested
options:

- `com.johnsonsgolf.app` — simple, on-brand, no company name required.
- `com.wellabe.johnsonsgolf` — if "Wellabe" (or another company/studio name
  you plan to publish under) is meaningful to you.

**Decide this before running `npx cap init`** (section 3.2) — that command
writes the ID into the generated native project, and while it's *technically*
editable in the Android project before your first Play Store upload, it gets
progressively more annoying to change the more of this guide you've done.
Once you've uploaded a build to Play Console under an ID, treat it as locked.

## 4.2 App name

`Johnson's Golf` — this is already the app's name everywhere (`index.html`
`<title>`, `package.json` description). Use it verbatim as both the Android
app label and the Play Store listing title, so the phone's app drawer, the
splash screen, and the store listing all agree.

## 4.3 Version code and version name

Android apps carry two version identifiers, both set in
`android/app/build.gradle`:

- `versionCode` — a plain integer, invisible to users, that must strictly
  increase with every single upload to the Play Store (internal, closed,
  open, or production track — they all share one counter). Start at `1`.
- `versionName` — the human-readable string shown to users, e.g. `"1.0.0"`.
  Free-form; bump it however you like (semver is a reasonable default —
  `package.json` already uses `"1.0.0"`).

Example:

```gradle
android {
    defaultConfig {
        applicationId "com.johnsonsgolf.app"
        versionCode 1
        versionName "1.0.0"
        ...
    }
}
```

Every subsequent update requires incrementing `versionCode` by at least 1
(see section 10).

---

# 5. Icons and Store Graphics

Two separate sets of graphics are needed: assets baked into the Android app
itself (launcher icon), and assets uploaded to the Play Console listing page
(store icon, feature graphic, screenshots). Sizes below reflect current Play
Console requirements.

## 5.1 In the Android app (launcher icon)

Android uses an **adaptive icon**: a foreground layer and a background layer
that the system composites into circles, squircles, or other shapes depending
on the device's launcher theme.

- Foreground and background layers: **108x108dp**, with the actual visible
  content kept inside the center **72x72dp "safe zone"** (the outer ring can
  be cropped by different launcher masks).
- Easiest path: in Android Studio, right-click `android/app/src/main/res` →
  **New → Image Asset** → choose "Launcher Icons (Adaptive and Legacy)",
  feed it one square source image (at least 512x512px, ideally the same
  artwork used for the Play Store icon below), and let it generate all the
  mipmap density buckets (`mdpi` through `xxxhdpi`) plus the legacy
  fallback icon automatically. Don't hand-place PNGs into each `mipmap-*`
  folder yourself — the Image Asset tool handles the density math.
- Source art: there's no dedicated app-icon artwork in this repo yet — a
  square crop/composition built from the game's existing branding (the green
  color scheme in `index.html`, `#0b3d1f`/`#ffd54f`, plus a golf ball/flag
  motif) is a reasonable starting point. This is a design task, not a
  technical one — budget time for it.

## 5.2 In the Play Console listing

| Asset | Size | Format | Required? |
|---|---|---|---|
| App icon (Play Store listing) | 512x512px | 32-bit PNG, with alpha | Required |
| Feature graphic | 1024x500px | JPEG or 24-bit PNG, no alpha | Required |
| Phone screenshots | 320-3840px per side, max 2:1 aspect ratio (1080x1920 is the common recommended size) | JPEG or 24-bit PNG, no alpha | Required — minimum 2, maximum 8 |
| Tablet / other-device screenshots | Same rules as phone | Same | Optional (skip unless you specifically support tablets) |
| Promo video | A YouTube URL | — | Optional |

Practical notes for this project:

- Screenshots should be taken from the real Android build (via `cap open
  android` → run on an emulator/device, section 3.6), not the desktop browser
  view — Play Store reviewers and shoppers expect to see the actual mobile
  experience, and this game's UI (`index.html`) is already fixed
  portrait/landscape-locked touch UI designed for that.
- Capture a few different moments: the setup/character-select screen, a shot
  in progress with the swing meter, and the hole summary screen give a
  truthful, varied preview.
- All of these upload directly on the **Store presence → Main store
  listing** page in Play Console (section 7.1) — none of them live in the
  Android project.

---

# 6. Signing the App

Every Android app must be cryptographically signed before install. Google's
modern default flow is **Play App Signing**: you generate and keep an
*upload key* (used only to authenticate uploads to Google), and Google
generates and holds the real *app signing key* (used to sign what actually
reaches users). This means losing your upload key is recoverable (Google can
help you reset it with proof of ownership); losing the app signing key would
not be, but you never hold that key yourself under this flow.

## 6.1 Generate an upload keystore

Run this from a terminal (Android Studio's installed JDK provides `keytool`;
if it's not on your `PATH`, run it from inside Android Studio's JBR, e.g.
`.../Android Studio/jbr/bin/keytool` on Linux/Windows or the equivalent `.app`
path on macOS):

```
keytool -genkeypair -v \
  -keystore johnsons-golf-upload.keystore \
  -alias johnsons-golf-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

It will prompt for:
- A keystore password (protects the file itself).
- Your name, organizational unit, organization, city, state, country code
  (goes into the certificate — doesn't need to be exact, but keep it
  consistent for future keys if you ever create more).
- A key password (protects this specific key inside the keystore — you can
  reuse the keystore password if prompted to keep it simple).

`-validity 10000` gives the key roughly 27 years of validity, which is the
standard convention (Play Console will warn if a key expires too soon).

## 6.2 Store the keystore and its passwords safely — this is not optional

**If you lose this keystore or its passwords, you permanently lose the
ability to upload updates to this app under Play App Signing**, unless you go
through Google's key-reset support process (which requires proof you own the
app and can take time). If you're not using Play App Signing and lose your
*only* signing key entirely, there is no recovery at all — the app is
orphaned forever and you'd have to publish a new listing from scratch.

Do this immediately after generating it:

1. Copy `johnsons-golf-upload.keystore` somewhere outside the git repo
   entirely (a password manager's secure file storage, an encrypted drive,
   or a private cloud backup you control). **Do not commit it to git** — add
   it to `.gitignore` if it ever ends up inside the repo folder by accident.
2. Store the keystore password and key password in a password manager, not
   in a plaintext file next to the keystore.
3. Keep a second offline backup copy (e.g. a USB drive in a drawer) — losing
   the only copy of this file is the single most common way indie developers
   permanently lose the ability to update their own app.

## 6.3 Configure Gradle signing

Create `android/keystore.properties` (outside version control — add it to
`android/.gitignore`):

```properties
storeFile=/absolute/path/to/johnsons-golf-upload.keystore
storePassword=YOUR_KEYSTORE_PASSWORD
keyAlias=johnsons-golf-upload
keyPassword=YOUR_KEY_PASSWORD
```

Then wire it into `android/app/build.gradle`:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    ...
    signingConfigs {
        release {
            storeFile file(keystoreProperties['storeFile'])
            storePassword keystoreProperties['storePassword']
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

## 6.4 Enable Play App Signing

When you upload your first release to Play Console (section 7 onward), it
will prompt you to opt into Play App Signing and upload your upload
certificate. Accept it — it's the current default and recommended path:
Google stores the real signing key securely, you keep using your upload key
locally for every future build, and if your upload key is ever compromised
you can ask Google to revoke and reissue it without losing the app.

---

# 7. Building the Release .aab

The Play Store requires an **Android App Bundle (`.aab`)**, not an `.apk`,
for all new app submissions — Google generates device-optimized APKs from
your `.aab` at install time.

## 7.1 Via Android Studio

1. `npm run build && npx cap sync android` (always resync first — section
   3.5).
2. `npx cap open android`.
3. Menu: **Build → Generate Signed Bundle / APK**.
4. Choose **Android App Bundle**, click Next.
5. Point it at `johnsons-golf-upload.keystore`, enter the passwords/alias
   from section 6.1.
6. Choose the `release` build variant.
7. Click Finish. Android Studio builds and signs the `.aab`.

## 7.2 Via Gradle CLI (no Android Studio UI needed once configured)

From the `android/` folder:

```
./gradlew bundleRelease
```

(`gradlew.bat` on Windows.) This uses the `keystore.properties` wiring from
section 6.3 automatically.

## 7.3 Where the output lands

```
android/app/build/outputs/bundle/release/app-release.aab
```

This is the file you upload to Play Console in the next section.

---

# 8. Play Console Setup

## 8.1 Create the app entry

In Play Console: **All apps → Create app**. Enter the app name (`Johnson's
Golf`), default language, app or game (choose **Game**), free or paid
(choose **Free** unless you specifically intend to charge upfront), and
accept the relevant declarations.

## 8.2 Store listing

**Store presence → Main store listing**:

- **App name**: `Johnson's Golf`.
- **Short description** (max 80 characters): something like "Arcade 3D golf
  — pick a club, shape your shot, play a round." Keep it under the limit and
  lead with the genre.
- **Full description** (max 4000 characters): describe what
  `docs/09_PRODUCT_REQUIREMENTS.md` and `docs/02_GAME_DESIGN_DOCUMENT.md`
  frame as the pitch — a premium arcade golf game combining accessible
  three-click swing controls with real strategic depth (club selection,
  wind, shot shaping, spin), built for short mobile play sessions, in the
  spirit of *Everybody's Golf*/*Hot Shots Golf*. Mention the multiple
  courses, playable golfers, and progression (XP, coins, cosmetics,
  tournaments) since those are real, implemented features, not aspirational
  ones.
- **App icon, feature graphic, screenshots**: upload the assets from section
  5.2.
- **Category**: Games → Sports (or Games → Arcade if you'd rather lead with
  the arcade-style controls over the golf-sim framing — Sports is the more
  discoverable default for a golf game).
- **Contact details**: an email address you actually monitor (required —
  this is where Google and users can reach you) and optionally a website.
  **PROJECT DECISION**: pick/confirm this email now.

## 8.3 Content rating questionnaire

**Policy → App content → Content rating**. Fill out IARC's questionnaire
honestly. For a golf game with no violence, no gambling mechanics tied to
real money, no user-generated content beyond tournament names/scores, and no
explicit content, expect a rating in the "Everyone" / "3+" range across the
regional rating boards (ESRB, PEGI, etc. are all generated from the same
questionnaire). Answer accurately — a mismatch between your answers and the
app's actual content is a real rejection reason (see section 9.3).

## 8.4 Target audience and content

**Policy → App content → Target audience**. Declare the target age
range(s). Given the store cosmetics/coins economy, in-app "purchases" (even
if currently only earned via gameplay, not real-money IAP), and Google
sign-in, avoid marking the app as primarily directed at children under 13
unless that's a deliberate business decision — doing so pulls in Google
Play's Families Policy requirements (stricter ad/data rules, a
Families-specific review) that this app is not currently built for. If the
intended audience is general/all-ages but not children-primary, select the
broader audience option instead.

## 8.5 Data Safety form

**Policy → App content → Data safety**. This form must accurately reflect
what the app's code actually does, confirmed by inspecting
`src/firebase/FirebaseClient.ts`, `src/profile/Profile.ts`, and
`src/config.ts`:

- **Data collected**: the app collects and stores, for signed-in users only:
  - **Email address** and **name** (from Google Sign-In via
    `GoogleAuthProvider`/`signInWithPopup`/`signInWithRedirect`) — used for
    account authentication.
  - **User-generated content**: player profile data (level, XP, coins,
    cosmetic selections, career statistics) and tournament data (tournament
    names, invite codes, scores) stored in Firebase Realtime Database at
    `/profiles/{uid}`.
  - There is **no anonymous auto sign-in** — per the comments in
    `FirebaseClient.ts`, the cloud is only touched once a player explicitly
    signs in with Google; guest/local play never sends data off-device.
  - No email/password auth is actually implemented in code today (only
    Google sign-in), even though `docs/09_PRODUCT_REQUIREMENTS.md` lists
    email sign-in as a requirement — declare based on what's actually in
    the code you're shipping, not the aspirational doc.
- **Data shared with third parties**: none beyond Google/Firebase acting as
  the backend infrastructure (Firebase is Google's own service, so this is
  the standard "processor," not a third-party data sale).
- **Data deletion**: if you want to claim an account/data deletion
  mechanism (Play Console asks whether users can request deletion), confirm
  whether one actually exists in the app (a "delete my data" flow) before
  declaring it — a `.dangerBtn` reset zone exists in the UI
  (`index.html` `.resetZone`/`.dangerBtn`), but confirm what it actually
  clears (local vs. cloud) before answering this section, since an
  inaccurate answer here is a policy violation, not just a UX detail.
- **Encryption in transit**: yes (Firebase uses HTTPS/TLS).
- Be conservative and literal filling this out — Google spot-checks Data
  Safety answers against actual app behavior, and mismatches are a
  suspension risk, not just a listing cosmetic.

## 8.6 Privacy policy — BLOCKER

Play Console requires a **hosted, publicly accessible privacy policy URL**
for every app that requests any sensitive permission or collects any
personal data — which this app does (Google sign-in collects email/name;
cloud saves store gameplay data tied to a uid). **This repo has no privacy
policy page today** (confirmed — no privacy policy file or route exists
anywhere in the codebase or docs).

You must, before submitting for review:

1. Write a privacy policy describing what's in section 8.5 above in plain
   language (what's collected, why, how it's stored, that guest play collects
   nothing, how to request deletion).
2. Host it somewhere public with a stable HTTPS URL — a simple static page on
   GitHub Pages (which this project already deploys to per
   `docs/04_TECHNICAL_ARCHITECTURE.md`) is sufficient; it doesn't need to be
   fancy, just genuinely accessible without login.
3. Enter that URL in **Policy → App content → Privacy policy**.

This is the most likely blocker to catch this project off guard — flag it
now and resolve it early, since nothing in section 9 (submission) can
complete without it.

## 8.7 Ads declaration

**Policy → App content → Ads**. Nothing in this codebase integrates an ad
SDK — declare **"No, my app does not contain ads."** Revisit this
declaration if ads are ever added later; it must stay accurate.

## 8.8 Pricing and distribution

**Store presence → Pricing** (or the equivalent "Countries/regions"
section): choose **Free**, then select which countries to distribute to
(defaulting to all available countries is fine for a first release). Confirm
you're not opting into any paid/converted-to-paid options, since this app has
no monetization wired up beyond the existing cosmetics-via-earned-coins
system (no real-money in-app purchases exist in code today).

---

# 9. Testing Tracks

Play Console has four release tracks: **Internal testing → Closed testing →
Open testing → Production**. You don't have to use all of them, but for a
first release, go through internal then closed before touching production.

## 9.1 Internal testing (do this first)

- **Release → Testing → Internal testing → Create new release**.
- Upload the signed `.aab` from section 7.3.
- Fill in release notes.
- Add testers by email under the internal testing track's tester list (up to
  100 testers, no Google review wait — internal testing releases are
  available to added testers almost immediately).
- Testers must accept an invite link (Play Console generates one) and opt in
  before the app shows up for them in the Play Store on their device.

Use this track to sanity-check the whole pipeline (signing, upload, install)
before involving anyone else, and to confirm the WebGL game genuinely runs
well on a real installed build, not just an Android Studio emulator session.

## 9.2 Closed testing, and the 12-tester / 14-day rule

Move to **Testing → Closed testing** next, create a track, add a list of
tester emails (or a Google Group), and upload the same or a newer `.aab`.

If this Play Console account is a **personal account created after November
13, 2023** (which a fresh account created for this project will be), Google
requires, before granting production access:

- **At least 12 testers opted in** to a closed test.
- Those testers must **actively use the app for at least 14 continuous
  days**.
- Testers need to genuinely open and use the app during that window —
  Google now tracks engagement, not just install counts, so simply adding 12
  email addresses without them actually opening the app repeatedly will not
  satisfy this requirement, and can even reset the clock if engagement drops.

This is a real, current-as-of-2026 requirement and it surprises almost every
first-time solo publisher, because it means **you cannot go straight to
production the day your app is signed and built** — budget at least two
weeks of lead time with real testers (friends, family, a community) actively
playing rounds before you can request production access. Organization
accounts (section 2.2) are exempt from this specific gate.

## 9.3 Open testing / straight to production

Once the closed-testing requirement (if it applies to you) is satisfied, you
can either run an **open testing** track (anyone with the opt-in link can
join, still pre-production) or apply directly for **production** access.
Production is the track that puts the app in front of the general public
searching the Play Store.

---

# 10. Submitting for Review

1. On the **Production** track (or whichever track you're promoting to),
   **Create new release**, upload the `.aab`, add release notes, and submit.
2. Google reviews the submission. For a new developer account, expect
   review to take anywhere from a few hours to a few days — new accounts and
   first submissions tend to get more scrutiny than an established
   developer's routine update.
3. Common rejection reasons for a game like this one, worth checking before
   you submit rather than after a rejection:
   - **Missing or unreachable privacy policy** (section 8.6) — the single
     most common first-timer rejection.
   - **Permissions the app doesn't actually need or explain.** A Capacitor
     WebView app is usually lean on permissions by default; don't add
     capabilities (camera, location, contacts) unless the game actually uses
     them, and if you do add any later, explain why in the listing.
   - **Content rating mismatch** — answering the questionnaire (section 8.3)
     inconsistently with what the app actually does.
   - **Broken core functionality on review devices** — test the signed
     release build (not just a dev build) on at least one physical Android
     device before submitting; a build that fails to load or crashes on
     launch is an automatic rejection.
   - **Data Safety mismatches** (section 8.5) — declaring less data
     collection than the app actually performs.
   - **Ads/monetization declared incorrectly** if that ever changes later.

---

# 11. Post-Launch: Shipping Updates

Every future update follows the same loop:

1. Make the code change in this repo as normal.
2. Bump `versionCode` in `android/app/build.gradle` (must strictly increase
   from the last uploaded value — see section 4.3) and update `versionName`
   as appropriate.
3. `npm run build`.
4. `npx cap sync android` (section 3.5 — never skip this).
5. Re-build and re-sign the release `.aab` (section 7), using the **same**
   upload keystore from section 6 every time — a different key will be
   rejected as a different app.
6. Upload the new `.aab` to a track (Production, or run it through Internal
   testing again first if it's a risky change).
7. Use a **staged rollout** for production releases of real changes — Play
   Console lets you release to a percentage of existing users first (e.g.
   5% → 20% → 50% → 100%) and halt the rollout if crash rates or bad reviews
   spike, rather than pushing a bad build to every installed user at once.

## Monitoring after launch

- **Quality → Android vitals** in Play Console surfaces crash rate, ANR
  (App Not Responding) rate, and startup time across your install base —
  check this regularly, especially right after a release.
- **Quality → Crashes and ANRs** gives stack traces for individual crash
  clusters.
- Given this is a WebGL/Babylon.js game running inside a WebView, pay
  particular attention to device/GPU-specific crash clusters (older or
  low-end Android GPUs are the most likely source of WebGL-related
  instability) rather than assuming all crashes are generic Android bugs.

---

# Before You Start: Checklist

- [ ] Google account ready, 2-Step Verification enabled.
- [ ] $25 Play Console developer account created, identity verification
      submitted (budget a few days for it to clear).
- [ ] Android Studio installed.
- [ ] Node.js confirmed working (`node -v`) — already true for this project.
- [ ] Decided: Application ID (section 4.1) — e.g. `com.johnsonsgolf.app`.
- [ ] Decided: Individual vs. Organization Play Console account (section
      2.2).
- [ ] Decided: support/contact email for the store listing (section 8.2).
- [ ] App icon artwork ready (square, at least 512x512px source).
- [ ] A plan for at least 12 real people willing to test the app for 14+
      days if this is a personal account (section 9.2).

---

# Blockers You Need to Resolve Before Google Will Approve This

1. **No privacy policy exists.** This is a hard Play Store requirement given
   this app's Google sign-in and Firebase cloud saves. Write one, host it at
   a public HTTPS URL (GitHub Pages is the path of least resistance since
   this project already deploys there), and enter the URL in Play Console
   (section 8.6). Nothing in section 10 can complete without this.
2. **No Capacitor/Android project exists yet.** Section 3 has to be done
   from scratch — there is currently no `android/` folder, no
   `capacitor.config.ts`, and no native build in this repo.
3. **No app icon or store graphics exist.** Section 5 assets (launcher icon,
   512x512 store icon, 1024x500 feature graphic, screenshots) all need to be
   created — none currently exist in the repo's `assets/` folder for this
   purpose.
4. **No upload keystore exists.** Section 6 has to be done once, and the
   resulting file safely backed up outside git before you can produce a
   signed release build at all.
5. **If publishing under a personal Play Console account**, the 12
   testers / 14 days closed-testing requirement (section 9.2) means you
   cannot reach production the same day the app is ready — plan the testing
   window into your launch timeline now, not after the app is built.

---

## Addendum (2026-07): real-money purchases and Play Billing

The web game now sells a J-Coin top-up and the Season Pass via Stripe
(docs/16_PAYMENTS.md). **Inside a Play-distributed Android app, Google
requires Play Billing for digital goods — Stripe checkout is not allowed
there.** Before shipping the TWA:

- Either hide the purchase buttons in the TWA build, or integrate Play
  Billing (Digital Goods API + Payment Request API work inside a TWA).
- The RTDB `entitlements/{uid}` design is billing-provider-agnostic: Play
  Billing fulfillment would simply be a second writer to the same node; the
  game client's claim loop needs no changes.
- Web purchases at bsgolf.fun stay on Stripe regardless.
