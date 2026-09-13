# Trackingfy 🏃‍♂️🚴‍♀️

Trackingfy is a local-first activity tracker, available as a Progressive Web App (PWA) and as a native Android app. It covers the core tracking features of Strava, Trailforks, Komoot, etc. — route, time, distance, speed and elevation — with a focus on privacy and offline capability.

**🚀 View it live at: [Trackingfy](https://trackingfy.web.app)**

There is no account and no server-side storage: every activity lives in the browser's IndexedDB, on your device.

## ✨ Features

### Tracking
- **Real-time tracking** for walking, running and cycling: duration, moving time, distance, pace, average/max speed, climb, descent, altitude and grade.
- **Background tracking on Android** through a foreground service, so recording continues with the screen off. On the web, tracking uses the Geolocation API and needs the tab to stay open.
- **Interactive recording notification (Android):** live distance, climb and elapsed time, with **Pause / Resume / Finish** buttons. On Android 16 it is promoted to a status bar chip and the lock screen (Live Updates).
- **Follow a route:** load any past activity as a reference line on the live map.

### History & activity detail
- History grouped by day, sortable by date, distance, duration, climb or descent, with multi-select deletion.
- Activity detail with the full track on the map and all the recorded stats.
- **Route editing:** trace the opening stretch that was never recorded (e.g. you started the recording late). Trackingfy proposes a start time from your average pace, warns about unrealistic speeds, and fills in the terrain elevation of the added stretch. Edited activities are marked with an *Edited* badge.

### Sharing
- **Share as image:** a composer that renders the route as a picture for social networks.
  - Formats: square (1:1), portrait (3:4) and story (9:16).
  - Dark or light style; solid or transparent (sticker-style PNG) background.
  - Toggleable layers: map background, route line, elevation profile, stats, title and date, and the Trackingfy logo.
  - Up to 6 stats of your choice.
- **Share a route file:** export a single activity as a `trackingfy.route` JSON file for another Trackingfy user to import.
- **Import from other apps (Android):** open a shared route file with Trackingfy, or send it from another app's share sheet, and it lands straight in your history. Duplicates are detected and skipped.

### Data & settings
- **Local-first storage** in IndexedDB via Dexie.js.
- **Backup & restore:** export all your data to a JSON file and import it back. The same import button also accepts a single shared route.
- **Offline capable:** the app shell is cached by the service worker, and map tiles you have viewed stay cached (up to 500 tiles, 30 days).
- **Installable PWA** on mobile and desktop.
- **Direct APK download** from the Settings page, which fetches the latest release from GitHub.
- Spanish and English UI (auto-detected), light and dark themes, and a default activity type.

### 🔒 What leaves your device
Everything runs locally, except for these requests:

| When | Service | What is sent |
|------|---------|--------------|
| Viewing the map | [OpenStreetMap](https://www.openstreetmap.org/) tile servers | Requests for the map tiles on screen |
| Saving a route edit | [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) (fallback: [Open-Elevation](https://open-elevation.com/)) | Coordinates of the hand-drawn stretch only |
| Sharing an image with the map layer on | OpenStreetMap tile servers | Requests for the tiles covering the route |
| Downloading the APK from Settings | GitHub API | Request for the latest release |

The Settings page tells users about the elevation lookup and the share-image tile downloads, next to the backup section.

## 🛠 Tech Stack

- **Frontend Framework:** [Angular](https://angular.dev/) (v21, standalone components)
- **State Management:** Angular Signals & RxJS
- **Persistence:** [Dexie.js](https://dexie.org/) (IndexedDB wrapper)
- **Maps:** [Leaflet](https://leafletjs.com/) with OpenStreetMap tiles
- **Styling:** [Tailwind CSS](https://tailwindcss.com/) v4
- **PWA Support:** Angular Service Worker (`@angular/service-worker`)
- **Native shell:** [Capacitor](https://capacitorjs.com/) 8, with [`@capgo/background-geolocation`](https://github.com/Cap-go/background-geolocation) and custom Android plugins (`RouteImportPlugin`, `TrackingNotificationPlugin`)
- **Testing:** [Vitest](https://vitest.dev/) through Angular's `@angular/build:unit-test` builder
- **Hosting & CI:** Firebase Hosting and GitHub Actions

## 📁 Project Structure

```
src/app/
├── components/
│   ├── dashboard/         # Live tracking screen and stats
│   ├── map/               # Leaflet map (live, history and route-editing modes)
│   ├── history/           # Activity list, sorting and bulk deletion
│   ├── activity-detail/   # Activity view, route editor, export and follow
│   ├── share-composer/    # Share-as-image composer UI
│   └── settings/          # Preferences, backup/restore, APK download
└── services/
    ├── tracking.ts               # Recording engine (GPS stream, pause/resume, live stats)
    ├── tracking-notification.ts  # Bridge to the Android recording notification
    ├── database.ts               # Dexie schema, backup export/import, route import
    ├── route-stats.ts            # Recomputes stats from stored coordinates (mirrors tracking.ts)
    ├── route-editor.ts           # Logic for adding a hand-drawn opening stretch
    ├── elevation.ts              # Terrain elevation lookup (Open-Meteo + fallback)
    ├── route-export.ts           # `trackingfy.route` file format
    ├── route-link.ts             # Imports routes handed over by Android intents
    ├── route-image.ts            # Canvas renderer for the share image
    ├── translation.ts            # ES/EN strings and the app version
    └── ui.ts                     # Theme, confirmation dialogs, onboarding

android/app/src/main/java/com/trackingfy/app/
├── MainActivity.java
├── RouteImportPlugin.java           # Receives VIEW/SEND intents with route files
└── TrackingNotificationPlugin.java  # Interactive recording notification
```

> **Keep in sync:** the thresholds and algorithms in `route-stats.ts` mirror the streaming ones in `tracking.ts`. If you change one, change the other.

## 🚀 Getting Started

### Prerequisites

- Node.js 20.19+ or 22.12+ (required by Angular 21)
- npm
- For Android builds: JDK 21 and the Android SDK (compile/target SDK 36, min SDK 24)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

### Development Server

To start a local development server, run:

```bash
npm start
```

Navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

> Native-only features (background tracking, the recording notification, share intents) are no-ops in the browser. Test them on an Android device.

### Building for Production

To build the project for production, run:

```bash
npm run build
```

The build artifacts will be stored in `dist/trackingfy/browser/`.

### Deploying the Web App

Every push to `main` builds the app and deploys it to Firebase Hosting (`.github/workflows/firebase-hosting-deploy.yml`). The workflow needs the `FIREBASE_SERVICE_ACCOUNT_TRACKINGFY` repository secret.

### Running Tests

To execute the unit tests with Vitest, run:

```bash
npm test
```

## 🤖 Android App

### How the native app loads the web app

`capacitor.config.ts` sets `server.url` to `https://trackingfy.web.app`, so **the Android app loads the deployed web app** instead of the web assets bundled in the APK. This has two consequences:

- Web changes reach Android users as soon as they are deployed to Firebase; there is no need to publish a new APK.
- Native changes (Java plugins, `AndroidManifest.xml`, Gradle dependencies, Capacitor plugins) **do** need a new APK release.

> **Testing local web changes on a device:** a debug APK will still show the production site. Temporarily point `server.url` to your dev server (or remove the `server` block) before running `npm run build:apk`, and don't commit that change.

### Generating an Android APK

The Android build process is fully automated. You can build it locally for testing or use GitHub Actions for production releases.

#### 🟢 Debug Build (Local Development & Testing)
Generates an APK suitable for testing on your device without manual signing.

```bash
npm run build:apk
```
The script builds the web app, runs `npx cap sync android`, runs Gradle and copies the APK to `public/apk/app-debug.apk`. The `public/apk/` folder is excluded from the Firebase deploy.

#### 🟠 Local Release Build
Builds a signed release APK on your machine (copied to `public/apk/app-release.apk`). It needs the signing files described in the security note below.

```bash
npm run build:apk:release
```

#### 🔵 Release Build (Production via GitHub Actions)
The production APK is optimized, minified and signed in the cloud by GitHub Actions (`.github/workflows/release.yml`).

To launch a new update, run the release script:

```bash
npm run release
```

**What this command does:**
1. Bumps the version number (e.g., `1.0.5` → `1.0.6`) in `package.json` and in `src/app/services/translation.ts` (the version shown in the app).
2. Commits the changes and creates a Git tag (e.g., `v1.0.6`).
3. Pushes the commit and the tag to GitHub.
4. The tag triggers the release workflow, which compiles and signs the APK and publishes it as `Trackingfy-v<version>.apk` in the **Releases** tab, with auto-generated release notes.

*(Optional)* You can specify the version bump type:
1. `npm run release patch` (e.g., 1.0.x), the default
2. `npm run release minor` (e.g., 1.x.0)
3. `npm run release major` (e.g., x.0.0)

> **Direct Download:** the Settings page asks the GitHub API for the latest release and downloads its `.apk` asset, so the file keeps its versioned name and Firebase bandwidth is not used.

> **Security Note:** the release workflow needs the `KEYSTORE_BASE64` (base64-encoded keystore) and `KEYSTORE_PROPERTIES` repository secrets. It writes them to `android/app/trackingfy.keystore` and `android/keystore.properties`; keep the same files locally for `build:apk:release`. `*.keystore` and `keystore.properties` are ignored by `.gitignore`.

### Generating Mobile Assets

To regenerate the app icons and splash screens (`@capacitor/assets` is already a dev dependency):

1. Place the source images in the `assets/` folder (recommended 1024x1024px for the icon and 2732x2732px for the splash):
   * `assets/icon.png`
   * `assets/splash.png` and `assets/splash-dark.png`

2. Run the generator:
   ```bash
   npx capacitor-assets generate
   ```

### iOS

An `ios/` Capacitor project is included, but it is not built by CI or distributed. The recording notification and the route import from other apps are Android-only.

## 📄 Route File Format

Files exported with **Export route (JSON)** use a versioned envelope, separate from the full backup:

```json
{
  "format": "trackingfy.route",
  "version": 1,
  "exportedAt": "2026-09-13T10:00:00.000Z",
  "appVersion": "1.0.5",
  "activity": {
    "date": "2026-09-12T08:30:00.000Z",
    "type": "Cycling",
    "totalDistance": 42150,
    "totalTime": 7260,
    "avgSpeed": 5.81,
    "totalClimb": 610,
    "totalDescent": 605,
    "startTime": 1789201800000
  },
  "coordinates": [
    { "lat": 28.123456, "lng": -15.43211, "timestamp": 1789201800000, "altitude": 12, "speed": 0, "source": "gps" }
  ]
}
```

Distances and elevations are in metres, durations in seconds, speeds in m/s and timestamps in epoch milliseconds. Only the main activity fields are shown; the file also carries optional ones such as `movingTime`, `maxSpeed`, `splits` and `editedAt`.

The file has no database ids, so the receiving device inserts it as a new activity. An import is skipped as a duplicate when an activity with the same `startTime` already exists. Coordinates marked `"source": "manual"` were drawn by hand in the route editor.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
