import matter from 'gray-matter';

function rejectJavaScript(): never {
  throw new Error('JavaScript front matter is not supported');
}

// A front-matter header can override the default language, even during stringify.
const options = { engines: { javascript: { parse: rejectJavaScript, stringify: rejectJavaScript } } };

export function parseFrontMatter(content: string) {
  return matter(content, options);
}

export function stringifyFrontMatter(content: string, data: object): string {
  return matter.stringify(content, data, options);
}
