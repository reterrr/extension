globalThis.BurbotSchema = Object.freeze({
  nabor: {label: "Nabór", fields: {
    title: {label: "Nazwa", type: "string"},
    operator: {label: "Operator", type: "string"},
    amount: {label: "Kwota", type: "number"},
    deadline: {label: "Termin", type: "date"},
    url: {label: "URL", type: "url"}
  }},
  operator: {label: "Operator", fields: {
    name: {label: "Nazwa", type: "string"},
    website: {label: "Strona", type: "url"},
    email: {label: "Email", type: "string"}
  }},
  project: {label: "Projekt", fields: {
    name: {label: "Nazwa", type: "string"},
    amount: {label: "Wartość", type: "number"},
    status: {label: "Status", type: "string"}
  }}
});
