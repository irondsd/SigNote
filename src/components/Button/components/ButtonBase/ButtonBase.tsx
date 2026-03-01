import React, { forwardRef, useCallback } from "react";

import { LinkButton, type LinkProps } from "../LinkButton/LinkButton";

export type ButtonBaseProps = LinkProps & {
  children?: React.ReactNode;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>;
  disabled?: boolean;
  isLoading?: boolean;
  tag?: string;
  type?: string;
};

export const ButtonBase = forwardRef<
  HTMLAnchorElement | HTMLButtonElement,
  ButtonBaseProps
>((props, ref) => {
  const {
    children,
    className,
    disabled,
    isLoading,
    to,
    toTab,
    href,
    onClick,
    tag = "button",
    type = "button",
    nofollow,
    title,
    ...rest
  } = props;

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
      if (disabled || isLoading) {
        event.preventDefault();
        return;
      }

      if (typeof onClick === "function") onClick(event);
    },
    [isLoading, disabled, onClick]
  );

  let Node: React.ElementType = tag as React.ElementType;

  const commonProps = {
    className,
    disabled,
    onClick: handleClick,
    "aria-busy": isLoading,
    role: "button",
    title,
    ...rest,
  };

  if (to || toTab || href) {
    Node = LinkButton;
    let target = props.target;
    if (toTab) target = "_blank";
    return (
      <Node
        {...commonProps}
        ref={ref}
        to={to}
        href={href}
        toTab={toTab}
        target={target}
        nofollow={nofollow}
      >
        {children}
      </Node>
    );
  } else if (tag === "button") {
    return (
      <Node {...commonProps} ref={ref} type={type}>
        {children}
      </Node>
    );
  }

  return (
    <Node {...commonProps} ref={ref}>
      {children}
    </Node>
  );
});

ButtonBase.displayName = "ButtonBase";
