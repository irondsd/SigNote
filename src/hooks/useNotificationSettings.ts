import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { trpcClient } from '@/lib/trpcClient';

export type NotificationSettings = {
  /** Null when the account has no address yet — a wallet-only sign-in. */
  email: string | null;
  productNews: boolean;
  signInAlerts: boolean;
};

export type NotificationPatch = Partial<Omit<NotificationSettings, 'email'>>;

export const useNotificationSettings = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ['notification-settings', userId],
    queryFn: async () => (await trpcClient.notifications.get.query()) as unknown as NotificationSettings,
    enabled: userId !== undefined,
  });
};

/**
 * Optimistic: a switch that waits for a round trip before moving reads as
 * broken. The snapshot is restored on failure and the toast explains why the
 * switch flicked back.
 */
export const useUpdateNotificationSettings = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const key = ['notification-settings', session?.user?.id];

  return useMutation({
    mutationFn: (patch: NotificationPatch) => trpcClient.notifications.set.mutate(patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<NotificationSettings>(key);
      if (previous) queryClient.setQueryData<NotificationSettings>(key, { ...previous, ...patch });
      return { previous };
    },
    onError: (_err, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error('Could not save that. Please try again.');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
};
