import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.spendtracker',
  appName: 'Spend Tracker',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
