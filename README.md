# Trackingfy 🏃‍♂️🚴‍♀️

Trackingfy is a local-first Progressive Web App (PWA) designed to replicate the core tracking features of Strava, Trailforks, Komoot, etc. It allows users to track their physical activities (route, time, distance, speed, and elevation gain) with a focus on privacy and offline capability.

**🚀 View it live at: [Trackingfy](https://trackingfy.web.app)**

All data is stored locally in the browser's IndexedDB, ensuring your tracks stay on your device.

## ✨ Features

- **Real-time Tracking:** Accurate GPS tracking for walks, runs, and rides using the Geolocation API.
- **Local-First Storage:** All activity data and coordinates are stored in IndexedDB via Dexie.js.
- **Interactive Maps:** Real-time path rendering and history viewing using Leaflet and OpenStreetMap.
- **Offline Capable:** Works without an internet connection. Maps are cached for offline use.
- **PWA Ready:** Installable on mobile and desktop devices for a native-like experience.
- **Direct APK Download:** Users can download the native Android app (APK) directly from the settings page.
- **Dashboard & History:** Comprehensive view of your current activity stats and a detailed history of past sessions.

## 🛠 Tech Stack

- **Frontend Framework:** [Angular](https://angular.dev/) (v21+)
- **State Management:** Angular Signals & RxJS
- **Persistence:** [Dexie.js](https://dexie.org/) (IndexedDB wrapper)
- **Maps:** [Leaflet](https://leafletjs.com/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **PWA Support:** Angular Service Worker (`@angular/pwa`)
- **Testing:** [Vitest](https://vitest.dev/)

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher recommended)
- npm

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

### Building for Production

To build the project for production, run:

```bash
npm run build
```

The build artifacts will be stored in the `dist/` directory.

### Generating Android APK

The Android app build process is fully automated. You can build it locally for testing or use GitHub Actions for production releases.

#### 🟢 Debug Build (Local Development & Testing)
Generates an APK suitable for testing on your device without manual signing.

```bash
npm run build:apk
```
The final APK will be copied to: `public/apk/app-debug.apk`

#### 🔵 Release Build (Production via GitHub Actions)
The production APK (`Trackingfy.apk`) is highly optimized, minified, and signed automatically in the cloud via GitHub Actions.

To launch a new update, simply run the automated release script from your terminal:

```bash
npm run release
```

**What this command does:**
1. Automatically bumps the version number (e.g., `1.0.0` → `1.0.1`) in both `package.json` and the Angular UI.
2. Commits the changes and creates a new Git Tag (e.g., `v1.0.1`).
3. Pushes the code and tags to GitHub.
4. Triggers the GitHub Actions pipeline which compiles, signs, and publishes the new APK to the **Releases** tab.

*(Optional)* You can specify the version bump type:
1. `npm run release patch` (e.g., 1.0.x)
2. `npm run release minor` (e.g., 1.x.0)
3. `npm run release major` (e.g., x.0.0).

> **Direct Download:** The settings page in the web app is configured to always fetch the latest compiled `Trackingfy.apk` directly from GitHub Releases, saving Firebase bandwidth.

> **Security Note:** The GitHub Action requires `KEYSTORE_BASE64` and `KEYSTORE_PROPERTIES` secrets configured in your repository settings. Your local `trackingfy.keystore` and `keystore.properties` are safely ignored in `.gitignore`.

### Generating Mobile Assets

To generate app icons and splash screens for Android and iOS:

1.  **Setup:** Ensure you have the assets generator installed:
    ```bash
    npm install @capacitor/assets --save-dev
    ```

2.  **Preparation:** Create an `assets/` folder in the root and add your source images (recommended 1024x1024px for icons, 2732x2732px for splash):
    *   `assets/icon-foreground.png` & `assets/icon-background.png` (for adaptive icons)
    *   `assets/splash.png` (for the splash screen)

3.  **Generate:** Run the command to update all platforms:
    ```bash
    npx capacitor-assets generate
    ```

### Running Tests

To execute unit tests with Vitest, run:

```bash
npm test
```

## 🏗 Project Structure

- `src/app/services/tracking.ts`: Core logic for Geolocation and activity state.
- `src/app/services/database.ts`: Dexie.js configuration and schema.
- `src/app/components/map/`: Leaflet integration for path rendering.
- `src/app/components/dashboard/`: Real-time controls and stats.
- `src/app/components/history/`: List and details of past activities.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
