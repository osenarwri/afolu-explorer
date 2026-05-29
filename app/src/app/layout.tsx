import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFOLU Explorer",
  description: "Prototype for exploring AFOLU stocks and fluxes",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
