import { Navigate, Route, Routes } from 'react-router';
import { KitPage } from '../ui/KitPage';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { JoinPage } from '../pages/join/JoinPage';
import { AccountPage } from '../pages/account/AccountPage';
import { WorkspaceHomePage } from '../pages/workspaces/WorkspaceHomePage';
import { WorkspaceLayout } from '../pages/workspaces/WorkspaceLayout';
import { WorkspacesPage } from '../pages/workspaces/WorkspacesPage';
import { ServersPage } from '../pages/servers/ServersPage';
import { ProjectsPage } from '../pages/projects/ProjectsPage';
import { ProjectPage } from '../pages/projects/ProjectPage';
import { DeploysPage } from '../pages/deploys/DeploysPage';
import { DeployPage } from '../pages/deploys/DeployPage';
import { getLastWorkspaceId } from '../api/lastWorkspace';
import { Shell } from './Shell';
import { RequireSession } from './gates';

function HomeRedirect() {
  const last = getLastWorkspaceId();
  return <Navigate to={last ? `/w/${last}` : '/workspaces'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route element={<RequireSession />}>
        <Route element={<Shell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="w/:workspaceId" element={<WorkspaceLayout />}>
            <Route index element={<WorkspaceHomePage />} />
            <Route path="servers" element={<ServersPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectPage />} />
            <Route path="deploys" element={<DeploysPage />} />
            <Route path="deploys/:deploymentId" element={<DeployPage />} />
          </Route>
          <Route path="join" element={<JoinPage />} />
          <Route path="join/:workspaceId/:token" element={<JoinPage />} />
          {import.meta.env.DEV && <Route path="kit" element={<KitPage />} />}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
