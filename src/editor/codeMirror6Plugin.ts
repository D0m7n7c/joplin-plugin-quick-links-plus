// editor/codeMirror6Plugin.ts
//
// Provides the autocompletion source that powers the three triggers:
//   @@<text>   link to a note            -> [Title](:/<noteId>)
//   @@#<text>  link to a heading/anchor  -> [Text](:/<noteId>#<anchor>)
//   @@id       insert a new anchor       -> <a id="<generated>"></a>
//
// The @codemirror packages are required dynamically (not imported) so the build
// does not bundle them and older Joplin versions keep working.

import type * as CodeMirrorAutocompleteType from '@codemirror/autocomplete';
import type * as CodeMirrorStateType from '@codemirror/state';
import type * as CodeMirrorViewType from '@codemirror/view';

import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

import { PluginContext } from './types';

export default function codeMirror6Plugin(pluginContext: PluginContext, CodeMirror: any) {
	const { autocompletion, insertCompletionText, acceptCompletion } =
		require('@codemirror/autocomplete') as typeof CodeMirrorAutocompleteType;
	const { EditorSelection, Prec } = require('@codemirror/state') as typeof CodeMirrorStateType;
	const { keymap } = require('@codemirror/view') as typeof CodeMirrorViewType;

	// Set for the duration of a Shift+Tab / Shift+Enter accept so the option's
	// apply knows to also select the inserted "[link text]".
	let selectRequested = false;

	const insertText = (view: EditorView, text: string, from: number, to: number) => {
		view.dispatch(insertCompletionText(view.state, text, from, to));
	};

	// A non-applying placeholder row. Returning it instead of an empty option list
	// keeps the popup open when there are currently no matches, so that CodeMirror
	// keeps re-querying on every edit — including when the user deletes a typo,
	// which would otherwise leave the (closed) popup shut.
	const keepOpenHint = (label: string): Completion => ({
		label,
		apply: () => { /* no-op */ },
	});

	// Select the "[link text]" portion right after inserting so it can be typed
	// over immediately. `from` is the position of the leading "@@".
	const selectLinkText = (view: EditorView, from: number, linkText: string) => {
		const start = from + 1; // skip the "["
		const end = start + linkText.length;
		view.dispatch({ selection: EditorSelection.range(start, end) });
	};

	const complete = async (context: CompletionContext): Promise<CompletionResult | null> => {
		// Start on "@@", then take any characters that are not link/punctuation
		// delimiters. This keeps the trigger active while typing multi-word
		// heading queries.
		const prefix = context.matchBefore(/@@[^()\[\]{};:>,\n]*/);
		if (!prefix || (prefix.from === prefix.to && !context.explicit)) return null;

		const rest = prefix.text.substring(2);

		// ----- @@id : insert a freshly generated, note-unique anchor -----------
		if (rest === 'id') {
			const docText = context.state.doc.toString();
			const response = await pluginContext.postMessage({ command: 'generateAnchor', docText });
			if (!response || response.disabled || !response.html) return null;

			const html: string = response.html;
			return {
				from: prefix.from,
				filter: false,
				options: [{
					label: html,
					detail: 'Insert anchor',
					apply: (view: EditorView, _c: Completion, from: number, to: number) => {
						insertText(view, html, from, to);
					},
				}],
			};
		}

		// Turns outline results (headings and anchors) into completion options.
		// Shared by the plain "@@#" search and both trailing-slash modes.
		const outlineOptions = (response: any): Completion[] => {
			const items: any[] = response.items || [];
			const sectionByNote = new Map<string, any>();
			let nextRank = 0;

			// The ancestor path shown on the right, ordered from the nearest heading
			// out to the top. Keeps the immediate parent and the outermost heading,
			// dropping the middle when the chain is long.
			const pathDetail = (parts: string[]): string => {
				if (!parts || parts.length === 0) return '';
				if (parts.length <= 2) return parts.slice().reverse().join(' › ');
				return `${parts[parts.length - 1]} › … › ${parts[0]}`;
			};

			const options: Completion[] = items.map((item: any) => {
				let section = sectionByNote.get(item.noteId);
				if (!section) {
					const headerText = (response.showNotebook && item.notebook)
						? `${item.noteTitle}  ›  ${item.notebook}`
						: item.noteTitle;
					section = {
						name: item.noteId,
						rank: nextRank++,
						header: () => {
							const el = document.createElement('div');
							el.className = 'qlp-note-header';
							el.style.display = 'list-item';
							el.textContent = headerText;
							return el;
						},
					};
					sectionByNote.set(item.noteId, section);
				}

				const label = item.kind === 'anchor' ? `# ${item.text}` : item.text;
				return {
					label,
					detail: pathDetail(item.pathParts) || undefined,
					section,
					apply: (view: EditorView, _c: Completion, from: number, to: number) => {
						const link = `[${item.linkText}](:/${item.noteId}#${item.anchor})`;
						insertText(view, link, from, to);
						if (selectRequested) selectLinkText(view, from, String(item.linkText));
					},
				};
			});

			return options;
		};

		// ----- @@# : link to a heading or inline anchor across all notes -------
		// A trailing slash means "go into what I just named": "@@#Chapter/" lists
		// what is nested under a heading called "Chapter" instead of matching the
		// heading itself.
		if (rest.startsWith('#')) {
			const raw = rest.substring(1);
			const deeper = raw.endsWith('/') && raw.length > 1;
			const query = deeper ? raw.slice(0, -1) : raw;
			const response = await pluginContext.postMessage({
				command: 'getHeadings',
				query,
				mode: deeper ? 'under' : 'name',
			});
			if (!response || response.disabled) return null;

			const options = outlineOptions(response);
			if (options.length === 0) {
				options.push(keepOpenHint(deeper
					? 'No deeper targets — delete the slash'
					: 'No matches found — delete the last character'));
			}
			return { from: prefix.from, filter: false, options };
		}

		// ----- @@<note>/ : the headings and anchors inside a matching note -----
		// Same "go one level deeper" idea, one level up: when the note is known
		// but its headings are not. Falls through to the note search when the
		// heading feature is switched off.
		if (rest.endsWith('/') && rest.length > 1) {
			const query = rest.slice(0, -1);
			const response = await pluginContext.postMessage({
				command: 'getHeadings',
				query,
				mode: 'inNote',
			});
			if (response && !response.disabled) {
				const options = outlineOptions(response);
				if (options.length === 0) options.push(keepOpenHint('No deeper targets — delete the slash'));
				return { from: prefix.from, filter: false, options };
			}
		}

		// ----- @@ : link to a note --------------------------------------------
		const response = await pluginContext.postMessage({ command: 'getNotes', query: rest });
		const options: Completion[] = (response.notes || []).map((note: any) => ({
			label: note.title,
			detail: response.showNotebook ? `In ${note.folder ?? 'unknown'}` : undefined,
			apply: (view: EditorView, _c: Completion, from: number, to: number) => {
				const link = `[${note.title}](:/${note.id})`;
				insertText(view, link, from, to);
				if (selectRequested) selectLinkText(view, from, String(note.title));
			},
		}));
		if (options.length === 0 && rest.length > 0) options.push(keepOpenHint('No matches found — delete the last character'));
		return { from: prefix.from, filter: false, options };
	};

	let extension: Extension;
	if (CodeMirror.joplinExtensions) {
		extension = CodeMirror.joplinExtensions.completionSource(complete);
	} else {
		// Fallback when the Joplin autocomplete helper is unavailable.
		extension = autocompletion({ override: [complete] });
	}

	// Tab accepts the highlighted suggestion, exactly like Enter. Shift+Tab and
	// Shift+Enter accept it too, but additionally select the "[link text]" so it
	// can be typed over immediately. acceptCompletion runs the option's apply
	// synchronously, so a flag set around it tells apply whether to select; the
	// flag is read inside the apply functions above. All bindings only act while
	// the popup is open (acceptCompletion returns false otherwise) and fall
	// through to the editor's normal Tab / Enter behaviour when it is closed.
	const acceptAndSelect = (view: EditorView): boolean => {
		selectRequested = true;
		try {
			return acceptCompletion(view);
		} finally {
			selectRequested = false;
		}
	};

	const completionKeys = Prec.highest(keymap.of([
		{ key: 'Tab', run: acceptCompletion },
		{ key: 'Shift-Tab', run: acceptAndSelect },
		{ key: 'Shift-Enter', run: acceptAndSelect },
	]));

	CodeMirror.addExtension([
		extension,
		autocompletion({ tooltipClass: () => 'quick-links-plus-completions' }),
		completionKeys,
	]);
}
