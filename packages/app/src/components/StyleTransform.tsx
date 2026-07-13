import type { FC } from 'hono/jsx';
import { Layout } from './Layout.js';

/**
 * Style transformation page
 * Allows users to transform blog styles using AI
 */
export const StyleTransform: FC<{ projectId: string }> = ({ projectId }) => {
  return (
    <Layout title={`Style Transform - ${projectId} - VibeLog`}>
      <h2>🎨 Transform Styles for {projectId}</h2>
      <p>Use AI to modify your blog's appearance with natural language</p>

      <form action={`/api/projects/${projectId}/style`} method="post">
        <fieldset>
          <label for="prompt">Style Prompt</label>
          <textarea
            id="prompt"
            name="prompt"
            rows={4}
            placeholder="e.g., Make it look more modern with a gradient background and rounded corners"
            required
          />

          <label for="aiProviderType">AI Provider</label>
          <select id="aiProviderType" name="aiProvider.type" required>
            <option value="">Select provider...</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="google">Google</option>
            <option value="ollama">Ollama (Local)</option>
          </select>

          <label for="aiProviderModel">Model</label>
          <input
            type="text"
            id="aiProviderModel"
            name="aiProvider.model"
            placeholder="e.g., gpt-4o-mini, claude-3-5-sonnet-20241022"
            required
          />

          <button type="submit">Transform Styles</button>
          <a href={`/projects/${projectId}`}>Cancel</a>
        </fieldset>
      </form>

      <section>
        <h3>Examples</h3>
        <ul>
          <li><strong>Modern gradient:</strong> "Add a purple to blue gradient background and modern card designs"</li>
          <li><strong>Minimalist:</strong> "Make it ultra minimalist with lots of white space and subtle shadows"</li>
          <li><strong>Dark theme:</strong> "Transform to a dark theme with neon accent colors"</li>
          <li><strong>Retro:</strong> "Give it a retro 80s vaporwave aesthetic with pink and cyan colors"</li>
        </ul>
      </section>

      <section>
        <h3>Model Recommendations</h3>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Best For</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>OpenAI</td>
              <td>gpt-4o-mini</td>
              <td>Fast and cost-effective</td>
            </tr>
            <tr>
              <td>Anthropic</td>
              <td>claude-3-5-sonnet-20241022</td>
              <td>High quality, creative designs</td>
            </tr>
            <tr>
              <td>Google</td>
              <td>gemini-1.5-flash</td>
              <td>Fast responses</td>
            </tr>
            <tr>
              <td>Ollama</td>
              <td>llama3.2</td>
              <td>Privacy, runs locally</td>
            </tr>
          </tbody>
        </table>
      </section>

      <blockquote>
        <strong>Note:</strong> Make sure you have the required API keys set in your environment variables
        (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) or Ollama running locally.
      </blockquote>

      <p>
        <a href={`/projects/${projectId}`}>Back to Project</a>
      </p>
    </Layout>
  );
};
