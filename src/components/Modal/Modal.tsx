"use client";
import s from "./Modal.module.scss";

import { type ReactNode } from "react";
import { Overlay } from "@/components/Overlay/Overlay";
import cx from "classnames";
import { IconButton } from "../IconButton/IconButton";
import { useModal } from "@irondsd/modal-kit";

export type ModalProps = {
  title?: string;
  className?: string;
  contentClassName?: string;
  containerClassName?: string;
  overlayClosable?: boolean;
  withCloseButton?: boolean;
  closeModal: (withOnClose?: boolean) => void;
  children: ReactNode;
};

export const Modal = ({
  className,
  contentClassName,
  containerClassName,
  overlayClosable = false,
  withCloseButton = true,
  closeModal,
  children,
}: ModalProps) => {
  const rootClassName = cx(s.container, containerClassName);
  const modalClassName = cx(s.modalWindow, className);
  const contentWrapperClassName = cx(s.content, contentClassName);

  const {
    handleOverlayClick,
    handleCloseButtonClick,
    handleModalClick,
    trapFocusId,
  } = useModal({
    overlayClosable,
    closeModal,
  });

  return (
    <Overlay onClick={handleOverlayClick} className={s.overlay}>
      <div className={rootClassName}>
        <div
          id={trapFocusId}
          role="dialog"
          aria-modal="true"
          className={modalClassName}
          onClick={handleModalClick}
        >
          {withCloseButton && (
            <IconButton
              className={s.closeButton}
              name="close"
              size={12}
              onClick={handleCloseButtonClick}
              data-testid="modal-close-button"
            />
          )}
          <div className={contentWrapperClassName}>{children}</div>
        </div>
      </div>
    </Overlay>
  );
};
