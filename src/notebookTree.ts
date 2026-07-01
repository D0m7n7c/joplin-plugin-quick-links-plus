// notebookTree.ts
//
// Pure notebook-tree helpers for the "context bias" ranking. Operates on a plain
// map of folderId -> parentId (root folders map to '' or are missing). No Joplin
// imports, so it can be unit-tested in isolation.
//
// The "context ring" of a candidate notebook, seen from the current notebook, is
// how many levels you climb from the current notebook up to the lowest common
// ancestor of the two — capped. Ring 0 is the current notebook's own subtree
// (itself and its descendants), ring 1 is the parent's subtree, and so on, with
// everything at/above the cap collapsed into a single "far" tier.

export type ParentMap = { [id: string]: string };

// Ancestor chain from a folder up to and including the virtual root marker ''.
function ancestors(parentOf: ParentMap, id: string): string[] {
	const chain: string[] = [];
	const seen = new Set<string>();
	let cur: string | undefined = id;
	let guard = 0;
	while (cur !== undefined && cur !== '' && !seen.has(cur) && guard++ < 1000) {
		chain.push(cur);
		seen.add(cur);
		cur = parentOf[cur];
	}
	chain.push(''); // virtual root shared by everything
	return chain;
}

// depth('') = 0 (virtual root), root folders = 1, each level below adds 1.
export function depth(parentOf: ParentMap, id: string): number {
	return ancestors(parentOf, id).length - 1;
}

// Lowest common ancestor of two folders (may be the virtual root '').
export function lca(parentOf: ParentMap, a: string, b: string): string {
	const chainA = new Set(ancestors(parentOf, a));
	for (const node of ancestors(parentOf, b)) {
		if (chainA.has(node)) return node;
	}
	return '';
}

// Context ring of `candidate` seen from `current`, capped at `cap`.
export function contextRing(parentOf: ParentMap, current: string, candidate: string, cap: number): number {
	if (!current) return cap; // no current notebook -> everything equally far
	const climbed = depth(parentOf, current) - depth(parentOf, lca(parentOf, current, candidate));
	const ring = climbed < 0 ? 0 : climbed;
	return ring > cap ? cap : ring;
}
