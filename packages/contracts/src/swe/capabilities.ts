import type { SweNotification, SweNotificationClientCapabilities } from './types.js';

export function filterSweNotificationForClientCapabilities(
  notification: SweNotification,
  capabilities: SweNotificationClientCapabilities = {},
): SweNotification {
  if (capabilities.experimentalApi === true) return notification;
  if (notification.method !== 'item/commandExecution/requestApproval') return notification;
  if (notification.params.additionalPermissions === undefined) return notification;
  const params = { ...notification.params };
  delete params.additionalPermissions;
  return { ...notification, params };
}

export function filterSweNotificationsForClientCapabilities(
  notifications: SweNotification[],
  capabilities: SweNotificationClientCapabilities = {},
): SweNotification[] {
  if (capabilities.experimentalApi === true) return notifications;
  let changed = false;
  const filtered = notifications.map((notification) => {
    const next = filterSweNotificationForClientCapabilities(notification, capabilities);
    if (next !== notification) changed = true;
    return next;
  });
  return changed ? filtered : notifications;
}
