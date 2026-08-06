import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import '@fontsource/archivo-black/400.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';

import './_marche.css';

import { CurrencyProvider, Reveal } from '../components/site-client';

export const metadata: Metadata = {
  title: 'DigiAfrik — Des logiciels IA simples, faits pour l’Afrique',
  description:
    "Des images qui nous ressemblent, des textes qui vendent. MeeraDraw fabrique tes visuels avec les visages, les tissus et les rues d'ici ; Klik écrit tes textes de vente. Même compte, même solde de crédits, même téléphone.",
};

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="dots">
        <CurrencyProvider>
          <Reveal>{children}</Reveal>
        </CurrencyProvider>
      </body>
    </html>
  );
}
