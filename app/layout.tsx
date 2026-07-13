import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบซ่อมบำรุงเครื่องจักร",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body className="bg-surface text-primary">
        <Nav />
        <main className="pb-[68px] md:pb-0 md:pl-60">{children}</main>
      </body>
    </html>
  );
}
