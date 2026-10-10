import type { LucideIcon } from 'lucide-react';
import { Layers, UserRound } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Пополняется по мере готовности модулей (серверы, деплои, обзор). */
export const navSections: NavSection[] = [
  {
    title: 'Панель',
    items: [
      { to: '/workspaces', label: 'Пространства', icon: Layers },
      { to: '/account', label: 'Аккаунт', icon: UserRound },
    ],
  },
];
