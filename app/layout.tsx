import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fidelización',
  description: 'Tarjeta de fidelización digital para negocios locales.',
};

export const viewport: Viewport = {
  themeColor: '#171412',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL">
      <body>{children}</body>
    </html>
  );
}
