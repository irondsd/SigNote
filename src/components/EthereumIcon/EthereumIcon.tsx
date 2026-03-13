import { type FC } from 'react';
import { cn } from '@/utils/cn';

type EthereumIconProps = {
  className?: string;
};

export const EthereumIcon: FC<EthereumIconProps> = ({ className }) => {
  return (
    <svg
      fill="currentColor"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
      className={cn(className)}
    >
      <path d="M15.927 23.959l-9.823-5.797 9.817 13.839 9.828-13.839-9.828 5.797zM16.073 0l-9.819 16.297 9.819 5.807 9.823-5.801z" />
    </svg>
  );
};
