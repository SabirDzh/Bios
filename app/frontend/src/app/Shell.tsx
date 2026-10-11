import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { NavLink, Outlet, useMatch, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  Layers,
  LogOut,
  Moon,
  Sun,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { useSession } from '../auth/session';
import { workspacesApi } from '../api/workspaces';
import { workspaceKeys } from '../api/keys';
import { setLastWorkspaceId } from '../api/lastWorkspace';
import { setThemeMode, type Theme } from '../theme/theme';
import { Skeleton } from '../ui/Skeleton';
import { useWorkspaceList } from '../pages/workspaces/workspaces.queries';
import { globalNav, workspaceNav, workspaceSections } from './nav';
import { ConnectionBanner } from './ConnectionBanner';
import './Shell.css';

function usePopover(): {
  open: boolean;
  setOpen: (value: boolean) => void;
  ref: RefObject<HTMLDivElement | null>;
} {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

function currentTheme(): Theme {
  return (document.documentElement.dataset.theme as Theme | undefined) ?? 'dark';
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setThemeMode(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="topbar-icon-btn"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? <Sun size={15} aria-hidden /> : <Moon size={15} aria-hidden />}
    </button>
  );
}

function WorkspaceSwitcher() {
  const match = useMatch('/w/:workspaceId');
  const sub = useMatch('/w/:workspaceId/*');
  const activeId = match?.params.workspaceId ?? sub?.params.workspaceId;
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();
  const list = useWorkspaceList();
  const active = useQuery({
    queryKey: workspaceKeys.detail(activeId ?? ''),
    queryFn: () => workspacesApi.get(activeId ?? ''),
    enabled: Boolean(activeId),
  });

  const label = activeId
    ? (active.data?.name ?? (active.isError ? 'Нет доступа' : '…'))
    : 'Выберите пространство';

  // IA §4.2: смена пространства сохраняет подраздел, сущность отбрасывается.
  const section = (sub?.params['*'] ?? '').split('/')[0];
  const suffix = workspaceSections.has(section) ? `/${section}` : '';

  return (
    <div className="ws-switcher" ref={ref}>
      <button
        type="button"
        className="ws-switcher-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Layers size={14} aria-hidden />
        <span className="ws-switcher-name" title={label}>
          {label}
        </span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div className="user-menu-pop ws-switcher-pop" role="menu">
          {list.isPending && (
            <div className="ws-switcher-state">
              <Skeleton lines={2} />
            </div>
          )}
          {list.isError && (
            <div className="ws-switcher-state">
              <button
                type="button"
                className="user-menu-item"
                onClick={() => void list.refetch()}
              >
                Не удалось загрузить. Повторить
              </button>
            </div>
          )}
          {list.workspaces.map((workspace) => (
            <button
              key={workspace.id}
              type="button"
              role="menuitem"
              className={
                workspace.id === activeId
                  ? 'user-menu-item active'
                  : 'user-menu-item'
              }
              onClick={() => {
                setOpen(false);
                setLastWorkspaceId(workspace.id);
                navigate(`/w/${workspace.id}${suffix}`);
              }}
            >
              <span className="ws-switcher-item-name">{workspace.name}</span>
            </button>
          ))}
          {list.workspaces.length > 0 && <div className="user-menu-sep" />}
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/workspaces');
            }}
          >
            <Layers size={14} aria-hidden />
            Все пространства
          </button>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const session = useSession();
  const navigate = useNavigate();
  const { open, setOpen, ref } = usePopover();

  async function logout(): Promise<void> {
    setOpen(false);
    await session.logout();
    navigate('/login');
  }

  return (
    <div className="topbar-user" ref={ref}>
      <button
        type="button"
        className="topbar-user-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="topbar-username">{session.user?.username}</span>
        <ChevronDown size={13} aria-hidden />
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/account');
            }}
          >
            <UserRound size={14} aria-hidden />
            Аккаунт
          </button>
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/join');
            }}
          >
            <UserPlus size={14} aria-hidden />
            Принять приглашение
          </button>
          <div className="user-menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="user-menu-item"
            onClick={() => void logout()}
          >
            <LogOut size={14} aria-hidden />
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const exact = useMatch('/w/:workspaceId');
  const sub = useMatch('/w/:workspaceId/*');
  const workspaceId = exact?.params.workspaceId ?? sub?.params.workspaceId;
  const items = workspaceId ? workspaceNav(workspaceId) : globalNav;

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">Bios</div>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              isActive ? 'sidebar-link active' : 'sidebar-link'
            }
          >
            <item.icon size={15} aria-hidden />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

export function Shell() {
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">
        К содержимому
      </a>
      <Sidebar />
      <div className="shell-main">
        <header className="topbar">
          <div className="topbar-context">
            <WorkspaceSwitcher />
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <ConnectionBanner />
        <main className="shell-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
