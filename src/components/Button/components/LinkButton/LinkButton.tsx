import Link from 'next/link';
import React from 'react';

export type LinkButtonProps = React.AnchorHTMLAttributes<HTMLAnchorElement> &
  LinkProps & {
    className?: string;
  };

export type LinkProps = {
  to?: string;
  href?: string;
  toTab?: string;
  target?: string;
  nofollow?: boolean;
  title?: string;
};

export const LinkButton: React.FunctionComponent<LinkButtonProps> = (props) => {
  const { children, className, href, to, toTab, nofollow, ...rest } = props;

  const content = children;

  if (to) {
    return (
      <Link prefetch={false} className={className} href={to} {...rest}>
        {content}
      </Link>
    );
  } else if (href) {
    return (
      <a className={className} href={href} rel={`${nofollow ? 'nofollow ' : ''}noreferrer`} {...rest}>
        {content}
      </a>
    );
  } else {
    return (
      <a className={className} href={toTab} target="_blank" rel="noopener noreferrer nofollow" {...rest}>
        {content}
      </a>
    );
  }
};
