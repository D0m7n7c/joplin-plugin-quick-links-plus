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
import { parseOutline, OutlineEntry } from './noteParser';
import { generateUniqueAnchorId, buildAnchorHtml } from './anchorId';

const SECTION = 'quickLinksPlus';
const EDITOR_CONTENT_SCRIPT_ID = 'quickLinksPlusEditor';
const VIEWER_CONTENT_SCRIPT_ID = 'quickLinksPlusViewer';

const S_ID_LENGTH = 'idLength';
const S_SELECT_TEXT = 'selectText';
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

interface FolderMap { [id: string]: string; }
let folderCache: FolderMap = {};

async function setting<T>(key: string): Promise<T> {
	return (await joplin.settings.value(key)) as T;
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
	const folders: FolderMap = {};
	const query: any = { fields: ['id', 'title'], page: 1 };
	let result = await joplin.data.get(['folders'], query);
	result.items.forEach((f: any) => { folders[f.id] = f.title; });
	while (result.has_more) {
		query.page += 1;
		result = await joplin.data.get(['folders'], query);
		result.items.forEach((f: any) => { folders[f.id] = f.title; });
	}
	folderCache = folders;
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

function buildOutlineItems(notes: any[], query: string): OutlineItem[] {
	const needle = sanitizeSearch(query).toLowerCase();
	const ranked: { item: OutlineItem; rank: number; order: number }[] = [];
	let order = 0;

	for (const note of notes) {
		const notebook = folderCache[note.parent_id] || '';
		const titleMatches = needle !== '' && String(note.title || '').toLowerCase().includes(needle);
		const outline: OutlineEntry[] = parseOutline(note.body || '');

		for (const entry of outline) {
			const textLower = entry.text.toLowerCase();
			const inText = needle !== '' && textLower.includes(needle);
			const inCrumb = needle !== '' && entry.breadcrumb.some(b => b.toLowerCase().includes(needle));

			// Include an entry when: no query, the entry (or its path) matches, or
			// the note title matches (then show all of that note's targets).
			if (needle !== '' && !inText && !inCrumb && !titleMatches) continue;

			let rank: number;
			if (needle === '') rank = 5;
			else if (textLower === needle) rank = 0;      // exact heading/anchor text
			else if (textLower.startsWith(needle)) rank = 1; // prefix
			else if (inText) rank = 2;                    // contains
			else if (inCrumb) rank = 3;                   // matched via a parent heading
			else rank = 4;                                // matched only via note title

			ranked.push({
				item: {
					noteId: note.id,
					noteTitle: note.title,
					notebook,
					kind: entry.kind,
					text: entry.text,
					anchor: entry.anchor,
					linkText: entry.linkText,
					pathParts: entry.breadcrumb,
				},
				rank,
				order: order++,
			});

			if (ranked.length >= OUTLINE_COLLECT_CAP) break;
		}
		if (ranked.length >= OUTLINE_COLLECT_CAP) break;
	}

	// Best matches first; ties keep their original (search-relevance, then
	// document) order. This also decides which note section appears first.
	ranked.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));
	return ranked.slice(0, OUTLINE_RESULT_LIMIT).map(r => r.item);
}

// --- message handlers ------------------------------------------------------

async function handleEditorMessage(message: any): Promise<any> {
	try {
		const selectText = await setting<boolean>(S_SELECT_TEXT);

		if (message.command === 'getNotes') {
			const showNotebook = await setting<boolean>(S_SHOW_NOTEBOOK);
			const activeNoteId = (await joplin.workspace.selectedNoteIds())[0];
			const q = sanitizeSearch(message.query || '').toLowerCase();
			let notes = (await searchNotesByTitle(message.query || ''))
				.filter((n: any) => n.id !== activeNoteId);

			// Sort by title relevance: exact, then prefix, then contains, then the
			// rest; ties by shorter title, then more recently updated. Empty query
			// keeps the "recently updated first" order from the query.
			if (q !== '') {
				const rankOf = (title: string): number => {
					const t = String(title || '').toLowerCase();
					if (t === q) return 0;
					if (t.startsWith(q)) return 1;
					if (t.includes(q)) return 2;
					return 3;
				};
				notes = notes
					.map((n: any, i: number) => ({ n, i }))
					.sort((a: any, b: any) =>
						rankOf(a.n.title) - rankOf(b.n.title)
						|| String(a.n.title || '').length - String(b.n.title || '').length
						|| (b.n.updated_time || 0) - (a.n.updated_time || 0)
						|| a.i - b.i)
					.map((x: any) => x.n);
			}

			const result = notes.map((n: any) => ({ id: n.id, title: n.title, folder: folderCache[n.parent_id] }));
			return { notes: result, selectText, showNotebook };
		}

		if (message.command === 'getHeadings') {
			if (!(await setting<boolean>(S_ENABLE_HEADINGS))) return { disabled: true };
			const showNotebook = await setting<boolean>(S_SHOW_NOTEBOOK);
			const notes = await notesForOutline(message.query || '');
			return { items: buildOutlineItems(notes, message.query || ''), selectText, showNotebook };
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
			description: 'How long the "Copied!" confirmation stays visible after clicking a § mark.',
		},
		[S_SELECT_TEXT]: {
			public: true,
			section: SECTION,
			type: SettingItemType.Bool,
			value: false,
			label: 'Select link text after inserting',
			description: 'After inserting a link, select the visible link text (inside the square brackets) so you can immediately type your own wording.',
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
			label: 'Show copy marks (§) next to headings and anchors in the viewer',
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
