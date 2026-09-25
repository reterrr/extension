import type {
  LegacyStorageState,
  LegacyStoredObject,
  LegacyStoredOperatorAssignment,
} from "../shared/types/legacy-storage";

const STORAGE_KEY = "burbot:v1";
let initialized = false;
let state = BurbotCore.empty() as LegacyStorageState;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}

function notice(text: string, error = false): void {
  const element = $("notice");
  element.textContent = text;
  element.className = error ? "error" : "";
}

function chosenObject(): LegacyStoredObject | undefined {
  const activeId =
    document.getElementById("workspace")?.dataset.activeObjectId ?? "";
  if (!activeId) return undefined;
  return state.objects.find((object) => object.id === activeId);
}

function operatorLabel(operator: LegacyStoredObject | undefined): string {
  if (!operator) return "Nieznany operator";
  const key = operator.importKey || operator.id;
  const name = String(operator.values?.name ?? operator.label ?? "");
  return name ? `${key} — ${name}` : String(key);
}

async function data(
  op: string,
  payload: Record<string, unknown> = {},
): Promise<LegacyStorageState> {
  const response = (await browser.runtime.sendMessage({
    type: "BURBOT_DATA",
    op,
    expectedRevision: state.revision,
    ...payload,
  })) as { ok?: boolean; value?: LegacyStorageState; error?: string };

  if (!response?.ok || !response.value) {
    throw new Error(response?.error ?? "Storage is unavailable.");
  }
  state = response.value;
  window.dispatchEvent(
    new CustomEvent("burbot:workspace-state-changed", {
      detail: { state },
    }),
  );
  return state;
}

function assignmentsFor(objectId: string): LegacyStoredOperatorAssignment[] {
  return (state.operatorAssignments ?? [])
    .filter((row) => row.objectId === objectId)
    .sort((a, b) => {
      const rank = (value: string) => (value === "GLOWNY" ? 0 : 1);
      return (
        rank(a.operatorType) - rank(b.operatorType) ||
        operatorLabel(state.objects.find((o) => o.id === a.operatorId)).localeCompare(
          operatorLabel(state.objects.find((o) => o.id === b.operatorId)),
          "pl",
        )
      );
    });
}

function renderRows(object: LegacyStoredObject): void {
  const root = $("operator-assignment-list");
  root.replaceChildren();

  const assignments = assignmentsFor(object.id);
  if (!assignments.length) {
    const empty = document.createElement("p");
    empty.className = "operator-assignment-empty";
    empty.textContent = "Brak przypisanych operatorów.";
    root.append(empty);
    return;
  }

  for (const assignment of assignments) {
    const operator = state.objects.find(
      (candidate) =>
        candidate.id === assignment.operatorId &&
        candidate.type === "operator",
    );

    const row = document.createElement("div");
    row.className = "operator-assignment-row";

    const copy = document.createElement("div");
    copy.className = "operator-assignment-copy";

    const title = document.createElement("strong");
    title.textContent = operatorLabel(operator);

    const meta = document.createElement("small");
    meta.textContent =
      assignment.operatorType === "GLOWNY" ? "Operator główny" : "Operator dodatkowy";

    copy.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button danger";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Usuń operatora");
    remove.title =
      object.type === "recruitment"
        ? "Usuń operatora i jego geografię z naboru"
        : "Usuń operatora z projektu";
    remove.onclick = () => {
      void data("REMOVE_OPERATOR_ASSIGNMENT", {
        objectId: object.id,
        assignmentId: assignment.id,
      })
        .then(() => {
          notice(
            object.type === "recruitment"
              ? "Usunięto operatora oraz jego geografię z naboru."
              : "Usunięto operatora z projektu.",
          );
          render();
        })
        .catch((error: unknown) =>
          notice(error instanceof Error ? error.message : String(error), true),
        );
    };

    row.append(copy, remove);
    root.append(row);
  }
}

function renderAdd(object: LegacyStoredObject): void {
  const select = $("operator-assignment-select") as HTMLSelectElement;
  const role = $("operator-assignment-role") as HTMLSelectElement;
  const add = $("operator-assignment-add-button") as HTMLButtonElement;

  const assigned = new Set(assignmentsFor(object.id).map((row) => row.operatorId));
  const operators = state.objects
    .filter((candidate) => candidate.type === "operator" && !assigned.has(candidate.id))
    .sort((a, b) => operatorLabel(a).localeCompare(operatorLabel(b), "pl"));

  const previous = select.value;
  select.replaceChildren(new Option("Wybierz operatora…", ""));
  for (const operator of operators) {
    select.append(new Option(operatorLabel(operator), operator.id));
  }
  if (operators.some((operator) => operator.id === previous)) {
    select.value = previous;
  }

  const hasMain = assignmentsFor(object.id).some(
    (row) => row.operatorType === "GLOWNY",
  );
  role.value = hasMain ? "DODATKOWY" : "GLOWNY";
  role.disabled = !hasMain;
  add.disabled = !select.value;

  select.onchange = () => {
    add.disabled = !select.value;
  };

  add.onclick = () => {
    if (!select.value) return;
    void data("ADD_OPERATOR_ASSIGNMENT", {
      objectId: object.id,
      operatorId: select.value,
      operatorType: role.value,
    })
      .then(() => {
        notice("Dodano operatora.");
        render();
      })
      .catch((error: unknown) =>
        notice(error instanceof Error ? error.message : String(error), true),
      );
  };
}

function render(): void {
  const section = $("operator-assignments-section");
  const count = $("operator-assignment-count");
  const object = chosenObject();
  const enabled =
    !!object && (object.type === "project" || object.type === "recruitment");

  section.hidden = !enabled;
  if (!object || !enabled) return;

  const assignments = assignmentsFor(object.id);
  count.textContent = assignments.length
    ? `${assignments.length} ${assignments.length === 1 ? "operator" : "operatorów"}`
    : "Brak operatorów";

  renderRows(object);
  renderAdd(object);
}

export async function initOperatorAssignmentsUi(): Promise<void> {
  if (initialized) return;
  initialized = true;

  state = await data("GET");

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const next = changes[STORAGE_KEY]?.newValue as LegacyStorageState | undefined;
    if (!next) return;
    state = next;
    render();
  });

  window.addEventListener("burbot:active-object-changed", render);
  window.addEventListener("burbot:workspace-state-changed", (event) => {
    const next = (event as CustomEvent<{ state?: LegacyStorageState }>).detail?.state;
    if (next) state = next;
    render();
  });

  render();
}
