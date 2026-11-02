// End-to-end smoke test of the main user journeys (demo mode).
// Usage: npm run build && npx next start -p 3100   then, in another terminal:  npm run e2e  (or node tests/e2e.cjs [baseUrl] [screenshotDir])
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3100";
const SHOTS = process.argv[3] || path.join(__dirname, "..", ".e2e-screenshots");
const FIX = path.join(__dirname, "fixtures");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
let currentPage = null;
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message || e).split("\n")[0] });
    await currentPage?.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => {});
    console.log(`✗ ${name}\n    ${String(e.message || e).split("\n").slice(0, 3).join("\n    ")}`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  currentPage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`) });

  await step("Landing page renders", async () => {
    await page.goto(BASE + "/");
    await page.getByText("Train together.").waitFor();
    await shot("01-landing");
  });

  await step("Log in as demo athlete", async () => {
    await page.goto(BASE + "/login");
    await page.getByRole("button", { name: /Explore as demo athlete/ }).click();
    await page.waitForURL("**/home");
    await page.locator("article").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await shot("02-home-feed");
  });

  await step("Feed shows stories, posts and a workout attachment", async () => {
    if ((await page.getByLabel("Add story").or(page.getByLabel("View your story")).count()) === 0) throw new Error("no story tray");
    const posts = await page.locator("article").count();
    if (posts < 3) throw new Error(`only ${posts} posts`);
    await page.locator("article").filter({ hasText: "Duration" }).first().waitFor();
  });

  await step("Expand workout summary in a post", async () => {
    const btn = page.locator("article button[aria-expanded]").first();
    await btn.click();
    await page.getByText("Full workout →").first().waitFor();
    await shot("03-workout-attachment");
  });

  await step("Like and save a post", async () => {
    const art = page.locator("article").nth(1);
    const like = art.getByRole("button", { name: /^(Like|Unlike)$/ });
    const before = await like.getAttribute("aria-pressed");
    await like.click();
    await page.waitForTimeout(300);
    const after = await like.getAttribute("aria-pressed");
    if (before === after) throw new Error("like state did not toggle");
    await art.getByRole("button", { name: /^(Save|Unsave)$/ }).click();
  });

  await step("Comment and reply on a post", async () => {
    const art = page.locator("article").first();
    await art.getByRole("button", { name: "Comment", exact: true }).click();
    const input = page.getByPlaceholder(/Add a comment/);
    await input.fill("E2E test: great session 🔥");
    await page.getByRole("button", { name: "Post comment" }).click();
    await page.getByText("E2E test: great session").waitFor();
    await page.getByRole("button", { name: "Reply" }).first().click();
    await input.type("thanks!");
    await page.getByRole("button", { name: "Post comment" }).click();
    await page.getByText("thanks!").waitFor();
    await shot("04-comments");
    await page.keyboard.press("Escape");
  });

  await step("Open and react to a story", async () => {
    await page.locator("button:has(span.story-ring)").first().click();
    await page.getByLabel("Next story").waitFor();
    await page.waitForTimeout(600);
    await shot("05-story");
    await page.getByLabel("React 🔥").click();
    await page.getByLabel("Close stories").click();
  });

  await step("Create a post with photo + video, workout attached and friend tagged", async () => {
    await page.goto(BASE + "/create/post");
    await page.locator('input[type=file][multiple]').setInputFiles([path.join(FIX, "gym-selfie.png"), path.join(FIX, "training-clip.webm")]);
    await page.locator("img[src^='blob:']").first().waitFor();
    await page.getByPlaceholder(/How was the session/).fill("Push day with @dan.ong 💪 #e2e");
    await page.getByRole("button", { name: "Attach workout" }).click();
    await page.locator("[role=dialog] button").filter({ hasText: /Day|Body|Chest|Back/ }).first().click();
    await page.getByRole("button", { name: "Tag friends" }).click();
    await page.locator("[role=dialog] button").filter({ hasText: "dan.ong" }).click();
    await page.getByRole("button", { name: /^Done/ }).click();
    await shot("06-create-post");
    await page.getByRole("button", { name: "Share post" }).click();
    await page.waitForURL("**/post/**", { timeout: 20000 });
    await page.getByText("#e2e").first().waitFor();
    await page.locator("article video, article img").first().waitFor();
    await shot("07-new-post");
  });

  await step("Simulated friends react to the new post (demo engagement)", async () => {
    await page.waitForTimeout(5000);
    await page.getByText(/like|Liked by/).first().waitFor();
  });

  await step("Record a workout: add exercise, log sets, rest timer, finish", async () => {
    await page.goto(BASE + "/workout");
    await page.getByRole("button", { name: /Start empty Push workout/ }).click();
    await page.getByRole("button", { name: "Add exercises" }).click();
    await page.getByLabel("Search exercises").fill("bench");
    await page.locator("[role=dialog] button").filter({ hasText: "Bench Press" }).first().click();
    await page.getByRole("button", { name: /^Add 1 exercise$/ }).click();
    await page.getByLabel("Set 1 weight in kg").fill("62.5");
    await page.getByLabel("Set 1 reps").fill("8");
    await page.getByLabel("Complete set 1").click();
    await page.getByText("Rest", { exact: true }).waitFor();
    await shot("08-live-workout");
    await page.getByRole("button", { name: "Skip" }).click();
    await page.getByLabel("Set 2 weight in kg").fill("62.5");
    await page.getByLabel("Set 2 reps").fill("8");
    await page.getByLabel("Complete set 2").click();
    await page.getByRole("button", { name: "Skip" }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await page.getByText("Workout complete!").waitFor({ timeout: 15000 });
    await shot("09-workout-complete");
  });

  await step("Share finished workout to story", async () => {
    await page.getByRole("button", { name: /Share to your story/ }).click();
    await page.waitForURL("**/create/story**");
    await page.getByText("Sets").first().waitFor();
    await page.getByPlaceholder(/caption/).fill("Bench day ✅");
    await shot("10-story-composer");
    await page.getByRole("button", { name: "Share story" }).click();
    await page.waitForURL("**/home");
    await page.getByLabel("View your story").waitFor();
  });

  await step("Custom exercise + save template flow", async () => {
    await page.goto(BASE + "/workout");
    await page.getByRole("button", { name: /Start empty/ }).click();
    await page.getByRole("button", { name: "Add exercises" }).click();
    await page.getByLabel("Search exercises").fill("Landmine Press");
    await page.getByRole("button", { name: /Create custom exercise/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: /^Add 1 exercise$/ }).click();
    await page.getByText("Landmine Press").first().waitFor();
    await page.getByRole("button", { name: "Discard workout" }).click();
    await page.getByRole("button", { name: /Start empty/ }).waitFor();
  });

  await step("Profile: tabs, progress charts and achievements", async () => {
    await page.goto(BASE + "/u/alex.lifts");
    await page.getByText("Alex Tan").first().waitFor();
    await shot("11-profile");
    await page.getByRole("tab", { name: /Workouts/ }).click();
    await page.getByText("Bench Press").first().waitFor();
    await page.getByRole("tab", { name: /Progress/ }).click();
    await page.locator(".recharts-surface").first().waitFor();
    await page.getByText("First 100kg Squat").waitFor();
    await page.waitForTimeout(600);
    await shot("12-progress");
  });

  await step("Follow / unfollow another athlete and view followers", async () => {
    await page.goto(BASE + "/u/hannah.y");
    const btn = page.getByRole("button", { name: /^(Follow|Follow back|Following)$/ });
    await btn.click();
    await page.getByRole("button", { name: "Following", exact: true }).waitFor();
    await page.getByRole("button", { name: /\d+ Followers/ }).click();
    await page.locator("[role=dialog]").getByText("alex.lifts").waitFor();
    await page.keyboard.press("Escape");
  });

  await step("Private profile is locked and shows pending request", async () => {
    await page.goto(BASE + "/u/aisha.lifts");
    await page.getByText("This account is private").waitFor();
    await page.getByRole("button", { name: "Requested" }).waitFor();
  });

  await step("Explore + global search (people, exercises, gyms)", async () => {
    await page.goto(BASE + "/explore");
    await page.getByText("Trending in the gym").waitFor();
    await shot("13-explore");
    await page.getByRole("textbox", { name: "Search" }).fill("squat");
    await page.waitForURL("**q=squat**");
    await page.getByText("Exercises", { exact: false }).first().waitFor();
    await page.getByRole("textbox", { name: "Search" }).fill("Iron Republic");
    await page.getByText("athletes on Spotter").waitFor();
    await shot("14-search");
  });

  await step("Join a community and see its leaderboard", async () => {
    await page.goto(BASE + "/communities/beginner-fitness-club");
    await page.getByRole("button", { name: "Join community" }).click();
    await page.getByRole("button", { name: "Joined ✓" }).waitFor();
    await page.getByRole("tab", { name: "Leaderboard" }).click();
    await page.getByText(/workouts/).first().waitFor();
    await shot("15-community");
  });

  await step("Create a community", async () => {
    await page.goto(BASE + "/communities/new");
    await page.getByPlaceholder("e.g. Sunrise Lifters").fill("E2E Lifters");
    await page.getByRole("button", { name: "Create community" }).click();
    await page.waitForURL("**/communities/e2e-lifters");
    await page.getByText("Owner").waitFor();
  });

  await step("Join a challenge", async () => {
    await page.goto(BASE + "/challenges");
    await page.getByRole("button", { name: "Join challenge" }).first().click();
    await page.getByText(/You're in/).waitFor();
    await shot("16-challenges");
  });

  await step("Activity notifications + check-in", async () => {
    await page.goto(BASE + "/activity");
    await page.getByText("started following you.").first().waitFor();
    await shot("17-activity");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByRole("button", { name: /Check in at your gym/ }).click();
    await page.getByRole("button", { name: "Check in", exact: true }).click();
    await page.getByText(/Checked in at/).waitFor();
  });

  await step("Privacy settings + light mode + block/unblock", async () => {
    await page.goto(BASE + "/settings");
    await page.getByRole("switch", { name: "Private account" }).click();
    await page.getByText("Privacy settings saved").waitFor();
    await page.getByRole("button", { name: /light/i }).click();
    await page.waitForTimeout(300);
    await shot("18-settings-light");
    await page.getByRole("button", { name: /dark/i }).click();
    await page.getByRole("switch", { name: "Private account" }).click();
    await page.goto(BASE + "/u/ryan.teo");
    await page.getByRole("button", { name: "More options" }).click();
    await page.getByRole("button", { name: "Block" }).click();
    await page.waitForURL("**/home");
    await page.goto(BASE + "/settings");
    await page.getByRole("button", { name: "Unblock" }).click();
    await page.getByText("Unblocked @ryan.teo").waitFor();
  });

  await step("Delete own post", async () => {
    await page.goto(BASE + "/u/alex.lifts");
    await page.locator("a[href^='/post/']").first().click();
    await page.waitForURL("**/post/**");
    await page.getByRole("button", { name: "More options" }).first().click();
    await page.getByRole("button", { name: "Delete post" }).click();
    await page.getByText("Post deleted").waitFor();
  });

  await step("Sign out, sign up a new user, feed is populated", async () => {
    await page.goto(BASE + "/settings");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/signup");
    await page.getByPlaceholder("Alex Tan").fill("Test Athlete");
    await page.getByPlaceholder("alex.lifts").fill("test.athlete");
    await page.getByPlaceholder("you@example.com").fill("test@example.com");
    await page.getByPlaceholder("At least 8 characters").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/home");
    await page.locator("article").first().waitFor({ timeout: 15000 });
  });

  await step("Auth guard redirects signed-out users", async () => {
    await page.goto(BASE + "/settings");
    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL("**/login");
    await page.goto(BASE + "/home");
    await page.waitForURL("**/login");
    await page.goto(BASE + "/login");
    await page.getByPlaceholder("you@example.com").fill("alex@spotter.demo");
    await page.getByPlaceholder("••••••••").fill("wrong-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.getByText("Incorrect email or password.").waitFor();
  });

  // Desktop layout
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await desk.newPage();
  currentPage = dp;
  dp.on("pageerror", (e) => errors.push(e.message));
  await step("Desktop layout: sidebar + right rail", async () => {
    await dp.goto(BASE + "/login");
    await dp.getByRole("button", { name: /Explore as demo athlete/ }).click();
    await dp.waitForURL("**/home");
    await dp.locator("article").first().waitFor({ timeout: 15000 });
    await dp.getByText("Suggested for you").waitFor();
    await dp.waitForTimeout(800);
    await dp.screenshot({ path: path.join(SHOTS, "19-desktop-home.png") });
    await dp.goto(BASE + "/u/jordan_strong");
    await dp.getByText("Jordan Lee").first().waitFor();
    await dp.waitForTimeout(600);
    await dp.screenshot({ path: path.join(SHOTS, "20-desktop-profile.png") });
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} journeys passed`);
  if (errors.length) console.log("Page errors:\n  " + [...new Set(errors)].join("\n  "));
  process.exit(failed.length || errors.length ? 1 : 0);
})();
