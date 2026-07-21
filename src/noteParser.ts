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
	// Human-readable text shown in the completion popup (capped for anchors).
	text: string;
	// Full, uncapped text used for matching the user's query. For headings this
	// equals `text`; for anchors it is the whole normalized content before the
	// anchor, so a long anchor can be found by its beginning as well.
	searchText: string;
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

const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;
const QUOTE_PREFIX_RE = /^\s*>\s?/;
const TABLE_ROW_RE = /^\s*\|/;
const LABEL_MAX = 55;

// Keep the end of the label — the part nearest the anchor, which is what the
// anchor points at — cut on a word boundary, with a leading ellipsis. Short and
// single-line, so the popup never has to truncate it. The "what it's about"
// context is already carried by the note's section header and the grey path, so
// the label can focus entirely on the anchor's immediate surroundings.
function capLabel(text: string): string {
	if (text.length <= LABEL_MAX) return text;
	const from = text.length - LABEL_MAX;
	const space = text.indexOf(' ', from);
	const tail = (space >= 0 && space < text.length - 1 ? text.slice(space + 1) : text.slice(from)).trimStart();
	return `… ${tail}`;
}

// Label for an inline anchor: the anchor's own line up to the anchor, with the
// container marker removed (list bullet, quote '>', or the enclosing table
// cell). Line-scoped on purpose: Joplin renders soft newlines as <br>, and the
// viewer's copy mark cuts at the last <br>, so staying on the source line keeps
// the editor and the viewer consistent across every container type.
function anchorLabelFor(line: string, anchorIndex: number, minStart = 0): string {
	let segment: string;

	if (TABLE_ROW_RE.test(line)) {
		// Text of the table cell that contains the anchor, up to the anchor.
		let cellStart = 0;
		for (let k = 0; k < anchorIndex; k++) {
			if (line[k] === '|' && line[k - 1] !== '\\') cellStart = k + 1;
		}
		segment = line.slice(Math.max(cellStart, minStart), anchorIndex);
	} else {
		segment = line.slice(minStart, anchorIndex).replace(QUOTE_PREFIX_RE, '');
		const marker = LIST_MARKER_RE.exec(segment);
		if (marker) segment = segment.slice(marker[0].length);
	}

	return stripInlineMarkdown(segment);
}

// Display window around a query match inside a long text, like a search-result
// snippet: whatever part the user typed is always visible, with context on both
// sides, cut on word boundaries and marked with ellipses. Falls back to the
// plain end-cap when there is no match position.
export function matchWindow(fullText: string, matchIndex: number, matchLength: number): string {
	if (fullText.length <= LABEL_MAX) return fullText;
	if (matchIndex < 0 || matchIndex >= fullText.length) return capLabel(fullText);

	const spare = Math.max(0, LABEL_MAX - matchLength);
	let start = Math.max(0, matchIndex - Math.floor(spare * 0.3));
	let end = Math.min(fullText.length, start + LABEL_MAX);
	if (end === fullText.length) start = Math.max(0, end - LABEL_MAX);

	// Snap to word boundaries without ever cutting into the match itself.
	if (start > 0) {
		const space = fullText.indexOf(' ', start);
		if (space >= 0 && space < matchIndex) start = space + 1;
	}
	if (end < fullText.length) {
		const space = fullText.lastIndexOf(' ', end);
		if (space > matchIndex + matchLength) end = space;
	}

	const head = start > 0 ? '… ' : '';
	const tail = end < fullText.length ? ' …' : '';
	return `${head}${fullText.slice(start, end).trim()}${tail}`;
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
				searchText: text,
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
		let previousAnchorEnd = 0;
		while ((anchorMatch = ANCHOR_RE.exec(line)) !== null) {
			const id = anchorMatch[1];
			const full = anchorLabelFor(line, anchorMatch.index, previousAnchorEnd);
			const capped = capLabel(full);
			previousAnchorEnd = anchorMatch.index + anchorMatch[0].length;
			const parentHeading = headingStack.length ? headingStack[headingStack.length - 1].text : '';
			entries.push({
				kind: 'anchor',
				text: capped || id,
				searchText: full || id,
				level: 0,
				anchor: id,
				linkText: capped || parentHeading || id,
				breadcrumb: headingStack.map(h => h.text),
			});
		}
	}

	return entries;
}
