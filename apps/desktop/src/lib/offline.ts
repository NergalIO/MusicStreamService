import { toast } from 'sonner';
import { loadSession } from '@/lib/api';

export async function downloadOffline(trackId: string): Promise<void> {
  try {
    const session = loadSession();
    const deviceId = await window.electronAPI.getDeviceId();
    const res = await fetch(`/api/tracks/${trackId}/offline-package`, {
      headers: { Authorization: `Bearer ${session?.accessToken}`, 'X-Device-Id': deviceId },
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    await window.electronAPI.offline.save(trackId, await res.arrayBuffer());
    toast.success('Трек сохранён для офлайн-прослушивания');
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Не удалось скачать');
  }
}
