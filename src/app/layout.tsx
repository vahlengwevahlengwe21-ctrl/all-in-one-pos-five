import type { Metadata } from 'next';
import { PT_Sans } from 'next/font/google';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AuthClientProvider } from '@/auth/client-provider';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';
import { ShopProvider } from '@/contexts/shop-context';

export const metadata: Metadata = {
  title: 'All In One POS',
  description: 'Inventory management and stock counting application',
  manifest: '/manifest.json',
  icons: {
    icon: '/00.png',
    shortcut: '/00.png',
    apple: '/00.png',
  },
};

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-body',
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/00.png" type="image/png" sizes="256x256" />
        <link rel="apple-touch-icon" href="/00.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${ptSans.variable} font-body antialiased`}>
        <ServiceWorkerRegistration />
        <AuthClientProvider>
          <ShopProvider>
            <SidebarProvider>
              {children}
              <Toaster />
            </SidebarProvider>
          </ShopProvider>
        </AuthClientProvider>
      </body>
    </html>
  );
}
