import type { ReactNode } from 'react';
import './FullPage.css';

export function FullPage({ children }: { children: ReactNode }) {
  return <div className="full-page">{children}</div>;
}
