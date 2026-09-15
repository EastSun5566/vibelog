export function markdownText(value) {
  return String(value)
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[\\[\]()*_`#<>]/gu, "\\$&");
}
