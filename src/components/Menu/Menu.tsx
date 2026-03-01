"use client";

import { type FC } from "react";
import s from "./Menu.module.scss";
import { IconButton } from "../IconButton/IconButton";
import { Text } from "../Text/Text";

type MenuProps = {
  onClose?: () => void;
};

const Menu: FC<MenuProps> = ({ onClose }) => {
  const scrollToId = (id: string) => {
    onClose?.();
    const el = document.getElementById(id);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 200;
    window.scrollTo({ top: y, behavior: "smooth" });
  };

  return (
    <div className={s.overlay} role="dialog" aria-modal="true">
      <IconButton
        name="close"
        size={12}
        className={s.closeBtn}
        onClick={onClose}
      />

      <div className="mt-40 flex flex-col gap-8 items-center">
        <a
          href="#whoarewe"
          onClick={(e) => {
            e.preventDefault();
            scrollToId("whoarewe");
          }}
        >
          <Text size={20} weight={500}>
            Who We Are
          </Text>
        </a>
        <a
          href="#howleagueworks"
          onClick={(e) => {
            e.preventDefault();
            scrollToId("howleagueworks");
          }}
        >
          <Text size={20} weight={500}>
            How it Works
          </Text>
        </a>
      </div>
    </div>
  );
};

export default Menu;
