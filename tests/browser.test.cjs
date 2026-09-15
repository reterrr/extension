const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { launch, until } = require("./firefox.cjs");
const { root } = require("./helpers.cjs");

test(
  "native Firefox context creation, sidebar capture, replay, configuration and persistence",
  { timeout: 120000 },
  async (t) => {
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<h1 id="name">Generator Kompetencji 3.0</h1><p id="date">Applications close on 21.10.2026. Apply now.</p><p id="type">B2B</p><p id="refund">80%</p><strong id="amount">100 000 PLN</strong><p id="operator">Wojewódzki Urząd Pracy w Rzeszowie</p><p id="recruitment">Nabór 3/2026</p>',
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const f = await launch();
    t.after(() => f.close());
    const url = `http://127.0.0.1:${server.address().port}/`;
    await f.page.goto(url);
    const legacy = {
      id: "old-nabor",
      type: "nabor",
      label: "Old call",
      values: { title: "Old call", amount: 5000000 },
      createdAt: "2025-01-01",
    };
    await f.storage(
      `browser.storage.local.set({'burbot:v1':{version:1,revision:4,objects:[${JSON.stringify(legacy)}],rules:[]}})`,
    );
    await until(
      () =>
        f.ui(
          `document.querySelector('#object-title').textContent==='Old call'`,
        ),
      "legacy rendering",
    );
    await f.chrome("win.SidebarController.hide() || true");
    assert.deepEqual(await f.create("#name", "Project"), [
      "Project",
      "Recruitment",
      "Operator",
    ]);
    await until(
      () =>
        f.ui(
          `document.querySelector('#object-title').textContent==='Generator Kompetencji 3.0' && document.querySelector('#connection').textContent.includes('connected')`,
        ),
      "new object focus",
    );
    let state = await f.state();
    const project = state.objects.find((o) => o.type === "project");
    assert.equal(project.values.name, "Generator Kompetencji 3.0");
    assert.equal(project.sourceUrl, url);
    assert.equal(
      state.rules.find((r) => r.objectId === project.id).extraction.type,
      "selection",
    );
    assert.deepEqual(
      state.objects.find((o) => o.id === legacy.id),
      legacy,
    );
    assert.equal(
      await f.ui(`document.querySelector('#active-label').textContent`),
      "Project type",
    );
    assert.equal(
      await f.ui(
        `document.querySelectorAll('.field-row[aria-pressed="true"]').length`,
      ),
      1,
    );
    assert.equal(
      await f.ui(
        `!!document.querySelector('#create, #new-name, #object-type')`,
      ),
      false,
    );
    assert.equal(
      await f.ui(
        `/· (string|number|enum|varchar)\b/.test(document.body.innerText)`,
      ),
      false,
    );

    await f.select("#type");
    await until(
      () => f.ui(`document.querySelector('#edit-value')?.value==='B2B'`),
      "enum capture",
    );
    assert.equal(
      await f.ui(`document.querySelector('#edit-value').tagName`),
      "SELECT",
    );
    await f.click("#save");
    await until(
      async () =>
        (await f.state()).objects.find((o) => o.id === project.id).values
          .type === "B2B",
      "saved enum",
    );

    await f.click('[data-field="end_date"][data-target="object"]');
    await f.select("#date", "21.10.2026");
    await until(
      () => f.ui(`document.querySelector('#edit-value')?.value==='2026-10-21'`),
      "partial date capture",
    );
    await f.click("#save");
    await until(
      async () =>
        (await f.state()).objects.find((o) => o.id === project.id).values
          .end_date === "2026-10-21",
      "saved date",
    );
    await f.click('[data-field="announcements_site_url"]');
    await f.click("#page-url");
    await until(
      () =>
        f.ui(
          `document.querySelector('#edit-value')?.value===${JSON.stringify(url)}`,
        ),
      "page URL",
    );
    await f.click("#save");
    await until(
      () => f.ui(`document.querySelector('#capture-area').hidden`),
      "capture hidden after last field",
    );
    assert.equal(
      await f.ui(`document.querySelector('#capture-hint').hidden`),
      false,
    );

    await f.click("#funding .size-group:first-child > .text-button");
    await until(
      () =>
        f.ui(`document.querySelector('#active-label').textContent==='Refund'`),
      "new micro variant",
    );
    await f.select("#refund");
    await until(
      () => f.ui(`document.querySelector('#edit-value')?.value==='80'`),
      "percentage capture",
    );
    await f.click("#save");
    await until(
      () =>
        f.ui(
          `document.querySelector('#active-label').textContent==='Maximum amount'`,
        ),
      "next funding field",
    );
    await f.click("#pick");
    await f.page.locator("#amount").hover();
    await f.page.locator("#amount").click();
    await until(
      () => f.ui(`document.querySelector('#edit-value')?.value==='100000'`),
      "element capture",
    );
    await f.click("#save");
    await until(
      async () =>
        (await f.state()).financingRules?.[0]?.max_amount_pln === 100000,
      "saved money",
    );
    assert.match(
      await f.ui(`document.querySelector('.variant-summary').innerText`),
      /80%.*100.*000.*PLN/s,
    );

    await f.click("#documents-panel > summary");
    await f.click("#documents .document:first-of-type > summary");
    await f.click(
      '[data-target="document:msp_application_form"][data-field="requirement"]',
    );
    await f.setValue("REQUIRED");
    await f.click("#save");
    await until(
      () =>
        f.ui(
          `document.querySelector('#active-label').textContent==='Auto-fill'`,
        ),
      "document auto-fill field",
    );
    await f.setValue(true);
    await f.click("#save");
    await until(
      async () =>
        (await f.state()).documentRequirements?.some(
          (d) => d.document_type_key === "msp_application_form" && d.auto_fill,
        ),
      "document configuration",
    );
    assert.match(
      await f.ui(`document.querySelector('#document-count').textContent`),
      /1 required/,
    );

    await f.page.evaluate(() => {
      document.querySelector("#date").textContent =
        "Applications close on 15.11.2026. Apply now.";
      document.querySelector("#amount").textContent = "120 000 PLN";
    });
    await f.click("#preview");
    await until(
      () => f.ui(`!document.querySelector('#apply').disabled`),
      "re-extraction preview",
    );
    assert.match(
      await f.ui(`document.querySelector('#result-list').innerText`),
      /15 Nov 2026/,
    );
    await f.click("#apply");
    await until(
      async () =>
        (await f.state()).objects.find((o) => o.id === project.id).values
          .end_date === "2026-11-15",
      "re-extracted date",
    );
    assert.equal((await f.state()).financingRules[0].max_amount_pln, 120000);

    await f.click("#deselect");
    await f.chrome(
      `(()=>{const box=win.document.getElementById('sidebar-box');box.style.width='360px';box.style.minWidth='360px';box.style.maxWidth='360px';return true;})()`,
    );
    await f.ui(
      `(()=>{document.querySelector('#documents-panel').open=false;window.scrollTo(0,0);return true;})()`,
    );
    assert.equal(
      await f.ui(`document.documentElement.scrollWidth<=innerWidth`),
      true,
    );
    await f.screenshot(path.join(root, "test-artifacts/sidebar-overview.png"));
    await f.click('[data-field="max_amount_pln"]');
    await f.screenshot(path.join(root, "test-artifacts/sidebar-capture.png"));

    await f.chrome("win.SidebarController.hide() || true");
    await f.create("#operator", "Operator");
    await until(
      () =>
        f.ui(
          `document.querySelector('#object-title').textContent==='Wojewódzki Urząd Pracy w Rzeszowie'`,
        ),
      "operator focus",
    );
    assert.equal(
      await f.ui(`document.querySelector('#active-label').textContent`),
      "NIP",
    );
    await f.create("#recruitment", "Recruitment");
    await until(
      () =>
        f.ui(
          `document.querySelector('#object-title').textContent==='Nabór 3/2026'`,
        ),
      "recruitment focus",
    );
    state = await f.state();
    assert.equal(
      state.objects.find((o) => o.type === "recruitment").values
        .external_number,
      "Nabór 3/2026",
    );
    assert.equal(state.objects.length, 4);
    assert.equal(state.financingRules[0].objectId, project.id);
    assert.deepEqual(
      state.objects.find((o) => o.id === legacy.id),
      legacy,
    );
    await f.click("#switcher > summary");
    await f.ui(
      `(()=>{Array.from(document.querySelectorAll('#object-options button')).find(b=>b.textContent.includes('Generator Kompetencji')).click();return true;})()`,
    );
    assert.equal(
      await f.ui(`document.querySelector('#object-title').textContent`),
      "Generator Kompetencji 3.0",
    );
    assert.match(
      await f.ui(
        `document.querySelector('[data-field="end_date"] .field-value').textContent`,
      ),
      /15 Nov 2026/,
    );
  },
);
