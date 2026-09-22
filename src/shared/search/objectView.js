export const OBJECT_VIEW_STORAGE_KEY = "burbot:object-view";

export function createObjectView(objects, query = "", type = "all", now = new Date().toISOString()) {
  const objectIds = [];
  const seen = new Set();
  for (const object of objects ?? []) {
    const id = String(object?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    objectIds.push(id);
  }
  if (!objectIds.length) throw new Error("Widok musi zawierać co najmniej jeden obiekt.");

  return {
    version: 1,
    objectIds,
    query: String(query ?? "").trim(),
    type: String(type ?? "all"),
    createdAt: String(now),
  };
}

export function normalizeObjectView(value, objects = []) {
  if (!value || value.version !== 1 || !Array.isArray(value.objectIds)) return null;
  const existing = new Set((objects ?? []).map((object) => String(object.id)));
  const objectIds = [];
  const seen = new Set();
  for (const raw of value.objectIds) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id) || !existing.has(id)) continue;
    seen.add(id);
    objectIds.push(id);
  }
  return {
    version: 1,
    objectIds,
    query: typeof value.query === "string" ? value.query : "",
    type: typeof value.type === "string" ? value.type : "all",
    createdAt:
      typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString(),
  };
}

export function objectInView(view, objectId) {
  if (!view) return true;
  return view.objectIds.includes(String(objectId));
}

export function objectsInView(objects, view) {
  if (!view) return [...(objects ?? [])];
  const byId = new Map((objects ?? []).map((object) => [String(object.id), object]));
  return view.objectIds.map((id) => byId.get(String(id))).filter(Boolean);
}


export function addObjectToView(view, objectId, objects = [], now = new Date().toISOString()) {
  const id = String(objectId ?? "").trim();
  if (!id) throw new Error("Object id is required.");
  const existing = new Set((objects ?? []).map((object) => String(object.id)));
  if (!existing.has(id)) throw new Error("Object does not exist.");
  const current = normalizeObjectView(view, objects) ?? {
    version: 1,
    objectIds: [],
    query: "",
    type: "all",
    createdAt: String(now),
  };
  return {
    ...current,
    objectIds: [...new Set([...current.objectIds, id])],
    createdAt: current.createdAt || String(now),
  };
}

export function removeObjectFromView(view, objectId, objects = []) {
  const current = normalizeObjectView(view, objects);
  if (!current) return null;
  const id = String(objectId ?? "");
  return {
    ...current,
    objectIds: current.objectIds.filter((entry) => entry !== id),
  };
}
