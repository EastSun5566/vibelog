// Example: Using @vibelog/core library programmatically
import { 
  createDevBuilder, 
  createContentSource, 
  buildFromVibelog,
  ContentSourceName 
} from '@vibelog/core';

async function buildMyBlog() {
  // 1. Create content source
  const contentSource = createContentSource(
    ContentSourceName.FS,
    './content'
  );

  // 2. Create dev builder
  const builder = createDevBuilder({
    root: './my-blog',
    contentSource,
    baseDir: process.cwd(),
  });

  // 3. Prepare and fetch content
  await builder.prepare();
  await builder.fetchContent();

  // 4. Build production site
  await buildFromVibelog({
    vibelogDir: builder.vibelogDir,
    outDir: './my-blog/dist',
    site: 'https://myblog.com',
  });

  console.log('✅ Blog built successfully!');
}

buildMyBlog().catch(console.error);
