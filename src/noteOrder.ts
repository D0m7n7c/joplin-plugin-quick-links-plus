// noteOrder.ts
//
// Pure ordering helpers for the "@@" note list. Kept free of Joplin APIs so the
// logic can be unit-tested on its own.

export interface PinnableNote {
	updated_time?: number;
}

export interface OrderedNote<T> {
	note: T;
	// True only for a pinned note that should be shown with the "recent" marker.
	recent: boolean;
}

// Moves the `pinCount` most recently edited notes to the top of an already
// sorted list and keeps the rest in their original order.
//
// The marker is a contrast between "pinned" and "sorted by context", so it is
// only set when at least one note remains below the pinned ones. When every
// note is pinned (or nothing is), the list is plain recency or plain context
// order and no note is marked.
export function pinRecent<T extends PinnableNote>(sorted: T[], pinCount: number): OrderedNote<T>[] {
	const count = Math.max(0, Math.floor(Number(pinCount) || 0));
	if (count === 0 || sorted.length === 0) {
		return sorted.map(note => ({ note, recent: false }));
	}

	// Most recently edited first; ties keep their position in the sorted list.
	const byRecency = sorted
		.map((note, index) => ({ note, index }))
		.sort((a, b) => (b.note.updated_time || 0) - (a.note.updated_time || 0) || a.index - b.index);

	const pinnedIdx = new Set(byRecency.slice(0, count).map(x => x.index));
	const pinned = byRecency.slice(0, count).map(x => x.note);
	const rest = sorted.filter((_note, index) => !pinnedIdx.has(index));

	const mark = rest.length > 0;
	return [
		...pinned.map(note => ({ note, recent: mark })),
		...rest.map(note => ({ note, recent: false })),
	];
}
