import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header, Footer } from '@/components/Chrome';
export const metadata: Metadata = { title: 'Home Printing Service – Your Ideas, We Print It!', description: 'Colour printing ₹9/page, black & white ₹2/page. Hyderabad.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><Header /><main>{children}</main><Footer /></body></html>;
}
