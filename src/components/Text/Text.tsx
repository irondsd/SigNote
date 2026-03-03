import cx from "classnames";
import React, { type FC } from "react";

import s from "./Text.module.scss";
import TextProxy from "./TextProxy";

export const aligns = ["left", "center", "right"] as const;

export type TextAlign = (typeof aligns)[number];

export type TextProps = {
  children?: React.ReactNode;
  className?: string;
  value?: string | number;
  tag?: React.ElementType;
  size?: number | string; // px or any valid CSS size string
  weight?: React.CSSProperties["fontWeight"];
  lineHeight?: React.CSSProperties["lineHeight"];
  font?: "roboto" | "condensed";
  align?: TextAlign;
  color?: string;
  onClick?: React.MouseEventHandler<HTMLElement>;
  html?: boolean;
  suppressHydrationWarning?: boolean;
  dataTestId?: string;
  mobileSize?: number | string;
};

export const Text: FC<TextProps> = React.forwardRef<HTMLElement, TextProps>(
  function Text(props, ref) {
    const {
      children,
      className,
      value,
      tag = "div",
      size = 16,
      weight = 400,
      lineHeight,
      mobileSize,
      align,
      onClick,
      html,
      suppressHydrationWarning,
      dataTestId,
      color,
    } = props;

    if (onClick && tag !== "button") {
      console.error(
        'You can\'t use "onClick" without passing tag === "button". Create components ADA friendly!'
      );
    }

    if (mobileSize) {
      return <TextProxy {...props} />;
    }

    const textClassName = cx(s.text, className, color);

    const inlineStyles: React.CSSProperties = {};
    if (size !== undefined)
      inlineStyles.fontSize = typeof size === "number" ? `${size}px` : size;
    if (weight !== undefined) inlineStyles.fontWeight = weight;
    if (lineHeight !== undefined)
      inlineStyles.lineHeight =
        typeof lineHeight === "number" ? `${lineHeight}` : lineHeight;
    if (align) inlineStyles.textAlign = align;

    if (html) {
      const Tag = tag as React.ElementType;
      return (
        <Tag
          className={textClassName}
          style={inlineStyles}
          dangerouslySetInnerHTML={{
            __html: value,
          }}
          suppressHydrationWarning={suppressHydrationWarning}
          onClick={onClick}
          data-testid={dataTestId}
          ref={ref}
        />
      );
    }

    const content = children || value;

    const Tag = tag as React.ElementType;

    return (
      <Tag
        className={textClassName}
        style={inlineStyles}
        suppressHydrationWarning={suppressHydrationWarning}
        onClick={onClick}
        ref={ref}
        data-testid={dataTestId}
      >
        {content}
      </Tag>
    );
  }
);
