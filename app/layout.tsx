import type { Metadata } from "next";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import "./globals.css";

export const metadata: Metadata = {
  title: "MeeraDraw — le Midjourney africain",
  description:
    "Décris ta scène en une phrase, en français : MeeraDraw crée des images qui te ressemblent — peaux, tissus, décors et lumières d'Afrique.",
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
