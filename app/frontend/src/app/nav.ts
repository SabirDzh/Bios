import type { LucideIcon } from 'lucide-react';
import { FolderGit2, Gauge, Layers, Rocket, Server } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Точное совпадение — для индексного маршрута (Обзор не активен на подстраницах). */
  end?: boolean;
}

/**
 * Глобальные пункты — вне контекста пространства. Аккаунт здесь отсутствует:
 * одно назначение — одно место (меню пользователя, IA §4.1).
 */
export const globalNav: NavItem[] = [
  { to: '/workspaces', label: 'Пространства', icon: Layers },
];

/**
 * Пункты контекста пространства; плоский список до 8 пунктов/3 групп, дальше
 * включаются подписи групп (IA §2, §4.1). Растут по мере срезов: деплои —
 * следующий шаг этой вертикали.
 */
export function workspaceNav(workspaceId: string): NavItem[] {
  return [
    { to: `/w/${workspaceId}`, label: 'Обзор', icon: Gauge, end: true },
    { to: `/w/${workspaceId}/servers`, label: 'Серверы', icon: Server },
    { to: `/w/${workspaceId}/projects`, label: 'Проекты', icon: FolderGit2 },
    { to: `/w/${workspaceId}/deploys`, label: 'Деплои', icon: Rocket },
  ];
}

/** Подразделы, которые switcher сохраняет при смене пространства (IA §4.2). */
export const workspaceSections = new Set(['servers', 'projects', 'deploys']);
