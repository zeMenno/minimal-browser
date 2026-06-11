import type { LayoutNode, LeafNode, SplitNode, SplitSide } from "./types";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function leaves(node: LayoutNode | null): LeafNode[] {
  if (!node) return [];
  if (node.type === "leaf") return [node];
  return node.children.flatMap(leaves);
}

export function findLeafByTab(node: LayoutNode | null, tabId: string): LeafNode | null {
  return leaves(node).find((l) => l.tabId === tabId) ?? null;
}

export function findLeaf(node: LayoutNode | null, leafId: string): LeafNode | null {
  return leaves(node).find((l) => l.id === leafId) ?? null;
}

/** Immutably replace the node with the given id using fn. */
export function updateNode(
  root: LayoutNode,
  id: string,
  fn: (node: LayoutNode) => LayoutNode
): LayoutNode {
  if (root.id === id) return fn(root);
  if (root.type === "leaf") return root;
  return { ...root, children: root.children.map((c) => updateNode(c, id, fn)) };
}

/** Immutably remove the node with the given id, collapsing single-child splits. */
export function removeNode(root: LayoutNode, id: string): LayoutNode | null {
  if (root.id === id) return null;
  if (root.type === "leaf") return root;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  root.children.forEach((child, i) => {
    const kept = removeNode(child, id);
    if (kept) {
      children.push(kept);
      sizes.push(root.sizes[i]);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...root, children, sizes: sizes.map((s) => s / total) };
}

export function makeLeaf(tabId: string): LeafNode {
  return { id: uid(), type: "leaf", tabId };
}

/** Split the given leaf, putting newLeaf on the requested side. */
export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  side: SplitSide,
  newLeaf: LeafNode
): LayoutNode {
  const dir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "up";
  return updateNode(root, leafId, (node) => {
    const split: SplitNode = {
      id: uid(),
      type: "split",
      dir,
      children: before ? [newLeaf, node] : [node, newLeaf],
      sizes: [0.5, 0.5],
    };
    return split;
  });
}

/** Drop leaves whose tab no longer exists (e.g. after corrupted persistence). */
export function sanitize(
  node: LayoutNode | null,
  hasTab: (tabId: string) => boolean
): LayoutNode | null {
  if (!node) return null;
  if (node.type === "leaf") return hasTab(node.tabId) ? node : null;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const kept = sanitize(child, hasTab);
    if (kept) {
      children.push(kept);
      sizes.push(node.sizes[i] ?? 1);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  return { ...node, children, sizes: sizes.map((s) => s / total) };
}
