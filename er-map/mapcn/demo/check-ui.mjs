// The board has no controls — a voice agent drives it through window.lumia — so the
// checks go through that bridge, plus one real click on the MapLibre canvas.
import assert from "node:assert";
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--no-first-run", "--password-store=basic", "--use-mock-keychain"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 880 });
await page.goto(url + "?from=Pond&t=28", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 3500));

const state = () => page.evaluate(() => window.lumia.state);
const settle = () => new Promise((r) => setTimeout(r, 600));

assert.deepStrictEqual((await state()).sighting, "Pond", "URL should seed the sighting");
assert.strictEqual((await state()).elapsed, 28);
assert.strictEqual((await page.evaluate(() => window.lumia.kiosks.length)), 11,
  "all 11 credit kiosks should be on the board");
assert.strictEqual((await page.evaluate(() => window.lumia.areas.length)), 21);

// the voice bridge drives the board
await page.evaluate(() => { window.lumia.restrict("Harbor"); window.lumia.elapse(60); });
await settle();
assert.deepStrictEqual((await state()).restricted, ["Harbor"]);
assert.strictEqual((await state()).elapsed, 60);

// 바지선 only reaches the rest of the island through 항구, so shutting it strands 바지선
const barge = await page.$$eval(".maplibregl-marker", (nodes) =>
  nodes.map((n) => n.textContent?.trim()).find((t) => t?.startsWith("바지선")) ?? "");
assert.ok(!barge.includes("초"), "바지선 should show no arrival time once 항구 is restricted");

// clicking the map still moves the sighting
await page.evaluate(() => { window.lumia.allow("Harbor"); window.lumia.elapse(0); });
await settle();
await page.mouse.click(650, 440);
await settle();
assert.notStrictEqual((await state()).sighting, "Pond", "a click on the island should move the sighting");

await browser.close();
console.log("ok — bridge drives the board, 11 kiosks, click still moves the sighting");
