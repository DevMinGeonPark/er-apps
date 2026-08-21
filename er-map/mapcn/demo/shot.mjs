import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
         "--no-first-run", "--password-store=basic", "--use-mock-keychain"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1300, height: 880, deviceScaleFactor: 2 });
await page.goto(process.argv[2], { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: process.argv[3] });
await browser.close();
console.log("shot ->", process.argv[3]);
