import type { AdfDocument, AdfNode, AdfMark } from "./types.js";

// ─── ADF → Markdown ─────────────────────────────────────────────────────────

export function adfToMarkdown(doc: AdfDocument | string | null | undefined): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  if (!doc.content) return "";
  return doc.content.map((node) => convertNode(node)).join("");
}

function convertNode(node: AdfNode, listDepth = 0): string {
  switch (node.type) {
    case "paragraph":
      return convertInlineContent(node.content) + "\n\n";

    case "heading": {
      const level = (node.attrs?.level as number) ?? 1;
      const prefix = "#".repeat(Math.min(level, 6));
      return `${prefix} ${convertInlineContent(node.content)}\n\n`;
    }

    case "text":
      return applyMarks(node.text ?? "", node.marks);

    case "hardBreak":
      return "\n";

    case "rule":
      return "---\n\n";

    case "bulletList":
      return (
        (node.content ?? [])
          .map((item) => convertListItem(item, listDepth, "- "))
          .join("") + (listDepth === 0 ? "\n" : "")
      );

    case "orderedList":
      return (
        (node.content ?? [])
          .map((item, i) => convertListItem(item, listDepth, `${i + 1}. `))
          .join("") + (listDepth === 0 ? "\n" : "")
      );

    case "listItem":
      return (node.content ?? []).map((c) => convertNode(c, listDepth)).join("");

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = (node.content ?? []).map((c) => c.text ?? "").join("");
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    case "blockquote": {
      const inner = (node.content ?? []).map((c) => convertNode(c, listDepth)).join("");
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n") + "\n\n";
    }

    case "table":
      return convertTable(node);

    case "mediaGroup":
    case "mediaSingle":
      return "[media attachment]\n\n";

    case "inlineCard": {
      const url = node.attrs?.url as string;
      return url ? `[${url}](${url})` : "";
    }

    case "mention": {
      const mentionText = node.attrs?.text as string;
      return mentionText ?? "@unknown";
    }

    case "emoji": {
      const shortName = node.attrs?.shortName as string;
      return shortName ?? "";
    }

    case "panel": {
      const panelType = (node.attrs?.panelType as string) ?? "info";
      const inner = (node.content ?? []).map((c) => convertNode(c, listDepth)).join("");
      return `> **${panelType.toUpperCase()}**: ${inner.trim()}\n\n`;
    }

    default:
      if (node.content) {
        return node.content.map((c) => convertNode(c, listDepth)).join("");
      }
      return node.text ?? "";
  }
}

function convertListItem(node: AdfNode, depth: number, prefix: string): string {
  const indent = "  ".repeat(depth);
  const children = (node.content ?? [])
    .map((child, i) => {
      if (child.type === "bulletList" || child.type === "orderedList") {
        return convertNode(child, depth + 1);
      }
      const text = convertNode(child, depth);
      return i === 0 ? `${indent}${prefix}${text.trimEnd()}\n` : text;
    })
    .join("");
  return children;
}

function convertInlineContent(nodes?: AdfNode[]): string {
  if (!nodes) return "";
  return nodes.map((n) => convertNode(n)).join("");
}

function applyMarks(text: string, marks?: AdfMark[]): string {
  if (!marks || marks.length === 0) return text;
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        result = `**${result}**`;
        break;
      case "em":
        result = `*${result}*`;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "link": {
        const href = mark.attrs?.href as string;
        if (href) result = `[${result}](${href})`;
        break;
      }
      case "subsup": {
        const subType = mark.attrs?.type as string;
        if (subType === "sub") result = `~${result}~`;
        else result = `^${result}^`;
        break;
      }
    }
  }
  return result;
}

function convertTable(node: AdfNode): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";

  const matrix: string[][] = rows.map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((c) => convertNode(c).trim())
        .join(" ")
        .replace(/\|/g, "\\|")
    )
  );

  if (matrix.length === 0) return "";

  const colCount = Math.max(...matrix.map((r) => r.length));
  const normalized = matrix.map((r) => {
    while (r.length < colCount) r.push("");
    return r;
  });

  const headerRow = `| ${normalized[0].join(" | ")} |`;
  const separator = `| ${normalized[0].map(() => "---").join(" | ")} |`;
  const bodyRows = normalized
    .slice(1)
    .map((r) => `| ${r.join(" | ")} |`)
    .join("\n");

  return `${headerRow}\n${separator}\n${bodyRows}\n\n`;
}

// ─── Markdown → ADF ─────────────────────────────────────────────────────────

export function markdownToAdf(markdown: string): AdfDocument {
  const lines = markdown.split("\n");
  const content: AdfNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: [{ type: "text", text: codeLines.join("\n") }],
      });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|_{3,}|\*{3,})$/.test(line.trim())) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInlineMarkdown(quoteLines.join("\n")),
          },
        ],
      });
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        const text = lines[i].replace(/^[\s]*[-*+]\s/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(text) }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^[\s]*\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^[\s]*\d+\.\s/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineMarkdown(text) }],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") &&
      !/^[\s]*[-*+]\s/.test(lines[i]) &&
      !/^[\s]*\d+\.\s/.test(lines[i]) &&
      !/^(-{3,}|_{3,}|\*{3,})$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({
        type: "paragraph",
        content: parseInlineMarkdown(paraLines.join("\n")),
      });
    }
  }

  return { version: 1, type: "doc", content };
}

function parseInlineMarkdown(text: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  // Regex to match: **bold**, *italic*, ~~strike~~, `code`, [text](url)
  const regex =
    /(\*\*(.+?)\*\*|\*(.+?)\*|~~(.+?)~~|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
    } else if (match[3]) {
      nodes.push({ type: "text", text: match[3], marks: [{ type: "em" }] });
    } else if (match[4]) {
      nodes.push({ type: "text", text: match[4], marks: [{ type: "strike" }] });
    } else if (match[5]) {
      nodes.push({ type: "text", text: match[5], marks: [{ type: "code" }] });
    } else if (match[6] && match[7]) {
      nodes.push({
        type: "text",
        text: match[6],
        marks: [{ type: "link", attrs: { href: match[7] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  if (nodes.length === 0) {
    nodes.push({ type: "text", text });
  }

  return nodes;
}
