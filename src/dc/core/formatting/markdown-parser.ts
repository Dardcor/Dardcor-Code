/**
 * Dardcor Code - Lightweight Markdown Parser (Task 88)
 * Mirrors: vs/base/common/htmlContent.ts markdown rendering
 */

export interface IMarkdownNode {
	type: 'heading' | 'paragraph' | 'code' | 'codeblock' | 'list' | 'listitem' | 'bold' | 'italic' | 'link' | 'image' | 'text' | 'hr' | 'blockquote';
	content?: string;
	children?: IMarkdownNode[];
	level?: number;  // for headings
	language?: string; // for codeblocks
	href?: string;   // for links
	alt?: string;    // for images
	ordered?: boolean; // for lists
}

export function parseMarkdown(source: string): IMarkdownNode[] {
	const lines = source.split('\n');
	const nodes: IMarkdownNode[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Empty line
		if (line.trim() === '') { i++; continue; }

		// Heading
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			nodes.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
			i++; continue;
		}

		// HR
		if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
			nodes.push({ type: 'hr' });
			i++; continue;
		}

		// Code block
		if (line.trim().startsWith('```')) {
			const lang = line.trim().substring(3).trim();
			const codeLines: string[] = [];
			i++;
			while (i < lines.length && !lines[i].trim().startsWith('```')) {
				codeLines.push(lines[i]);
				i++;
			}
			nodes.push({ type: 'codeblock', content: codeLines.join('\n'), language: lang || undefined });
			i++; continue;
		}

		// Blockquote
		if (line.startsWith('> ')) {
			const quoteLines: string[] = [];
			while (i < lines.length && lines[i].startsWith('> ')) {
				quoteLines.push(lines[i].substring(2));
				i++;
			}
			nodes.push({ type: 'blockquote', content: quoteLines.join('\n') });
			continue;
		}

		// Unordered list
		if (/^\s*[-*+]\s/.test(line)) {
			const items: IMarkdownNode[] = [];
			while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
				items.push({ type: 'listitem', content: lines[i].replace(/^\s*[-*+]\s/, '') });
				i++;
			}
			nodes.push({ type: 'list', children: items, ordered: false });
			continue;
		}

		// Ordered list
		if (/^\s*\d+\.\s/.test(line)) {
			const items: IMarkdownNode[] = [];
			while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
				items.push({ type: 'listitem', content: lines[i].replace(/^\s*\d+\.\s/, '') });
				i++;
			}
			nodes.push({ type: 'list', children: items, ordered: true });
			continue;
		}

		// Paragraph (default)
		nodes.push({ type: 'paragraph', content: line });
		i++;
	}

	return nodes;
}

export function parseInlineMarkdown(text: string): IMarkdownNode[] {
	const nodes: IMarkdownNode[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		// Bold **text** or __text__
		const boldMatch = remaining.match(/^\*\*(.+?)\*\*|^__(.+?)__/);
		if (boldMatch) {
			nodes.push({ type: 'bold', content: boldMatch[1] || boldMatch[2] });
			remaining = remaining.substring(boldMatch[0].length);
			continue;
		}

		// Italic *text* or _text_
		const italicMatch = remaining.match(/^\*(.+?)\*|^_(.+?)_/);
		if (italicMatch) {
			nodes.push({ type: 'italic', content: italicMatch[1] || italicMatch[2] });
			remaining = remaining.substring(italicMatch[0].length);
			continue;
		}

		// Inline code `text`
		const codeMatch = remaining.match(/^`(.+?)`/);
		if (codeMatch) {
			nodes.push({ type: 'code', content: codeMatch[1] });
			remaining = remaining.substring(codeMatch[0].length);
			continue;
		}

		// Link [text](url)
		const linkMatch = remaining.match(/^\[(.+?)\]\((.+?)\)/);
		if (linkMatch) {
			nodes.push({ type: 'link', content: linkMatch[1], href: linkMatch[2] });
			remaining = remaining.substring(linkMatch[0].length);
			continue;
		}

		// Image ![alt](url)
		const imgMatch = remaining.match(/^!\[(.+?)\]\((.+?)\)/);
		if (imgMatch) {
			nodes.push({ type: 'image', alt: imgMatch[1], href: imgMatch[2] });
			remaining = remaining.substring(imgMatch[0].length);
			continue;
		}

		// Plain text (single char)
		nodes.push({ type: 'text', content: remaining[0] });
		remaining = remaining.substring(1);
	}

	// Merge adjacent text nodes
	const merged: IMarkdownNode[] = [];
	for (const node of nodes) {
		const last = merged[merged.length - 1];
		if (last && last.type === 'text' && node.type === 'text') {
			last.content = (last.content || '') + (node.content || '');
		} else {
			merged.push(node);
		}
	}

	return merged;
}
