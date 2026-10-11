import type { ReactNode } from 'react';
import './auth.css';

interface AuthLayoutProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthLayout({ title, children, footer }: AuthLayoutProps) {
  return (
    <div className="auth-page">
      <div className="auth-brand">Bios</div>
      <h1 className="auth-title">{title}</h1>
      {children}
      {footer && <div className="auth-footer">{footer}</div>}
    </div>
  );
}
