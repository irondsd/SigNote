"use client";

import { Modal } from "@/components/Modal/Modal";
import s from "./ExampleModal.module.scss";

type ExampleModalProps = {
  closeModal: (withOnClose?: boolean) => void;
};

export default function ExampleModal({ closeModal }: ExampleModalProps) {
  return (
    <Modal
      closeModal={closeModal}
      className={"overflow-hidden"}
      containerClassName={s.container}
      contentClassName="flex flex-col gap-20"
      overlayClosable
    >
     123
    </Modal>
  );
}
