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
- Notes must be published with "View" mode
- Notes with publication dates are treated as blog posts

### How It Works

1. VibeLog fetches your HackMD profile and notes
2. Only published notes (with "View" mode) are included
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

---

> More Content Sources will be supported...
