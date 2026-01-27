import { browser } from 'wxt/browser';

const ALARM_NAME = 'vibemonkey-heartbeat';
const HEARTBEAT_INTERVAL_SECONDS = 20;

/**
 * Starts the Keep-Alive alarm to prevent Service Worker suspension.
 */
export function startKeepAlive() {
  browser.alarms.create(ALARM_NAME, {
    periodInMinutes: HEARTBEAT_INTERVAL_SECONDS / 60
  });
}

/**
 * Stops the Keep-Alive alarm.
 */
export function stopKeepAlive() {
  browser.alarms.clear(ALARM_NAME);
}

/**
 * Setup the alarm listener. Should be called at the top level of the background script.
 */
export function setupKeepAliveListener() {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
      // Perform a lightweight operation to reset the idle timer
      // console.log('[VibeMonkey] Heartbeat received');
      void browser.runtime.getPlatformInfo();
    }
  });
}

/**
 * Manually triggers a heartbeat action to reset the idle timer.
 * Useful during long-running connections or operations.
 */
export function triggerHeartbeat() {
  void browser.runtime.getPlatformInfo();
}
