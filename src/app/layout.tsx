import "@/styles/globals.scss";
import s from "./layout.module.scss";
import {
  GoogleTagManager,
  GoogleTagManagerNoScript,
} from "@/components/Analytics/Analytics";
import { roboto } from "@/config/fonts";
import cx from "classnames";
import { ModalProvider } from "@irondsd/modal-kit";
import { Web3Provider } from "@/providers/Web3Provider";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <GoogleTagManager />
      <body className={cx(roboto.className, "antialiased", s.body)}>
        <GoogleTagManagerNoScript />
        <Web3Provider>
          <ModalProvider>
            <main className={s.main}>{children}</main>
          </ModalProvider>
        </Web3Provider>
      </body>
    </html>
  );
}
