import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { trpcClient } from '@/lib/trpcClient';

export type EmailMethod = {
  email: string | null;
  verifiedAt: string | null;
  /** False while an identity owns the address — the row renders read-only. */
  removable: boolean;
};

export const useEmailMethod = () => {
  const { data: session } = useSession();
  const userId = session?.user?.id;

  return useQuery({
    queryKey: ['email-method', userId],
    queryFn: async () => (await trpcClient.emailAuth.status.query()) as unknown as EmailMethod,
    enabled: userId !== undefined,
  });
};

/**
 * tRPC surfaces our thrown message as `err.message`, so the flows can branch on
 * the short codes the router throws (`TAKEN`, `HAS_EMAIL`, `BAD_CODE`, …).
 */
export const errorCode = (err: unknown): string => (err instanceof Error ? err.message : '');

export const useRequestSignInCode = () =>
  useMutation({ mutationFn: (email: string) => trpcClient.emailAuth.requestCode.mutate({ email }) });

export const useRequestLinkCode = () =>
  useMutation({ mutationFn: (email: string) => trpcClient.emailAuth.requestLinkCode.mutate({ email }) });

export const useVerifyLink = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; code: string }) => trpcClient.emailAuth.verifyLink.mutate(input),
    onSuccess: () => queryClient.invalidateQueries(),
  });
};

export const useDetachEmail = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => trpcClient.emailAuth.detach.mutate(),
    onSuccess: () => queryClient.invalidateQueries(),
  });
};
