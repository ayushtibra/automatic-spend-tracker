import { Capacitor, registerPlugin, type PermissionState, type PluginListenerHandle } from '@capacitor/core';

/** Native Android plugin: android/app/src/main/java/app/spendtracker/SmsInboxPlugin.java */
export interface NativeSms {
  id: string;
  address: string;
  body: string;
  /** Epoch ms. */
  date: number;
}

type Permissions = { sms: PermissionState; notifications: PermissionState };

interface SmsInboxPlugin {
  checkPermissions(): Promise<Permissions>;
  requestPermissions(options?: { permissions: ('sms' | 'notifications')[] }): Promise<Permissions>;
  /** Business-sender SMS received after `since`, oldest first. */
  readMessages(options: { since: number; limit?: number }): Promise<{ messages: NativeSms[] }>;
  takeLaunchAction(): Promise<{ openInbox: boolean }>;
  /** Write a text file to cache and open the Android share sheet. */
  shareFile(options: { filename: string; content: string; mime: string }): Promise<void>;
  /** Remove this app's notifications from the notification shade. */
  clearNotifications(): Promise<void>;
  addListener(event: 'smsReceived', listener: (sms: NativeSms) => void): Promise<PluginListenerHandle>;
  addListener(event: 'openInbox', listener: () => void): Promise<PluginListenerHandle>;
}

export const SmsInbox = registerPlugin<SmsInboxPlugin>('SmsInbox');

/** True inside the Android app; false on the web / installed PWA. */
export const isNative = Capacitor.isNativePlatform();
