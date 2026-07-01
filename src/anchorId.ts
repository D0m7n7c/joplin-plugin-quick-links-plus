// anchorId.ts
//
// Generates short, note-unique anchor ids for the "@@id" feature. An id starts
// with a letter (so it is a valid CSS selector and HTML id) followed by
// lower-case alphanumeric characters.

import { parseOutline } from './noteParser';

const FIRST_CHARS = 'abcdefghijklmnopqrstuvwxyz';
const REST_CHARS = FIRST_CHARS + '0123456789';

function pick(chars: string): string {
	return chars[Math.floor(Math.random() * chars.length)];
}

// Build a random id of the requested length (minimum 2).
export function randomAnchorId(length: number): string {
	const len = Math.max(2, Math.floor(length) || 0);
	let out = pick(FIRST_CHARS);
	for (let i = 1; i < len; i++) out += pick(REST_CHARS);
	return out;
}

// Collect every identifier that already occupies the note's anchor namespace:
// explicit id="" / name="" attributes plus the slugs generated for headings.
export function collectUsedIds(body: string): Set<string> {
	const used = new Set<string>();

	const attrRe = /\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
	let match: RegExpExecArray | null;
	while ((match = attrRe.exec(body || '')) !== null) {
		used.add(match[1]);
	}

	for (const entry of parseOutline(body || '')) {
		if (entry.kind === 'heading') used.add(entry.anchor);
	}

	return used;
}

// Generate an anchor id that does not collide with anything already used in the
// given note body.
export function generateUniqueAnchorId(body: string, length: number): string {
	const used = collectUsedIds(body);
	let candidate = randomAnchorId(length);
	let guard = 0;
	while (used.has(candidate) && guard < 1000) {
		candidate = randomAnchorId(length);
		guard++;
	}
	return candidate;
}

// Wrap an id in the empty anchor element that gets inserted into the note.
export function buildAnchorHtml(id: string): string {
	return `<a id="${id}"></a>`;
}
