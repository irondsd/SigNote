import { OtpVaultProvider } from '@/contexts/OtpVaultContext';

/**
 * The authenticator sits under `(vault)` so `EncryptionProvider` is in scope
 * for enrollment — deriving the OTP key needs the MEK once — but its own key
 * lifecycle is entirely separate from there on. Locking Secrets and Seals does
 * not lock this, and this never keeps the MEK alive.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <OtpVaultProvider>{children}</OtpVaultProvider>;
}
