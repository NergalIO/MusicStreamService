import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { isSpotifyScopeError, reconnectSource } from '@/lib/connectors';

export function SpotifyReconnectButton({ error }: { error: unknown }) {
  const queryClient = useQueryClient();
  if (!isSpotifyScopeError(error)) return null;
  return (
    <Button size="sm" onClick={() => void reconnectSource('spotify', queryClient)}>
      Переподключить Spotify
    </Button>
  );
}
