import cx from "classnames";
import React, { forwardRef } from "react";
import { type IconProps, Icon } from "@/components/Icon/Icon";
import s from "./IconButton.module.scss";

type IconButtonProps = React.HTMLProps<HTMLButtonElement> & IconProps;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (props, ref) => {
    const { className, name, size, onClick, disabled, ...restProps } =
      props;

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      if (disabled) return;
      if (onClick) onClick(e);
    };

    return (
      <button
        ref={ref}
        className={cx(s.iconButton, className, disabled && s.disabled)}
        onClick={handleClick}
        {...restProps}
        type="button"
        disabled={disabled}
      >
        <Icon name={name} size={size} />
      </button>
    );
  }
);

IconButton.displayName = "IconButton";
