import { SiteBuilder, StyleTransformer } from './core';
import {
  // FsProvider,
  HackMdProvider,
} from './adapters/content';
import { OllamaProvider } from './adapters/ai';

async function main() {
  // const contentProvider = new FsProvider('./.content');
  const contentProvider = new HackMdProvider('EastSun5566');
  const aiProvider = new OllamaProvider('qwen2.5-coder:3b');

  const transformer = new StyleTransformer(
    'Create a modern theme with dark blue accent colors and subtle green undertones',
    aiProvider,
  );

  const builder = new SiteBuilder(
    {
      tempDir: '.temp',
      outDir: './dist',
    },
    contentProvider,
    transformer,
  );

  try {
    await builder.build({
      skipStyleTransform: false,
    });
  } finally {
    await builder.cleanup();
  }
}

main().catch(() => void 0);
