import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Falla el build ante errores de tipos: el CI no es opcional (ver CLAUDE.md).
  // El lint corre como paso propio del workflow (Next 16 ya no lo integra al build).
  typescript: { ignoreBuildErrors: false },
};

export default config;
