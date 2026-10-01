import { resolve } from "node:path";
import {
  openHighlighter,
  measureHighlights,
} from "../tests/helpers/highlighter-browser.mjs";

const { browser, page } = await openHighlighter(
  resolve(process.argv[2] ?? "."),
);
try {
  console.log(JSON.stringify(await measureHighlights(page), null, 2));
} finally {
  await browser.close();
}
