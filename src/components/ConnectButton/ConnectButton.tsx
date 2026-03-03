"use client";

import { ConnectButton as RainbowKitButton } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { signIn, signOut, useSession } from "next-auth/react";
import { SiweMessage } from "siwe";
import { type FC, useCallback, useState } from "react";
import { useSignMessage } from "wagmi";

import { Button, ButtonProps } from "@/components/Button/Button";

type ConnectButtonProps = ButtonProps;

export const ConnectButton: FC<ConnectButtonProps> = (props) => {
  const [isLoading, setIsLoading] = useState(false);
  const { status, data: session } = useSession();
  const { signMessageAsync } = useSignMessage();

  const signInWithEthereum = useCallback(
    async (address: string, chainId?: number) => {
      const nonceResponse = await fetch("/api/auth/nonce", {
        cache: "no-store",
      });

      if (!nonceResponse.ok) {
        throw new Error("Failed to fetch SIWE nonce");
      }

      const { nonce } = (await nonceResponse.json()) as { nonce: string };

      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in with Ethereum",
        uri: window.location.origin,
        version: "1",
        chainId: chainId ?? 1,
        nonce,
      }).prepareMessage();

      const signature = await signMessageAsync({ message });
      const result = await signIn("credentials", {
        message,
        signature,
        redirect: false,
      });

      if (!result || result.error) {
        throw new Error("SIWE authentication failed");
      }
    },
    [signMessageAsync],
  );

  return (
    <RainbowKitButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal }) => {
        const isConnected = Boolean(account?.address);

        const handleClick = async () => {
          if (!isConnected) {
            openConnectModal();
            return;
          }

          const connectedAddress = account?.address;
          if (!connectedAddress) {
            return;
          }

          const sessionAddress = session?.user?.address?.toLowerCase();
          const walletAddress = connectedAddress.toLowerCase();

          if (status === "authenticated" && sessionAddress === walletAddress) {
            openAccountModal();
            return;
          }

          setIsLoading(true);

          try {
            if (status === "authenticated" && sessionAddress !== walletAddress) {
              await signOut({ redirect: false });
            }

            await signInWithEthereum(connectedAddress, chain?.id);
          } finally {
            setIsLoading(false);
          }
        };

        return (
          <Button
            {...props}
            title={isConnected ? "Sign out" : "Sign in with Ethereum"}
            onClick={handleClick}
            isLoading={isLoading}
          />
        );
      }}
    </RainbowKitButton.Custom>
  );
};
