import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { currentOwner } from '@/lib/auth';
import { logoutAction } from './login/actions';
import './globals.css';

export const metadata: Metadata = { title: 'LIFE: UPDATED. studio', robots: { index: false, follow: false } };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const owner = await currentOwner();
  return (
    <html lang="en">
      <body>
        {owner ? (
          <header className="top">
            <strong>LIFE: UPDATED. studio</strong>
            <nav>
              <Link href="/">Dashboard</Link>
              <Link href="/insights">Insights</Link>
              <Link href="/voice">Voice</Link>
              <Link href="/settings">Settings</Link>
              <Link href="/audit">Audit log</Link>
            </nav>
            <form action={logoutAction}>
              <button type="submit" className="link">Sign out</button>
            </form>
          </header>
        ) : null}
        {children}
      </body>
    </html>
  );
}
