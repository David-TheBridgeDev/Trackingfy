import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trackingfy.app',
  appName: 'Trackingfy',
  webDir: 'dist/trackingfy/browser',
  server: {
    url: 'https://trackingfy.web.app',
    allowNavigation: ['trackingfy.web.app']
  }
};

export default config;
