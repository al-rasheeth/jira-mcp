/**
 * Standard tool response: single text (TOON) content.
 * Use everywhere tools return content to avoid repeating the same structure.
 */
export function textContent(
  text: string,
  options?: { isError?: boolean }
): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const content: Array<{ type: "text"; text: string }> = [
    { type: "text" as const, text },
  ];
  if (options?.isError) {
    return { content, isError: true };
  }
  return { content };
}
