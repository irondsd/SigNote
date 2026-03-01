"use client";

import cx from "classnames";
import type { FC } from "react";
import { memo, useRef, useState, useEffect } from "react";

import s from "./Accordion.module.scss";
import { Text } from "../Text/Text";
import { Icon } from "../Icon/Icon";

type FaqItem = {
  question: string;
  answer: string;
};

const AccordionItem: FC<{
  faq: FaqItem;
  onToggle: () => void;
  isActive: boolean;
}> = ({ faq, onToggle, isActive }) => {
  const { question, answer } = faq;
  const contentEl = useRef<HTMLDivElement>(null);

  // Calculate the height for smooth animation
  useEffect(() => {
    if (contentEl.current) {
      const height = contentEl.current.scrollHeight;
      contentEl.current.style.setProperty("--content-height", `${height}px`);
    }
  }, [isActive]);

  return (
    <li className={cx(s.item, { [s.open]: isActive }, "py-6")}>
      <button
        className={cx(
          s.question,
          "w-full flex justify-between items-center gap-4 text-left"
        )}
        onClick={onToggle}
        aria-expanded={isActive}
        aria-controls={`${question}_content`}
      >
        <Text
          size={28}
          weight={700}
          className="text-gray-100"
          value={question}
        />
        <Icon
          className={cx(s.icon, isActive && s.open)}
          name="plus"
          size={24}
        />
      </button>
      <div
        className={cx(s.content, { [s.open]: isActive })}
        ref={contentEl}
        id={`${question}_content`}
      >
        <Text
          className={"mt-4 text-gray-100"}
          size={16}
          tag="p"
          value={answer}
        />
      </div>
    </li>
  );
};

type AccordionProps = {
  data: FaqItem[];
  className?: string;
};

const Accordion: FC<AccordionProps> = ({ data, className }) => {
  const [open, setOpen] = useState<number | null>(null);

  const handleToggle = (index: number) => {
    if (open === index) {
      return setOpen(null);
    }
    setOpen(index);
  };

  return (
    <ul className={cx(s.container, className)}>
      {data.map((faq, index) => (
        <AccordionItem
          key={faq.question}
          faq={faq}
          onToggle={() => handleToggle(index)}
          isActive={open === index}
        />
      ))}
    </ul>
  );
};

export default memo(Accordion);
