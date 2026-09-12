import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Manrope, Inter } from 'next/font/google';
import './globals.css';

// Manrope 800 para títulos y números grandes; Inter para texto de uso.
const manrope = Manrope({ subsets: ['latin'], weight: ['800'], variable: '--fuente-titulo' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--fuente-texto' });

export const metadata: Metadata = {
  title: 'Fidelización',
  description: 'Tu tarjeta de fidelización, siempre en el teléfono.',
};

export const viewport: Viewport = {
  themeColor: '#171412',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL" className={`${manrope.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
