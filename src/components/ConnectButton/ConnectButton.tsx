"use client";

import { ConnectButton as RainbowKitButton } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { type FC } from "react";

import { Button, ButtonProps } from "@/components/Button/Button";

type ConnectButtonProps = ButtonProps;

export const ConnectButton: FC<ConnectButtonProps> = (props) => {
  return (
    <RainbowKitButton.Custom>
      {({ account, openConnectModal, openAccountModal }) => {
        const isConnected = Boolean(account?.address);
        return (
          <Button
            {...props}
            onClick={isConnected ? openAccountModal : openConnectModal}
          />
        );
      }}
    </RainbowKitButton.Custom>
  );
};
