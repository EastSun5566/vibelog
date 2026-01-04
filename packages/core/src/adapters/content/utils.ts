export function removeFirstH1IfMatchesTitle(markdown: string, title?: string) {
  if (!title) return markdown;

  const h1Regex = /^#\s+(.+)$/m;
  const match = h1Regex.exec(markdown);
  if (match) {
    const h1Text = match[1];
    if (h1Text === title) {
      return markdown
        .replace(h1Regex, '')
        .replace(/^\n+/, '');
    }
  }

  return markdown;
}
