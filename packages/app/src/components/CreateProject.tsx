import type { FC } from 'hono/jsx';
import { Layout } from './Layout';

/**
 * Create project form page
 * Allows users to create a new blog project from various content sources
 */
export const CreateProject: FC = () => {
  return (
    <Layout title="New Project - VibeLog">
      <h2>Create New Project</h2>
      <p>Initialize a new blog from your content source</p>

      <form action="/api/projects" method="post">
        <fieldset>
          <label for="projectName">Project Name</label>
          <input
            type="text"
            id="projectName"
            name="projectName"
            placeholder="my-awesome-blog"
            required
          />

          <label for="contentSourceType">Content Source Type</label>
          <select id="contentSourceType" name="contentSource.type" required>
            <option value="">Select a source...</option>
            <option value="fs">File System</option>
            <option value="notion">Notion</option>
            <option value="hackmd">HackMD</option>
          </select>

          <label for="contentSourceHandle">
            Content Source Handle
            <br />
            <small>(Path for FS, Database ID for Notion, Team path for HackMD)</small>
          </label>
          <input
            type="text"
            id="contentSourceHandle"
            name="contentSource.handle"
            placeholder="./content or @team/content"
            required
          />

          <button type="submit">Create Project</button>
          <a href="/projects">Cancel</a>
        </fieldset>
      </form>

      <section>
        <h3>Examples</h3>
        <ul>
          <li><strong>File System:</strong> ./content or /absolute/path/to/content</li>
          <li><strong>Notion:</strong> Your database ID from Notion workspace</li>
          <li><strong>HackMD:</strong> @team/content-folder-path</li>
        </ul>
      </section>
    </Layout>
  );
};
