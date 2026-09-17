// Hardcoded business definitions and presentation hints; never a schema editor.
(() => {
  const text = (label, group = "Podstawowe", extra = {}) => ({
    label,
    type: "string",
    group,
    ...extra,
  });
  const date = (label, group = "Daty") => ({ label, type: "date", group });
  const url = (label, group = "Źródła") => ({ label, type: "url", group });
  const integer = (label, group = "Podstawowe", extra = {}) => ({
    label,
    type: "integer",
    group,
    ...extra,
  });
  const percentage = (label, group = "Dofinansowanie") => ({
    label,
    type: "percentage",
    group,
    min: 0,
    max: 100,
  });
  const choice = (label, options, extra = {}) => ({
    label,
    type: "enum",
    options,
    group: "Podstawowe",
    ...extra,
  });
  const months = {
    1: "Styczeń",
    2: "Luty",
    3: "Marzec",
    4: "Kwiecień",
    5: "Maj",
    6: "Czerwiec",
    7: "Lipiec",
    8: "Sierpień",
    9: "Wrzesień",
    10: "Październik",
    11: "Listopad",
    12: "Grudzień",
  };

  globalThis.BurbotSchema = Object.freeze({
    project: {
      label: "Projekt",
      primary: "name",
      configuration: true,
      geography: true,
      fields: {
        name: text("Nazwa"),
        operator_id: {
          label: "Operator",
          type: "reference",
          references: "operator",
          group: "Podstawowe",
        },
        type: choice("Typ projektu", { B2B: "B2B", B2C: "B2C" }),
        status: choice(
          "Status projektu",
          {
            PLANOWANY: "Planowany",
            AKTYWNY: "Aktywny",
            ZAWIESZONY: "Zawieszony",
            ZAKONCZONY: "Zakończony",
          },
          {
            default: "PLANOWANY",
            aliases: {
              PLANNED: "PLANOWANY",
              ACTIVE: "AKTYWNY",
              SUSPENDED: "ZAWIESZONY",
              CLOSED: "ZAKONCZONY",
              Planned: "PLANOWANY",
              Active: "AKTYWNY",
              Suspended: "ZAWIESZONY",
              Closed: "ZAKONCZONY",
            },
          },
        ),
        number: text("Numer projektu"),
        refund_percent_min: percentage("Minimalna refundacja"),
        refund_percent_max: percentage("Maksymalna refundacja"),
        start_date: date("Data rozpoczęcia projektu"),
        end_date: date("Data zakończenia projektu"),
        announcements_site_url: url("Strona naborów"),
        amount: {
          label: "Previously captured amount",
          type: "number",
          group: "Earlier captures",
          legacy: true,
        },
      },
    },

    recruitment: {
      label: "Nabór",
      primary: "external_number",
      configuration: true,
      geography: true,
      fields: {
        external_number: text("Numer / nazwa naboru"),
        project_id: {
          label: "Projekt",
          type: "reference",
          references: "project",
          group: "Podstawowe",
        },
        sequence_number: integer("Numer kolejny", "Podstawowe", { min: 1 }),
        year: integer("Rok", "Podstawowe", { min: 1000, max: 9999 }),
        status: choice(
          "Status naboru",
          {
            PLANOWANY: "Planowany",
            OGLOSZONY: "Ogłoszony",
            AKTYWNY: "Aktywny",
            ZAWIESZONY: "Zawieszony",
            ZAKONCZONY: "Zakończony",
          },
          {
            default: "OGLOSZONY",
            aliases: {
              PLANNED: "PLANOWANY",
              ANNOUNCED: "OGLOSZONY",
              ACTIVE: "AKTYWNY",
              SUSPENDED: "ZAWIESZONY",
              CLOSED: "ZAKONCZONY",
              Planned: "PLANOWANY",
              Announced: "OGLOSZONY",
              Active: "AKTYWNY",
              Suspended: "ZAWIESZONY",
              Closed: "ZAKONCZONY",
            },
          },
        ),
        refund_percent_min: percentage("Minimalna refundacja"),
        refund_percent_max: percentage("Maksymalna refundacja"),

        dataRozpoczeciaOd: date("Data rozpoczęcia — od", "Termin rzeczywisty"),
        dataRozpoczeciaDo: date("Data rozpoczęcia — do", "Termin rzeczywisty"),
        dataZakonczeniaOd: date("Data zakończenia — od", "Termin rzeczywisty"),
        dataZakonczeniaDo: date("Data zakończenia — do", "Termin rzeczywisty"),

        planowanyStartRok: integer("Planowany start — rok", "Termin planowany", {
          min: 1000,
          max: 9999,
        }),
        planowanyStartMiesiac: choice(
          "Planowany start — miesiąc",
          months,
          { numeric: true, group: "Termin planowany" },
        ),
        planowanyStartKwartal: choice(
          "Planowany start — kwartał",
          { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" },
          { numeric: true, group: "Termin planowany" },
        ),

        planowanyKoniecRok: integer("Planowany koniec — rok", "Termin planowany", {
          min: 1000,
          max: 9999,
        }),
        planowanyKoniecMiesiac: choice(
          "Planowany koniec — miesiąc",
          months,
          { numeric: true, group: "Termin planowany" },
        ),
        planowanyKoniecKwartal: choice(
          "Planowany koniec — kwartał",
          { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" },
          { numeric: true, group: "Termin planowany" },
        ),

        statusZakonczenia: text("Status zakończenia", "Zakończenie"),
        powodStatusu: text("Powód statusu", "Zakończenie", { multiline: true }),
        urlOgloszenia: url("URL ogłoszenia"),

        // Pre-typed-domain compatibility. Existing objects/rules keep working,
        // but these rows stay hidden unless they already contain data.
        start_date: { ...date("Stara data rozpoczęcia", "Earlier captures"), legacy: true },
        end_date: { ...date("Stara data zakończenia", "Earlier captures"), legacy: true },
        announced_year: {
          ...integer("Stary rok ogłoszenia", "Earlier captures", {
            min: 1000,
            max: 9999,
          }),
          legacy: true,
        },
        announced_quarter: {
          ...choice(
            "Stary kwartał ogłoszenia",
            { 1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4" },
            { numeric: true, group: "Earlier captures" },
          ),
          legacy: true,
        },
        closed_status: {
          ...text("Stary status zakończenia", "Earlier captures"),
          legacy: true,
        },
        status_reason: {
          ...text("Stary powód statusu", "Earlier captures", { multiline: true }),
          legacy: true,
        },
        announcement_url: {
          ...url("Stary URL ogłoszenia", "Earlier captures"),
          legacy: true,
        },
      },
    },

    operator: {
      label: "Operator",
      primary: "name",
      fields: {
        name: text("Nazwa"),
        nip: { label: "NIP", type: "nip", group: "Podstawowe" },
        website: { ...url("Website"), legacy: true },
        email: text("Email", "Earlier captures", { legacy: true }),
      },
    },

    // Keep existing records and rule keys intact. New creation uses recruitment.
    nabor: {
      label: "Nabór (legacy)",
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
      ["service_completion_certificate", "Zaświadczenie o zakończeniu udziału w usłudze rozwojowej"],
      ["no_eu_funding_declaration", "Oświadczenie o braku aplikowania o środki UE"],
      ["psf_service_settlement_application", "Wniosek o rozliczenie usługi rozwojowej (PSF)"],
      ["pur_part_2", "PUR cz. II — Plan Usług Rozwojowych"],
      ["fgsa_green_10_17_application", "Formularz zgłoszeniowy 10.17 Zielony (FGSA)"],
      ["arr_czestochowa_6_6_application", "Formularz zgłoszeniowy 6.6 osoby dorosłe"],
      ["lok_postgraduate_agreement", "Umowa uczestnika — studia podyplomowe (LOK)"],
      ["lok_training_agreement", "Umowa uczestnika — usługa szkoleniowa (LOK)"],
      ["pur_part_1", "PUR cz. I — Plan Usług Rozwojowych"],
      ["other", "Inne dokumenty"],
    ].map(([key, name, internal = false]) => ({ key, name, internal })),
  });
})();
