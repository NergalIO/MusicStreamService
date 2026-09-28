import { Notification } from 'electron';

export function toastMain(body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: 'MusicStreamService', body }).show();
}
