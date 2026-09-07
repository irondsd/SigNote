'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { useSyncExternalStore } from 'react';
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

import { browserSupportsWebAuthn } from '@/lib/passkeyClient';
import { trpcClient } from '@/lib/trpcClient';

export type Passkey = {
  id: string;
  nickname: string;
  deviceType: 'singleDevice' | 'multiDevice';
  backedUp: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

const subscribe = () => () => undefined;

export function usePasskeySupport(): boolean {
  return useSyncExternalStore(subscribe, browserSupportsWebAuthn, () => false);
}

export function usePasskeys() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  return useQuery({
    queryKey: ['passkeys', userId],
    queryFn: async () => (await trpcClient.passkeys.list.query()) as unknown as Passkey[],
    enabled: !!userId,
  });
}

export function useAddPasskey() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  return useMutation({
    mutationFn: async () => {
      if (!browserSupportsWebAuthn()) throw new Error('WEBAUTHN_UNSUPPORTED');
      const optionsJSON =
        (await trpcClient.passkeys.registrationOptions.mutate()) as unknown as PublicKeyCredentialCreationOptionsJSON;
      const response = await startRegistration({ optionsJSON });
      return trpcClient.passkeys.finishRegistration.mutate({ response });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys', userId] }),
  });
}

export function useRenamePasskey() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  return useMutation({
    mutationFn: (input: { id: string; nickname: string }) => trpcClient.passkeys.rename.mutate(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['passkeys', userId] }),
  });
}

export function useRemovePasskey() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const userId = session?.user?.id;
  return useMutation({
    mutationFn: (id: string) => trpcClient.passkeys.remove.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['passkeys', userId] });
      queryClient.invalidateQueries({ queryKey: ['identities', userId] });
      queryClient.invalidateQueries({ queryKey: ['email-method', userId] });
    },
  });
}
