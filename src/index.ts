import { SiteBuilder, StyleTransformer, logger } from './core';
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
    `Create a modern, minimalist design with:
      - chill dark blue, relaxing green, and calming white colors`,
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
    await builder.prepare();
    await builder.build();
  } finally {
    await builder.cleanup();
  }
}

// eslint-disable-next-line @typescript-eslint/unbound-method
main().catch(logger.error);
