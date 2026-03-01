"use client";

import React, { useMemo, useCallback } from "react";

import type { DropdownProps } from "../../Dropdown";
import { createModal, type ModalVisibilityProps } from "@irondsd/modal-kit";
import type { DropdownModalProps } from "./DropdownModal";

export const Mobile: React.FC<DropdownProps> = ({
  children,
  name,
  content,
  className,
  mobileClosable,
}) => {
  const [ModalComponent, openModal] = useMemo(() => {
    return createModal(name, () => import("./DropdownModal")) as unknown as [
      React.FC<Partial<ModalVisibilityProps>>,
      (props: Omit<DropdownModalProps, "closeModal">) => Promise<void>,
    ];
  }, [name]);

  const openDropdownModal = useCallback(
    () => openModal({ content, withCloseButton: mobileClosable }),
    [openModal, content, mobileClosable]
  );

  const child = useMemo(() => {
    if (typeof children === "function") {
      return children({ isOpen: false });
    }

    return <div className="flex items-center">{children}</div>;
  }, [children]);

  return (
    <>
      {React.createElement(
        "div",
        {
          onClick: content && openDropdownModal,
          className,
        },
        child
      )}
      <ModalComponent />
    </>
  );
};
