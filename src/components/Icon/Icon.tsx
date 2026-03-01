import cx from "classnames";
import React from "react";

import s from "./Icon.module.scss";
import { InlineSvg } from "@irondsd/inline-svg";
import type { IconName } from "./icons";

export const sizes = [12, 24, 32] as const;

export type IconSize = (typeof sizes)[number];

export type IconProps = {
  className?: string;
  name: IconName;
  size?: IconSize;
};

export const Icon: React.FunctionComponent<IconProps> = (props) => {
  const { className, name, size = 24 } = props;

  const rootClassName = cx(s.icon, className, s[name], s[`size-${size}`]);

  return <InlineSvg className={rootClassName} src={`/icons/${name}.svg`} />;
};
