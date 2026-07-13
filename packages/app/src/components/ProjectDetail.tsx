import type { FC } from 'hono/jsx';
import { Layout } from './Layout.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Project detail page component
 * Shows project information and available actions (build, preview, style, deploy)
 */
export const ProjectDetail: FC<{ projectId: string }> = async ({ projectId }) => {
  const projectRoot = resolve(process.cwd(), 'projects', projectId);
  const vibelogDir = resolve(projectRoot, '.vibelog');
  const distDir = resolve(projectRoot, 'dist');

  // Check if project exists
  if (!existsSync(projectRoot)) {
    return (
      <Layout title="Project Not Found - VibeLog">
        <blockquote>
          <strong>Error:</strong> Project "{projectId}" not found
        </blockquote>
        <p>
          <a href="/projects">Back to Projects</a>
        </p>
      </Layout>
    );
  }

  const hasVibelog = existsSync(vibelogDir);
  const hasBuilt = existsSync(distDir);
  const canPreview = hasBuilt;

  // Get project stats
  const { stat } = await import('node:fs/promises');
  const stats = await stat(projectRoot);

  return (
    <Layout title={`${projectId} - VibeLog`}>
      <h2>{projectId}</h2>
      <p>Created on {new Date(stats.birthtime).toLocaleDateString()}</p>

      <p>
        {hasVibelog && <span class="status-badge status-info">Initialized</span>}
        {hasBuilt && <span class="status-badge status-success">Built</span>}
        {canPreview && <span class="status-badge status-success">Preview Ready</span>}
      </p>

      <hr />

      <h3>Actions</h3>

      {/* Build */}
      <section>
        <h4>🔨 Build</h4>
        <p>Generate static site from content</p>
        <form action={`/api/projects/${projectId}/build`} method="post">
          <input
            type="text"
            name="siteUrl"
            placeholder="https://example.com"
          />
          <button type="submit" disabled={!hasVibelog}>
            Build Site
          </button>
        </form>
      </section>

      {/* Preview */}
      <section>
        <h4>👀 Preview</h4>
        <p>View your built site locally</p>
        {canPreview ? (
          <a href={`/preview/${projectId}/`} target="_blank">
            Open Preview
          </a>
        ) : (
          <button disabled>Build First</button>
        )}
      </section>

      {/* Style */}
      <section>
        <h4>🎨 Style Transform</h4>
        <p>Use AI to modify your blog's appearance</p>
        <a href={`/projects/${projectId}/style`} disabled={!hasVibelog}>
          Transform Styles
        </a>
      </section>

      {/* Deploy */}
      <section>
        <h4>🚀 Deploy</h4>
        <p>Publish to Cloudflare Pages</p>
        <a href={`/projects/${projectId}/deploy`} disabled={!hasBuilt}>
          Deploy Site
        </a>
      </section>

      <hr />

      <h3>Danger Zone</h3>
      <form action={`/api/projects/${projectId}`} method="post">
        <input type="hidden" name="_method" value="DELETE" />
        <button
          type="submit"
          onclick="return confirm('Are you sure? This will delete all project files.')"
        >
          ⚠️ Delete Project
        </button>
      </form>

      <p>
        <a href="/projects">Back to Projects</a>
      </p>
    </Layout>
  );
};
