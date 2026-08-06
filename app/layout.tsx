import type { Metadata } from "next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scarabée Studio — Les visuels de tes histoires vraies",
  description:
    "Décris une scène en une phrase : le studio la peint dans le style du Scarabée Noir, prête pour Facebook et TikTok.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased">
      <body className="min-h-full font-sans text-ink">
        {children}
        <MetaPixel />
      </body>
    </html>
  );
}
