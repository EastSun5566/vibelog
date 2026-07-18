const DANGEROUS_SCHEME = /\]\(\s*(?:javascript|vbscript|data):/gi;

export function sanitizeMarkdown(markdown: string): string {
  let fenced = false;
  return markdown.replaceAll('\0', '').split('\n').map((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(DANGEROUS_SCHEME, '](about:blank#blocked-');
  }).join('\n');
}
