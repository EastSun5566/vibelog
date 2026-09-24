const HEX = /^#[0-9a-f]{6}$/i;

function channel(value: string): number {
  const normalized = Number.parseInt(value, 16) / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string): number {
  if (!HEX.test(foreground) || !HEX.test(background)) throw new Error('Contrast colors must be six-digit hex values');
  const luminance = (color: string) => {
    const red = channel(color.slice(1, 3));
    const green = channel(color.slice(3, 5));
    const blue = channel(color.slice(5, 7));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
