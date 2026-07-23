// index.ts
//
// Quick Links Plus — main plugin process.
//
// Registers two content scripts:
//   * an editor (CodeMirror 6) script that drives the "@@", "@@#" and "@@id"
//     autocompletions, and
//   * a viewer (Markdown-It) script that adds clickable "copy link" marks next
//     to headings and inline anchors in the rendered note.
//
// All data access (search, parsing, id generation) happens here; the content
// scripts only render UI and forward requests through postMessage.

import joplin from 'api';
import { ContentScriptType, SettingItemType } from 'api/types';
import { parseOutline, matchWindow, OutlineEntry } from './noteParser';
import { generateUniqueAnchorId, buildAnchorHtml } from './anchorId';
import { ParentMap, contextRing } from './notebookTree';

const SECTION = 'quickLinksPlus';
const EDITOR_CONTENT_SCRIPT_ID = 'quickLinksPlusEditor';
const VIEWER_CONTENT_SCRIPT_ID = 'quickLinksPlusViewer';

const S_ID_LENGTH = 'idLength';
const S_SHOW_NOTEBOOK = 'showNotebook';
const S_ENABLE_HEADINGS = 'enableHeadingSearch';
const S_ENABLE_ANCHOR_GEN = 'enableAnchorGenerator';
const S_ENABLE_COPY_MARKS = 'enableCopyMarks';
const S_COPIED_DURATION = 'copiedDurationMs';

const NOTE_RESULT_LIMIT = 21;
const OUTLINE_NOTE_LIMIT = 30;
const OUTLINE_RESULT_LIMIT = 60;
const OUTLINE_COLLECT_CAP = 600;
const RECENT_NOTE_LIMIT = 15;
const FOLDERS_REFRESH_INTERVAL = 60000;
const CONTEXT_CAP = 2; // rings: 0 = own subtree, 1 = parent's area, 2 = far

interface FolderMap { [id: string]: string; }
let folderCache: FolderMap = {};
let folderParent: ParentMap = {};

async function setting<T>(key: string): Promise<T> {
	return (await joplin.settings.value(key)) as T;
}

async function currentFolderId(): Promise<string> {
	const note = await joplin.workspace.selectedNote();
	return note ? (note.parent_id || '') : '';
}

// Match quality of a candidate text against the query: 0 exact, 1 prefix,
// 2 contains, 3 no direct match.
function matchTier(text: string, needle: string): number {
	if (needle === '') return 3;
	const t = String(text || '').toLowerCase();
	if (t === needle) return 0;
	if (t.startsWith(needle)) return 1;
	if (t.includes(needle)) return 2;
	return 3;
}

