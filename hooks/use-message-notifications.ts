/**
 * useMessageNotifications
 *
 * Requests local-notification permission on mount and exposes a function to
 * fire a notification whenever an inbound LoRa message arrives from the ESP32.
 */

import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

// Show notifications even when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function useMessageNotifications() {
  const permissionGranted = useRef(false);

  useEffect(() => {
    Notifications.requestPermissionsAsync().then(({ status }) => {
      permissionGranted.current = status === "granted";
    });
  }, []);

  async function notifyNewMessage(text: string) {
    if (!permissionGranted.current) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "📨 New ClusterDuck Message",
        body: text,
        sound: true,
      },
      trigger: null,
    });
  }

  async function notifyDeviceSOS(deviceId: string) {
    if (!permissionGranted.current) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "🆘 SOS from Device",
        body: `${deviceId || "ESP32"} triggered an SOS via hardware button.`,
        sound: true,
      },
      trigger: null,
    });
  }

  return { notifyNewMessage, notifyDeviceSOS };
}
