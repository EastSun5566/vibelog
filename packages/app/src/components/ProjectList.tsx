import type { FC } from 'hono/jsx';
import { Layout } from './Layout.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Project list page component
 * Displays all projects with their status and actions
 */
export const ProjectList: FC = async () => {
  const projectsRoot = resolve(process.cwd(), 'projects');
  const projects = [];

  // Check if projects directory exists
  if (existsSync(projectsRoot)) {
    const { readdir, stat } = await import('node:fs/promises');
    const entries = await readdir(projectsRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const projectPath = resolve(projectsRoot, entry.name);
        const vibelogDir = resolve(projectPath, '.vibelog');
        const distDir = resolve(projectPath, 'dist');
        const stats = await stat(projectPath);

        projects.push({
          id: entry.name,
          name: entry.name,
          hasVibelog: existsSync(vibelogDir),
          hasBuilt: existsSync(distDir),
          createdAt: stats.birthtime.toISOString(),
        });
      }
    }
  }

  return (
    <Layout title="Projects - VibeLog">
      <h2>Projects</h2>
      <p>Manage your blog projects</p>

      {projects.length === 0 ? (
        <section>
          <p><em>No projects yet</em></p>
          <p>
            <a href="/projects/new">Create Your First Project</a>
          </p>
        </section>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.name}</strong>
                  </td>
                  <td>
                    {project.hasVibelog && (
                      <span class="status-badge status-info">Initialized</span>
                    )}
                    {project.hasBuilt && (
                      <span class="status-badge status-success">Built</span>
                    )}
                    {!project.hasVibelog && (
                      <span class="status-badge status-warning">Not Ready</span>
                    )}
                  </td>
                  <td>{new Date(project.createdAt).toLocaleDateString()}</td>
                  <td>
                    <a href={`/projects/${project.id}`}>View</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            <a href="/projects/new">New Project</a>
          </p>
        </>
      )}
    </Layout>
  );
};
