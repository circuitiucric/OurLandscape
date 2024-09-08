// src/utils/hyperlinkParser.ts

export function parseHyperlinks(
  text: string
): { fileName: string; pageNumber: number } | null {
  const regex = /#《(.+?)》\s*P(\d+)#/;
  const match = text.match(regex);

  if (match) {
    const fileName = match[1];
    const pageNumber = parseInt(match[2], 10);
    return { fileName, pageNumber };
  }

  return null;
}
