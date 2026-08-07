import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(location.pathname!=="/")return;var p=new URLSearchParams(location.hash.slice(1));if(p.get("type")==="invite"&&p.has("access_token")&&p.has("refresh_token")){location.replace("/update-password"+location.hash);}})();`,
          }}
        />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
