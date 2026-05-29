import { EncryptionProvider } from '@/contexts/EncryptionContext';
import { AutoLockListener } from '@/components/AutoLockListener/AutoLockListener';
import { LockFab } from '@/components/LockFab/LockFab';

export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <EncryptionProvider>
      <AutoLockListener />
      <LockFab />
      {children}
    </EncryptionProvider>
  );
}
