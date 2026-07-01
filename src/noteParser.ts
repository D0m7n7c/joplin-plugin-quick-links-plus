// noteParser.ts
//
// Pure, dependency-free helpers that turn a note's Markdown body into a flat
// outline of headings and inline anchors. Used by the main plugin to answer
// "@@#" completion queries and to compute the set of anchor ids already in use.
//
// The module has no Joplin imports so it can be unit-tested in isolation.

export type OutlineKind = 'heading' | 'anchor';

export interface OutlineEntry {
	kind: OutlineKind;
	// Human-readable text shown in the completion popup.
	text: string;
	// Heading level 1..6; 0 for inline anchors.
	level: number;
	// Fragment used to build the link target ":/<noteId>#<anchor>".
	// For headings this is the generated slug, for anchors the literal id.
	anchor: string;
	// Suggested text for the inserted Markdown link "[linkText](...)".
	linkText: string;
	// Ancestor heading texts (the "super-titles") from outermost to innermost.
	breadcrumb: string[];
}

// ATX heading, e.g. "## Title" with optional trailing hashes.
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
// Fenced code block delimiter.
const FENCE_RE = /^(```|~~~)/;
// Inline anchor such as <a id="abc"></a> or <a name="abc">.
const ANCHOR_RE = /<a\b[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi;

// Slugify a heading the way Joplin generates in-document anchors: lower-cased,
// punctuation stripped, whitespace collapsed to single hyphens. Unicode letters
// and numbers are preserved.
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}\s-]/gu, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
}

// Reproduces Joplin's duplicate-slug handling: the first occurrence keeps the
// plain slug, later identical slugs get "-1", "-2", ... appended.
function makeUniqueSlugger(): (raw: string) => string {
	const seen = new Map<string, number>();
	return (raw: string): string => {
		const base = slugify(raw);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${count}`;
	};
}

// Remove the most common inline Markdown/HTML so the displayed text and slug
// are based on the rendered heading, not the raw source.
function stripInlineMarkdown(text: string): string {
	return text
		.replace(/<[^>]+>/g, '')
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_`~]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

// Parse a Markdown body into an ordered list of headings and inline anchors.
export function parseOutline(body: string): OutlineEntry[] {
	const lines = (body || '').split(/\r?\n/);
	const entries: OutlineEntry[] = [];
	const slugger = makeUniqueSlugger();
	const headingStack: { level: number; text: string }[] = [];
	let inFence = false;

	const breadcrumbFor = (level: number): string[] =>
		headingStack.filter(h => h.level < level).map(h => h.text);

	for (const line of lines) {
		if (FENCE_RE.test(line.trim())) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const heading = HEADING_RE.exec(line);
		if (heading) {
			const level = heading[1].length;
			const text = stripInlineMarkdown(heading[2]);
			const anchor = slugger(text);

			entries.push({
				kind: 'heading',
				text,
				level,
				anchor,
				linkText: text,
				breadcrumb: breadcrumbFor(level),
			});

			// Keep the ancestor stack in sync with the heading hierarchy.
			while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
				headingStack.pop();
			}
			headingStack.push({ level, text });
			continue;
		}

		// A single line may contain several inline anchors.
		ANCHOR_RE.lastIndex = 0;
		let anchorMatch: RegExpExecArray | null;
		while ((anchorMatch = ANCHOR_RE.exec(line)) !== null) {
			const id = anchorMatch[1];
			const before = stripInlineMarkdown(line.slice(0, anchorMatch.index));
			const parentHeading = headingStack.length ? headingStack[headingStack.length - 1].text : '';
			entries.push({
				kind: 'anchor',
				text: before || id,
				level: 0,
				anchor: id,
				linkText: before || parentHeading || id,
				breadcrumb: headingStack.map(h => h.text),
			});
		}
	}

	return entries;
}
