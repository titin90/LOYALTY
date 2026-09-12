import type { MetadataRoute } from 'next';

/**
 * El escáner se usa como aplicación: se agrega a la pantalla de inicio del
 * teléfono del local. `display: standalone` quita la barra del navegador, que es
 * lo que permite llegar a ≤2 toques desde la pantalla de inicio.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Escáner de fidelización',
    short_name: 'Escáner',
    description: 'Marca las visitas de tus clientes.',
    start_url: '/scan',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#171412',
    theme_color: '#171412',
    icons: [{ src: '/icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
