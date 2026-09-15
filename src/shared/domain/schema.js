// Hardcoded business definitions and presentation hints; never a schema editor.
(() => {
  const text = (label, group = "Overview", extra = {}) => ({
    label,
    type: "string",
    group,
    ...extra,
  });
  const date = (label) => ({ label, type: "date", group: "Dates" });
  const url = (label) => ({ label, type: "url", group: "Sources" });
  const choice = (label, options, extra = {}) => ({
    label,
    type: "enum",
    options,
    group: "Overview",
    ...extra,
  });
  globalThis.BurbotSchema = Object.freeze({
    project: {
      label: "Project",
      primary: "name",
      configuration: true,
      fields: {
        name: text("Name"),
        type: choice("Project type", { B2B: "B2B", B2C: "B2C" }),
        status: choice(
          "Status",
          {
            ACTIVE: "Active",
            CLOSED: "Closed",
            SUSPENDED: "Suspended",
            PLANNED: "Planned",
          },
          { default: "PLANNED" },
        ),
        number: text("Project number"),
        start_date: date("Start date"),
        end_date: date("End date"),
        announcements_site_url: url("Announcements page"),
        amount: {
          label: "Previously captured amount",
          type: "number",
          group: "Earlier captures",
          legacy: true,
        },
      },
    },
    recruitment: {
      label: "Recruitment",
      primary: "external_number",
      configuration: true,
      fields: {
        external_number: text("Recruitment number / name"),
        project_id: {
          label: "Project",
          type: "reference",
          references: "project",
          group: "Overview",
        },
        sequence_number: {
          label: "Sequence number",
          type: "integer",
          min: 1,
          group: "Overview",
        },
        year: {
          label: "Year",
          type: "integer",
          min: 1000,
          max: 9999,
          group: "Overview",
        },
        // The supplied model omits RecruitmentStatus and ClosedStatus enum members.
        // Keep these open text until the authoritative values are available.
        status: text("Status", "Overview", {
          default: "ANNOUNCED",
          labels: { ANNOUNCED: "Announced" },
        }),
        start_date: date("Start date"),
        end_date: date("End date"),
        announced_year: {
          label: "Announcement year",
          type: "integer",
          min: 1000,
          max: 9999,
          group: "Dates",
        },
        announced_quarter: choice(
          "Announcement quarter",
          { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" },
          { numeric: true, group: "Dates" },
        ),
        closed_status: text("Closure outcome", "Closure"),
        status_reason: text("Status reason", "Closure", { multiline: true }),
        announcement_url: url("Announcement page"),
      },
    },
    operator: {
      label: "Operator",
      primary: "name",
      fields: {
        name: text("Name"),
        nip: { label: "NIP", type: "nip", group: "Overview" },
        website: { ...url("Website"), legacy: true },
        email: text("Email", "Earlier captures", { legacy: true }),
      },
    },
    // Keep existing records and rule keys intact. New creation uses recruitment.
    nabor: {
      label: "Recruitment",
      primary: "title",
      legacy: true,
      fields: {
        title: text("Name"),
        operator: text("Operator"),
        amount: { label: "Amount", type: "number", group: "Funding" },
        deadline: date("Deadline"),
        url: url("Announcement page"),
      },
    },
  });
  globalThis.BurbotFunding = Object.freeze({
    sizes: { MICRO: "Micro", SMALL: "Small", MEDIUM: "Medium", LARGE: "Large" },
    fields: {
      refund_percent: { label: "Refund", type: "percentage" },
      max_amount_pln: { label: "Maximum amount", type: "money" },
      max_per_person_pln: { label: "Maximum per person", type: "money" },
      own_contribution_form: choice("Own contribution", {
        UNSPECIFIED: "Not distinguished in source",
        CASH: "Cash",
        WAGES: "Wages",
      }),
      notes: text("Notes", "Funding", { multiline: true }),
    },
  });
  globalThis.BurbotDocuments = Object.freeze({
    fields: {
      requirement: choice("Requirement", {
        REQUIRED: "Required",
        OPTIONAL: "Optional",
      }),
      auto_fill: { label: "Auto-fill", type: "boolean" },
      notes: text("Notes", "Documents", { multiline: true }),
    },
    catalog: [
      ["msp_application_form", "Formularz zgłoszeniowy MSP (Zał. 1)"],
      ["service_information", "Informacja o usłudze (Zał. 1 do Form.)"],
      ["participant_data", "Dane uczestnika (Zał. 2)"],
      ["msp_declaration", "Oświadczenie MSP (Zał. 3)"],
      ["de_minimis_declaration", "Oświadczenie de minimis (Zał. 4)"],
      ["de_minimis_form", "Formularz de minimis (Zał. 5)"],
      ["persons_list", "Wykaz osób (Zał. 4 do Umowy)"],
      ["service_provider_declaration", "Oświadczenie dostawcy usług"],
      ["employment_certificate", "Zaświadczenie o zatrudnieniu"],
      ["krs_ceidg", "Odpis KRS / wydruk CEIDG"],
      ["gdpr_clause", "Klauzula RODO"],
      ["validity_declaration", "Oświadczenie aktualności"],
      ["refund_application", "Wniosek o refundację"],
      ["service_invoice", "Faktura za usługę"],
      ["extended_evaluation_card", "Karta pogłębionej oceny", true],
      ["initial_evaluation_card", "Karta wstępnej oceny", true],
      ["psf_application_form", "Formularz zgłoszeniowy PSF"],
      ["de_minimis_information_form", "Formularz informacji de minimis"],
      ["psf_promise_agreement", "Umowa promesa PSF"],
      ["de_minimis_aid_application", "Wniosek o udzielenie pomocy de minimis"],
      ["psf_refund_application", "Wniosek o refundację PSF"],
      [
        "service_completion_certificate",
        "Zaświadczenie o zakończeniu udziału w usłudze rozwojowej",
      ],
      [
        "no_eu_funding_declaration",
        "Oświadczenie o braku aplikowania o środki UE",
      ],
      [
        "psf_service_settlement_application",
        "Wniosek o rozliczenie usługi rozwojowej (PSF)",
      ],
      ["pur_part_2", "PUR cz. II"],
      [
        "fgsa_green_10_17_application",
        "Formularz zgłoszeniowy 10.17 Zielony (FGSA)",
      ],
      [
        "arr_czestochowa_6_6_application",
        "Formularz zgłoszeniowy 6.6 osoby dorosłe",
      ],
      [
        "lok_postgraduate_agreement",
        "Umowa uczestnika — studia podyplomowe (LOK)",
      ],
      ["lok_training_agreement", "Umowa uczestnika — usługa szkoleniowa (LOK)"],
      ["pur_part_1", "PUR cz. I — Plan Usług Rozwojowych"],
      ["other", "Inne dokumenty"],
    ].map(([key, name, internal = false]) => ({ key, name, internal })),
  });
})();
