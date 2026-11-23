import type { Metadata } from 'next';
import './style.css';

export const metadata: Metadata = {
  title: 'Ludra Party',
  description: 'Organize suas próximas partidas de Ludra com o grupo.',
  robots: { index: false, follow: false },
};

export default function Layout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
