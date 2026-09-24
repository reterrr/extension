export interface SelectorColor {
  border: string;
  fill: string;
  soft: string;
}

const SELECTOR_COLORS: readonly SelectorColor[] = [
  { border: "#6f98bd", fill: "#6f98bd18", soft: "#edf4fa" },
  { border: "#8c80b8", fill: "#8c80b818", soft: "#f2eff9" },
  { border: "#62a399", fill: "#62a39918", soft: "#edf7f5" },
  { border: "#bc9256", fill: "#bc925618", soft: "#faf4e9" },
  { border: "#bc7f91", fill: "#bc7f9118", soft: "#faeff2" },
  { border: "#7689bd", fill: "#7689bd18", soft: "#eef1f9" },
  { border: "#7a9e70", fill: "#7a9e7018", soft: "#f0f6ed" },
  { border: "#bd826f", fill: "#bd826f18", soft: "#faf0ed" },
  { border: "#7f9fa8", fill: "#7f9fa818", soft: "#eff5f6" },
  { border: "#a28b70", fill: "#a28b7018", soft: "#f6f2ed" },
];

function stableHash(value: string): number {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function selectorColor(selector: string): SelectorColor {
  return SELECTOR_COLORS[stableHash(selector) % SELECTOR_COLORS.length];
}
