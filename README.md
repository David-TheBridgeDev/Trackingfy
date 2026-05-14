# Trackingfy 🏃‍♂️🚴‍♀️

Trackingfy is a local-first Progressive Web App (PWA) designed to replicate the core tracking features of Strava. It allows users to track their physical activities (route, time, distance, speed, and elevation gain) with a focus on privacy and offline capability.

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