// Remove characters that have special meaning in Joplin's search syntax so a
// half-typed query (e.g. an unbalanced quote or a stray "*") can never produce
// a malformed query that throws.
function sanitizeSearch(raw: string): string {
	return (raw || '')
		.replace(/["*:()\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// --- data access -----------------------------------------------------------

async function refreshFolderCache(): Promise<void> {
	const titles: FolderMap = {};
	const parents: ParentMap = {};
	const query: any = { fields: ['id', 'title', 'parent_id'], page: 1 };
	const take = (items: any[]) => items.forEach((f: any) => {
		titles[f.id] = f.title;
		parents[f.id] = f.parent_id || '';
	});
	let result = await joplin.data.get(['folders'], query);
	take(result.items);
	while (result.has_more) {
		query.page += 1;
		result = await joplin.data.get(['folders'], query);
		take(result.items);
	}
	folderCache = titles;
	folderParent = parents;
}

async function searchNotesByTitle(prefix: string): Promise<any[]> {
	const clean = sanitizeSearch(prefix);
	if (clean === '') {
		const res = await joplin.data.get(['notes'], {
			fields: ['id', 'title', 'parent_id', 'updated_time'],
			order_by: 'updated_time',
			order_dir: 'DESC',
			limit: NOTE_RESULT_LIMIT,
		});
		return res.items;
	}
	const res = await joplin.data.get(['search'], {
		fields: ['id', 'title', 'parent_id', 'updated_time'],
		limit: NOTE_RESULT_LIMIT,
		query: `title:${clean}*`,
	});
	return res.items;
}

async function notesForOutline(query: string): Promise<any[]> {
	const clean = sanitizeSearch(query);
	if (clean === '') {
		const res = await joplin.data.get(['notes'], {
			fields: ['id', 'title', 'body', 'parent_id'],
			order_by: 'updated_time',
			order_dir: 'DESC',
			limit: RECENT_NOTE_LIMIT,
		});
		return res.items;
	}
	const res = await joplin.data.get(['search'], {
		fields: ['id', 'title', 'body', 'parent_id'],
		limit: OUTLINE_NOTE_LIMIT,
		query: clean,
	});
	return res.items;
}

// --- "@@#" outline items ---------------------------------------------------

interface OutlineItem {
	noteId: string;
	noteTitle: string;
	notebook: string;
	kind: string;
	text: string;
	anchor: string;
	linkText: string;
	pathParts: string[];
}

// How an entry qualifies for the result list:
//   'name'   — "@@#text": the entry's own heading/anchor text matches.
//   'under'  — "@@#text/": the entry sits below a heading whose name matches.
//   'inNote' — "@@text/": the entry sits in a note whose title matches.
// The trailing slash means "go into what I just named", so the two deeper modes
// are only ever reached deliberately and cannot flood a plain name search.
type OutlineMode = 'name' | 'under' | 'inNote';

function buildOutlineItems(notes: any[], query: string, curFolder: string, mode: OutlineMode = 'name'): OutlineItem[] {
	const needle = sanitizeSearch(query).toLowerCase();
	// Without a query there is nothing to go "into", so the deeper modes fall
	// back to the plain listing rather than returning nothing.
	const effectiveMode: OutlineMode = needle === '' ? 'name' : mode;
	const ranked: { item: OutlineItem; ring: number; rank: number; order: number }[] = [];
	let order = 0;

	for (const note of notes) {
		const notebook = folderCache[note.parent_id] || '';
		const ring = contextRing(folderParent, curFolder, note.parent_id || '', CONTEXT_CAP);
		const titleMatches = needle !== '' && String(note.title || '').toLowerCase().includes(needle);
		// "@@text/" targets the contents of matching notes, so notes whose title
		// does not match contribute nothing at all.
		if (effectiveMode === 'inNote' && !titleMatches) continue;
		const outline: OutlineEntry[] = parseOutline(note.body || '');

		for (const entry of outline) {
			// Match against the FULL text (searchText), so a long anchor is found by
			// its beginning too, not only by the capped end that gets inserted.
			const searchLower = entry.searchText.toLowerCase();
			const matchIndex = needle !== '' ? searchLower.indexOf(needle) : -1;
			const inText = matchIndex >= 0;
			const inCrumb = needle !== '' && entry.breadcrumb.some(b => b.toLowerCase().includes(needle));

			if (needle !== '') {
				// A plain name search shows only entries that carry the query in
				// their own text; ancestors and note titles no longer pull in
				// unrelated targets. The deeper modes invert that deliberately.
				if (effectiveMode === 'name' && !inText) continue;
				if (effectiveMode === 'under' && !inCrumb) continue;
			}

			let rank: number;
			if (needle === '') rank = 5;
			else if (effectiveMode !== 'name') rank = 4;  // deeper modes: document order
			else if (searchLower === needle) rank = 0;    // exact heading/anchor text
			else if (matchIndex === 0) rank = 1;          // prefix
			else rank = 2;                                // contains

			// Display like a search snippet: the typed match is always visible, with
			// context and ellipses around it. Without a text match, the default
			// (end-capped) label is shown. The INSERTED linkText stays the stable
			// end-cap regardless of how the entry was found.
			const displayText = inText ? matchWindow(entry.searchText, matchIndex, needle.length) : entry.text;

			ranked.push({
				item: {
					noteId: note.id,
					noteTitle: note.title,
					notebook,
					kind: entry.kind,
					text: displayText,
					anchor: entry.anchor,
					linkText: entry.linkText,
					pathParts: entry.breadcrumb,
				},
				ring,
				rank,
				order: order++,
			});

			if (ranked.length >= OUTLINE_COLLECT_CAP) break;
		}
		if (ranked.length >= OUTLINE_COLLECT_CAP) break;
	}

	// Context ring first (strict), then match quality, then original order. A note
	// lives in one notebook, so all its entries share a ring and never split
	// across the grouped sections in the editor.
	ranked.sort((a, b) => (a.ring - b.ring) || (a.rank - b.rank) || (a.order - b.order));
	const items = ranked.slice(0, OUTLINE_RESULT_LIMIT).map(r => r.item);
	return items;
}

// --- message handlers ------------------------------------------------------

async function handleEditorMessage(message: any): Promise<any> {
	try {
		if (message.command === 'getNotes') {
			const showNotebook = await setting<boolean>(S_SHOW_NOTEBOOK);
			const activeNoteId = (await joplin.workspace.selectedNoteIds())[0];
			const curFolder = await currentFolderId();
			const q = sanitizeSearch(message.query || '').toLowerCase();
			const notes = (await searchNotesByTitle(message.query || ''))
				.filter((n: any) => n.id !== activeNoteId);

			// Context ring first (strict), then title relevance (exact, prefix,
			// contains), then more recently updated. Empty query -> ring, then the
			// "recently updated first" order carried by the index.
			const sorted = notes
				.map((n: any, i: number) => ({ n, i, ring: contextRing(folderParent, curFolder, n.parent_id || '', CONTEXT_CAP) }))
				.sort((a: any, b: any) =>
					a.ring - b.ring
					|| matchTier(a.n.title, q) - matchTier(b.n.title, q)
					|| (b.n.updated_time || 0) - (a.n.updated_time || 0)
					|| a.i - b.i)
				.map((x: any) => x.n);

			const result = sorted.map((n: any) => ({ id: n.id, title: n.title, folder: folderCache[n.parent_id] }));
			return { notes: result, showNotebook };
		}

		if (message.command === 'getHeadings') {
			if (!(await setting<boolean>(S_ENABLE_HEADINGS))) return { disabled: true };
			const showNotebook = await setting<boolean>(S_SHOW_NOTEBOOK);
			const curFolder = await currentFolderId();
			const mode: OutlineMode =
				message.mode === 'under' || message.mode === 'inNote' ? message.mode : 'name';
			const notes = await notesForOutline(message.query || '');
			return { items: buildOutlineItems(notes, message.query || '', curFolder, mode), showNotebook };
		}

		if (message.command === 'generateAnchor') {
			if (!(await setting<boolean>(S_ENABLE_ANCHOR_GEN))) return { disabled: true };
			const length = await setting<number>(S_ID_LENGTH);
			let body: string = message.docText;
			if (typeof body !== 'string') {
				const note = await joplin.workspace.selectedNote();
				body = note ? note.body : '';
			}
			const id = generateUniqueAnchorId(body, length);
			return { html: buildAnchorHtml(id) };
		}
	} catch (error) {
		console.warn('Quick Links Plus: editor message failed', error);
		// Return empty (but valid) results so the completion popup stays usable.
		if (message && message.command === 'getHeadings') return { items: [] };
		if (message && message.command === 'getNotes') return { notes: [] };
	}
	return {};
}

async function handleViewerMessage(message: any): Promise<any> {
	try {
		if (message.command === 'getConfig') {
			return {
				enabled: await setting<boolean>(S_ENABLE_COPY_MARKS),
				copiedDurationMs: await setting<number>(S_COPIED_DURATION),
			};
		}
		if (message.command === 'getNoteId') {
			const ids = await joplin.workspace.selectedNoteIds();
			return { noteId: ids[0] || '' };
		}
		if (message.command === 'copyLink') {
			// Resolve the current note here (not in the viewer) and copy via Joplin's
			// clipboard API, which works reliably from the plugin main process.
			const note = await joplin.workspace.selectedNote();
			const noteId = note ? note.id : '';
			const label = (message.label && String(message.label).trim()) || String(message.anchor || '');
			const link = `[${label}](:/${noteId}#${message.anchor})`;
			await (joplin as any).clipboard.writeText(link);
			return { ok: true, link };
		}
	} catch (error) {
		console.warn('Quick Links Plus: viewer message failed', error);
		if (message && message.command === 'copyLink') return { ok: false };
		if (message && message.command === 'getConfig') return { enabled: true, copiedDurationMs: 900 };
	}
	return {};
}

// --- settings --------------------------------------------------------------

async function registerSettings(): Promise<void> {
	await joplin.settings.registerSection(SECTION, {
		label: 'Quick Links Plus',
		description: 'Settings for the Quick Links Plus plugin.',
		iconName: 'fas fa-link',
	});

	await joplin.settings.registerSettings({
		[S_ID_LENGTH]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Int,
			value: 6,
			minimum: 3,
			maximum: 32,
			step: 1,
			advanced: true,
			label: 'Anchor id length',
			description: 'Number of characters in ids generated by "@@id".',
		},
		[S_COPIED_DURATION]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Int,
			value: 900,
			minimum: 200,
			maximum: 5000,
			step: 100,
			advanced: true,
			label: "'Copied!' message duration (ms)",
			description: 'How long the "Copied!" confirmation stays visible after clicking the chain link icon.',
		},
		[S_SHOW_NOTEBOOK]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Bool,
			value: true,
			label: 'Show notebook name',
			description: 'Show the notebook next to note results (@@) and in the note header of heading / anchor results (@@#).',
		},
		[S_ENABLE_HEADINGS]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Bool,
			value: true,
			label: 'Enable heading / anchor search ("@@#")',
		},
		[S_ENABLE_ANCHOR_GEN]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Bool,
			value: true,
			label: 'Enable anchor id generator ("@@id")',
		},
		[S_ENABLE_COPY_MARKS]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Bool,
			value: true,
			label: 'Show copy marks (chain link icon) next to headings and anchors in the viewer',
		},
	});
}

// --- entry point -----------------------------------------------------------

joplin.plugins.register({
	onStart: async function () {
		await registerSettings();

		await refreshFolderCache();
		const scheduleFolderRefresh = () => {
			setTimeout(async () => {
				try { await refreshFolderCache(); } catch (e) { /* ignore */ }
				scheduleFolderRefresh();
			}, FOLDERS_REFRESH_INTERVAL);
		};
		scheduleFolderRefresh();

		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			EDITOR_CONTENT_SCRIPT_ID,
			'./editor/index.js',
		);
		await joplin.contentScripts.onMessage(EDITOR_CONTENT_SCRIPT_ID, handleEditorMessage);

		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			VIEWER_CONTENT_SCRIPT_ID,
			'./viewer/index.js',
		);
		await joplin.contentScripts.onMessage(VIEWER_CONTENT_SCRIPT_ID, handleViewerMessage);
	},
});
