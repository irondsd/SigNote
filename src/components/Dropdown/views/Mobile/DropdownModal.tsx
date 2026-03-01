"use client";

import React, { useCallback } from "react";
import { Modal } from "@/components/Modal/Modal";
import s from "./Mobile.module.scss";
import type { ModalVisibilityProps } from "@irondsd/modal-kit";

export type DropdownModalProps = ModalVisibilityProps & {
  withCloseButton?: boolean;
  content: React.ReactElement;
};

const DropdownModal: React.FC<DropdownModalProps> = ({
  closeModal,
  withCloseButton = false,
  content,
}) => {
  const handleModalClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      event.stopPropagation();

      let element = event.target as HTMLElement | null;

      // in order to close dropdown with onClick,
      // element must have attribute data-dismiss="dropdown"
      while (element && element?.getAttribute) {
        const data = element.getAttribute("data-dismiss");

        if (data === "dropdown") return closeModal();

        element = element.parentNode as HTMLElement;
      }

      // @ts-expect-error 123
      if (typeof content.props.onClick === "function") {
        // @ts-expect-error 123
        content.props.onClick(event);
      }
    },
    [closeModal, content]
  );

  return (
    <Modal
      withCloseButton={withCloseButton}
      closeModal={closeModal}
      containerClassName={s.modalContainer}
      contentClassName={s.content}
      overlayClosable
    >
      <div onClick={handleModalClick}>{content}</div>
    </Modal>
  );
};

export default DropdownModal;
