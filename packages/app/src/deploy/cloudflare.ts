import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Cloudflare Pages deployment configuration
 */
export interface CloudflarePagesConfig {
  accountId: string;
  apiToken: string;
  projectName: string;
  branch?: string;
}

/**
 * Deployment result
 */
export interface DeploymentResult {
  success: boolean;
  url: string;
  deploymentId: string;
  environment: string;
  error?: string;
}

/**
 * Get all files in a directory recursively
 */
async function getAllFiles(dir: string, baseDir: string = dir): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      for (const [path, content] of subFiles) {
        files.set(path, content);
      }
    } else {
      const relativePath = relative(baseDir, fullPath);
      const content = await readFile(fullPath);
      files.set(relativePath, content);
    }
  }

  return files;
}

/**
 * Deploy to Cloudflare Pages using Direct Upload API
 *
 * @see https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
 */
export async function deployToCloudflarePages(
  distDir: string,
  config: CloudflarePagesConfig,
): Promise<DeploymentResult> {
  const { accountId, apiToken, projectName, branch = 'main' } = config;

  try {
    // Step 1: Get all files from dist directory
    const files = await getAllFiles(distDir);

    // Step 2: Create manifest of files with hashes
    const manifest: Record<string, string> = {};
    for (const [path] of files) {
      // Use relative path as hash placeholder (Cloudflare will compute actual hash)
      manifest[`/${path}`] = path;
    }

    // Step 3: Create deployment
    const createDeploymentResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          branch,
          manifest,
        }),
      },
    );

    if (!createDeploymentResponse.ok) {
      const errorText = await createDeploymentResponse.text();
      throw new Error(`Failed to create deployment: ${errorText}`);
    }

    const deploymentData = await createDeploymentResponse.json() as {
      result: {
        id: string;
        url: string;
        environment: string;
        upload_url?: string;
      };
    };

    const { id: deploymentId, url: deploymentUrl, environment } = deploymentData.result;

    // Step 4: Upload files if upload_url is provided
    if (deploymentData.result.upload_url) {
      const formData = new FormData();

      for (const [path, content] of files) {
        const blob = new Blob([content]);
        formData.append(path, blob, path);
      }

      const uploadResponse = await fetch(deploymentData.result.upload_url, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Failed to upload files: ${await uploadResponse.text()}`);
      }
    }

    return {
      success: true,
      url: deploymentUrl,
      deploymentId,
      environment,
    };
  } catch (error) {
    return {
      success: false,
      url: '',
      deploymentId: '',
      environment: '',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * List deployments for a Cloudflare Pages project
 */
export async function listCloudflareDeployments(
  accountId: string,
  apiToken: string,
  projectName: string,
): Promise<{
  id: string;
  url: string;
  environment: string;
  createdOn: string;
  productionBranch: boolean;
}[]> {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to list deployments: ${await response.text()}`);
    }

    const data = await response.json() as {
      result: {
        id: string;
        url: string;
        environment: string;
        created_on: string;
        production_branch: boolean;
      }[];
    };

    return data.result.map((deployment) => ({
      id: deployment.id,
      url: deployment.url,
      environment: deployment.environment,
      createdOn: deployment.created_on,
      productionBranch: deployment.production_branch,
    }));
  } catch (error) {
    console.error('Failed to list deployments:', error);
    return [];
  }
}
