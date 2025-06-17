# Content Structure

Learn how to organize your content for VibeLog, whether using local files or external sources.

## File System Content (`fs@<path>`)

When using local content with `fs@./content`, organize your files as follows:

### Directory Structure

```text
content/
├── blog/           # Blog posts (required)
│   ├── post1.md
│   ├── post2.md
│   └── post3.md
└── author.md       # Author profile (required)
```

### Blog Posts

Blog posts should be placed in the `blog/` directory as Markdown files.

#### Frontmatter

Each blog post should include frontmatter with metadata:

```yaml
---
title: "Your Post Title"
date: "2024-01-15"
slug: "custom-url-slug" # optional, defaults to filename
---
# Your Post Title

Your post content here...
```

#### Supported Fields

- `title` (required) - The post title
- `date` (required) - Publication date in YYYY-MM-DD format
- `slug` (optional) - Custom URL slug, defaults to filename without .md

#### Example Post

```markdown
---
title: "Getting Started with VibeLog"
date: "2024-01-15"
slug: "getting-started"
---

# Getting Started with VibeLog

Welcome to VibeLog! This is your first blog post.

## What is VibeLog?

VibeLog transforms any content source into a production-ready blog...
```

### Author Profile

Create an `author.md` file in the content root with your profile information:

```yaml
---
name: "Your Name"
bio: "Short bio description" # optional, can use content instead
---
This is your longer bio description that supports **Markdown formatting**.

You can include multiple paragraphs, links, and other Markdown elements.
```

#### Author Fields

- `name` (required) - Your display name
- `bio` (optional) - Short bio, alternative to using content body

The content body supports full Markdown and will be used as the bio if the `bio` field is not provided.

## HackMD Content (`hackmd@<username>`)

When using HackMD as your content source, VibeLog automatically fetches your public notes.

### Requirements

- HackMD account with public notes
- Notes must be published with "View" permission
- Notes with publication dates are treated as blog posts

### How It Works

1. VibeLog fetches your HackMD profile and notes
2. Only published notes (with "View" permission) are included
3. Note titles become post titles
4. Publication dates become post dates
5. Content is automatically processed to remove duplicate H1 headers

### HackMD Profile

Your HackMD profile information is automatically used:

- **User accounts**: Display name and biography
- **Team accounts**: Team name and description

### Note Organization

- All published notes become blog posts
- Notes are sorted by publication date
- Private or unpublished notes are ignored
- Note permalinks are preserved when available

## Content Processing

### Markdown Support

VibeLog supports standard Markdown syntax:

- Headers (H1-H6)
- **Bold** and _italic_ text
- Lists (ordered and unordered)
- Links and images
- Code blocks and inline code
- Tables
- Blockquotes

### Image Handling

- Images are copied to the public directory during build
- Relative paths are preserved and resolved correctly
- External images (HTTP/HTTPS) are kept as-is

### Code Syntax Highlighting

Code blocks support syntax highlighting for many languages:

```javascript
// JavaScript example
const greeting = "Hello, VibeLog!";
console.log(greeting);
```

```python
# Python example
def greet():
    print("Hello, VibeLog!")
```

## Content Guidelines

### Writing Tips

1. **Clear Titles**: Use descriptive, SEO-friendly titles
2. **Consistent Dates**: Use YYYY-MM-DD format for dates
3. **Readable URLs**: Create meaningful slugs for better URLs
4. **Image Optimization**: Compress images for faster loading

### SEO Best Practices

- Include relevant keywords in titles and content
- Write meta descriptions (coming soon)
- Use proper heading hierarchy (H1 → H2 → H3)
- Add alt text to images

### Content Organization

- Group related posts by topic or series
- Use consistent naming conventions
- Include publication dates for chronological ordering
- Write engaging introductions and conclusions

## Migration from Other Platforms

### From Jekyll/GitHub Pages

1. Copy your `_posts` directory to `content/blog/`
2. Update frontmatter format if needed
3. Create an `author.md` file with your profile

### From WordPress

1. Export content as Markdown
2. Place files in `content/blog/`
3. Update image paths to relative paths
4. Create author profile

### From Medium/Other Platforms

1. Export or copy content as Markdown
2. Add proper frontmatter to each post
3. Download and organize images locally
4. Set up author profile

## Advanced Features

### Custom Content Sources

VibeLog is designed to be extensible. Additional content sources can be added to support:

- Notion databases
- Contentful
- Strapi
- Ghost
- Custom APIs

Contact the maintainers or contribute if you need support for additional content sources.
