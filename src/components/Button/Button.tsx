"use client";

import cx from "classnames";
import React, { forwardRef } from "react";
import type { IconSize } from "@/components/Icon/Icon";
import { Icon } from "@/components/Icon/Icon";
import type { IconName } from "@/components/Icon/icons";
import { Text } from "../Text/Text";
import s from "./Button.module.scss";
import {
  ButtonBase,
  type ButtonBaseProps,
} from "./components/ButtonBase/ButtonBase";

export const sizes = [36, 52, 80] as const;
export const styles = ["primary", "secondary"] as const;

export type ButtonSize = (typeof sizes)[number];
type ButtonStyle = (typeof styles)[number];

export type ButtonProps = ButtonBaseProps & {
  children?: React.ReactNode;
  title?: string;
  leftIcon?: IconName;
  rightIcon?: IconName;
  leftIconSize?: IconSize;
  size?: ButtonSize;
  style?: ButtonStyle;
  tag?: string;
  isLoading?: boolean;
};



export const Button = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  ButtonProps
>((props, ref) => {
  const {
    children,
    className,
    title,
    size = 36,
    leftIconSize = 24,
    style = "primary",
    disabled,
    rightIcon,
    tag = "button",
    isLoading,
    ...rest
  } = props;

  let { leftIcon } = props;

  delete rest.leftIcon;

  const rootClassName = cx(
    s.button,
    s[`size-${size}`],
    {
      [s[style]]: s[style],
      [s.disabled]: disabled || isLoading,
    },
    className
  );

  const textProps = { size: 16, weight: 400 };
  const content = title ? <Text {...textProps} value={title} /> : children;

  if (isLoading) leftIcon = "spinner";

  return (
    <ButtonBase
      ref={ref}
      className={cx("", rootClassName)}
      isLoading={isLoading}
      disabled={disabled}
      tag={tag}
      title={title}
      {...rest}
    >
      <>
        {leftIcon && (
          <Icon className={s.leftIcon} name={leftIcon} size={leftIconSize} />
        )}
        {content}
        {rightIcon && (
          <Icon className={s.rightIcon} name={rightIcon} size={24} />
        )}
      </>
    </ButtonBase>
  );
});

Button.displayName = "Button";
