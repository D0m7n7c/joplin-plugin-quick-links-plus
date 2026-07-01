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

const NOTE_RESULT_LIMIT = 21;
const OUTLINE_NOTE_LIMIT = 30;
const OUTLINE_RESULT_LIMIT = 60;
const RECENT_NOTE_LIMIT = 15;
const FOLDERS_REFRESH_INTERVAL = 60000;

interface FolderMap { [id: string]: string; }
let folderCache: FolderMap = {};

async function setting<T>(key: string): Promise<T> {
	return (await joplin.settings.value(key)) as T;
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
	if (prefix.trim() === '') {
		const res = await joplin.data.get(['notes'], {
			fields: ['id', 'title', 'parent_id'],
			order_by: 'updated_time',
			order_dir: 'DESC',
			limit: NOTE_RESULT_LIMIT,
		});
		return res.items;
	}
	const res = await joplin.data.get(['search'], {
		fields: ['id', 'title', 'parent_id'],
		limit: NOTE_RESULT_LIMIT,
		query: `title:${prefix.trim()}*`,
	});
	return res.items;
}

async function notesForOutline(query: string): Promise<any[]> {
	if (query.trim() === '') {
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
		query: query.trim(),
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
	const needle = query.trim().toLowerCase();
	const items: OutlineItem[] = [];

	for (const note of notes) {
		const notebook = folderCache[note.parent_id] || '';
		const outline: OutlineEntry[] = parseOutline(note.body || '');
		for (const entry of outline) {
			const haystack = [entry.text, ...entry.breadcrumb, note.title]
				.join(' ')
				.toLowerCase();
			if (needle !== '' && !haystack.includes(needle)) continue;

			items.push({
				noteId: note.id,
				noteTitle: note.title,
				notebook,
				kind: entry.kind,
				text: entry.text,
				anchor: entry.anchor,
				linkText: entry.linkText,
				pathParts: entry.breadcrumb,
			});

			if (items.length >= OUTLINE_RESULT_LIMIT) return items;
		}
	}
	return items;
}

// --- message handlers ------------------------------------------------------

async function handleEditorMessage(message: any): Promise<any> {
	const selectText = await setting<boolean>(S_SELECT_TEXT);

	if (message.command === 'getNotes') {
		const showNotebook = await setting<boolean>(S_SHOW_NOTEBOOK);
		const activeNoteId = (await joplin.workspace.selectedNoteIds())[0];
		const notes = await searchNotesByTitle(message.query || '');
		const result = notes
			.filter((n: any) => n.id !== activeNoteId)
			.map((n: any) => ({ id: n.id, title: n.title, folder: folderCache[n.parent_id] }));
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

	return {};
}

async function handleViewerMessage(message: any): Promise<any> {
	if (message.command === 'getConfig') {
		return { enabled: await setting<boolean>(S_ENABLE_COPY_MARKS) };
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
		try {
			await (joplin as any).clipboard.writeText(link);
			return { ok: true, link };
		} catch (e) {
			return { ok: false, link };
		}
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
			label: 'Anchor id length',
			description: 'Number of characters in ids generated by "@@id".',
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
