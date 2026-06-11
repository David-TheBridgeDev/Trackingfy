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

To generate an APK for Android using Capacitor, follow these steps:

1.  **Build the Angular application:**
    ```bash
    npm run build
    ```

2.  **Sync the build with Android project:**
    ```bash
    npx cap sync android
    ```

3.  **Build the APK:**

    #### 🟢 Debug Build (For Development)
    Use this for testing on your device. It doesn't require signing.
    - **Option A (Terminal):**
      ```bash
      cd android 
      ```
      
      ```bash
      ./gradlew assembleDebug
      ```

      The APK will be at: `android/app/build/outputs/apk/debug/app-debug.apk`
    - **Option B (Android Studio):**
      Go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

    #### 🔵 Release Build (For Production)
    Optimized for performance. **Must be signed** to be installed on most devices.
    - **Option A (Terminal - Unsigned):**
      ```bash
      cd android
      ```
      ```bash
      ./gradlew assembleRelease
      ```
      The APK will be at: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
    - **Option B (Android Studio - Signed):**
      1. Open the project: `npx cap open android`
      2. Go to **Build > Generate Signed Bundle / APK...**
      3. Follow the wizard to create/use a KeyStore and select the **release** variant.

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
