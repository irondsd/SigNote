import { InlineSvg } from '@irondsd/inline-svg';
import { FC } from 'react';

export const EthereumIcon: FC<{ className?: string }> = ({ className }) => (
  <InlineSvg className={className} src="/icons/ethereum.svg" />
);

// eslint-disable-next-line @next/next/no-img-element
export const GoogleIcon: FC = () => <img src="/icons/google.svg" alt="" width={18} height={18} aria-hidden="true" />;
