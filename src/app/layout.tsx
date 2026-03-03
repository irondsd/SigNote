import "@/styles/globals.scss";
import s from "./layout.module.scss";
import {
  GoogleTagManager,
  GoogleTagManagerNoScript,
} from "@/components/Analytics/Analytics";
import { inter } from "@/config/fonts";
import cx from "classnames";
import { ModalProvider } from "@irondsd/modal-kit";
import { Web3Provider } from "@/providers/Web3Provider";
import { AuthSessionProvider } from "@/providers/AuthSessionProvider";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <GoogleTagManager />
      <body className={cx(inter.className, "antialiased", s.body)}>
        <GoogleTagManagerNoScript />
        <AuthSessionProvider>
          <Web3Provider>
            <ModalProvider>
              <main className={s.main}>{children}</main>
            </ModalProvider>
          </Web3Provider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
