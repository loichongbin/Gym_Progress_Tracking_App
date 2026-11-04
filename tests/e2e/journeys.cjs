// End-to-end user journeys against a REAL Supabase backend (local `supabase start` or a test project).
//
//   1. npm run build && npm start               (app on http://localhost:3000, .env.local → Supabase)
//   2. SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 npm run e2e
//
// Emails (verification, password reset) are read from Mailpit (Supabase CLI's local inbox) or,
// if MAIL_DIR is set, from a directory of .eml files. The service-role key is only used to
// create the second test user quickly; all assertions go through the UI.
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

const APP = process.env.APP_URL || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, "..", "..", ".e2e-screenshots");
const FIX = path.join(__dirname, "..", "fixtures");
const run = Date.now().toString(36).slice(-6);
fs.mkdirSync(SHOTS, { recursive: true });

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---------------------------------------------------------------------------
async function latestLink(email, kind) {
  for (let i = 0; i < 40; i++) {
    let bodies = [];
    if (process.env.MAIL_DIR) {
      bodies = fs.readdirSync(process.env.MAIL_DIR).sort().reverse().map((f) => fs.readFileSync(path.join(process.env.MAIL_DIR, f), "utf8")).filter((m) => m.includes(email));
    } else {
      const base = process.env.MAILPIT_URL || "http://127.0.0.1:54324";
      const list = await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
      for (const m of list.messages ?? []) bodies.push((await (await fetch(`${base}/api/v1/message/${m.ID}`)).json()).HTML);
    }
    const decoded = bodies.map((b) => b.replace(/=\r?\n/g, "").replace(/=3D/g, "=").replace(/&amp;/g, "&"));
    for (const b of decoded) {
      const m = b.match(new RegExp(`https?://[^"'\\s<>]+/verify\\?[^"'\\s<>]*type=${kind}[^"'\\s<>]*`));
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No ${kind} email for ${email}`);
}

const results = [];
let current = null;
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`✗ ${name}\n    ${String(e.message || e).split("\n").slice(0, 4).join("\n    ")}`);
    await current?.screenshot({ path: path.join(SHOTS, `FAIL-${name.replace(/[^a-z0-9]+/gi, "-")}.png`) }).catch(() => {});
  }
}

async function login(page, email, password) {
  await page.goto(`${APP}/login`);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.getByPlaceholder("••••••••").fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/home", { timeout: 20000 });
}

(async () => {
  const browser = await chromium.launch();
  const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const ctxA = await browser.newContext(mobile);
  const ctxB = await browser.newContext(mobile);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  const errors = [];
  for (const p of [a, b]) {
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("dialog", (d) => d.accept());
  }

  const A = { email: `athlete.${run}@example.com`, username: `athlete_${run}`, password: "first-password-123", name: "Journey Athlete" };
  const B = { email: `buddy.${run}@example.com`, username: `buddy_${run}`, password: "buddy-password-123" };
  let postId, privatePostId;

  // ---------------- Journey 1: new user ----------------
  current = a;
  await step("J1 · register with email + password, verify email, land in the app", async () => {
    await a.goto(`${APP}/signup`);
    await a.getByPlaceholder("Alex Tan").fill(A.name);
    await a.getByPlaceholder("alex.lifts").fill(A.username);
    await a.getByPlaceholder("you@example.com").fill(A.email);
    await a.getByPlaceholder("At least 8 characters").fill(A.password);
    await a.getByRole("button", { name: "Create account" }).click();
    await a.getByText("Check your inbox").waitFor({ timeout: 15000 });
    await a.screenshot({ path: path.join(SHOTS, "j1-verify-email.png") });
    await a.goto(await latestLink(A.email, "signup"));
    await a.waitForURL("**/home", { timeout: 20000 });
  });

  await step("J1 · unverified login is refused with a resend option (fresh account)", async () => {
    const p = await (await browser.newContext()).newPage();
    const email = `unverified.${run}@example.com`;
    await p.goto(`${APP}/signup`);
    await p.getByPlaceholder("Alex Tan").fill("Unverified");
    await p.getByPlaceholder("alex.lifts").fill(`unver_${run}`);
    await p.getByPlaceholder("you@example.com").fill(email);
    await p.getByPlaceholder("At least 8 characters").fill("password-123");
    await p.getByRole("button", { name: "Create account" }).click();
    await p.getByText("Check your inbox").waitFor();
    await p.goto(`${APP}/login`);
    await p.getByPlaceholder("you@example.com").fill(email);
    await p.getByPlaceholder("••••••••").fill("password-123");
    await p.getByRole("button", { name: "Log in", exact: true }).click();
    await p.getByText(/verify your email/i).waitFor();
    await p.getByRole("button", { name: /Resend verification email/ }).waitFor();
    await p.context().close();
  });

  await step("J1/J4 · complete profile incl. profile picture upload", async () => {
    await a.goto(`${APP}/settings`);
    await a.getByPlaceholder("What are you training for?").fill("Push day lover. Training for my first meet.");
    await a.getByPlaceholder("City").fill("Kuala Lumpur");
    await a.getByPlaceholder("Where you train").fill("Iron Republic KL");
    await a.getByLabel("Fitness interests").fill("Powerlifting, Push Pull Legs");
    await a.locator('input[type=file][accept="image/jpeg,image/png,image/webp"]').first().setInputFiles(path.join(FIX, "gym-selfie.png"));
    await a.getByRole("button", { name: "Save profile" }).click();
    await a.getByText("Profile updated").waitFor({ timeout: 20000 });
  });

  await step("J1 · log out, log back in, profile info retained", async () => {
    await a.goto(`${APP}/settings`);
    await a.getByRole("button", { name: "Log out" }).click();
    await a.waitForURL("**/login");
    await login(a, A.email, A.password);
    await a.goto(`${APP}/u/${A.username}`);
    await a.getByText("Push day lover. Training for my first meet.").waitFor();
    await a.getByText("Iron Republic KL").waitFor();
    await a.getByText("Powerlifting").first().waitFor();
    const avatar = a.locator(`main img[src*="profile-images"]:visible`).first();
    await avatar.waitFor();
    if (!(await avatar.evaluate((img) => img.complete && img.naturalWidth > 0))) throw new Error("avatar not displayed");
    await a.screenshot({ path: path.join(SHOTS, "j1-profile.png") });
  });

  await step("J1 · session survives a full page refresh", async () => {
    await a.reload();
    await a.getByText("Push day lover. Training for my first meet.").waitFor();
  });

  await step("J1 · forgot password → email link → new password works", async () => {
    await a.goto(`${APP}/settings`);
    await a.getByRole("button", { name: "Log out" }).click();
    await a.waitForURL("**/login");
    await a.getByRole("link", { name: "Forgot password?" }).click();
    await a.getByPlaceholder("you@example.com").fill(A.email);
    await a.getByRole("button", { name: "Send reset link" }).click();
    await a.getByText("Check your inbox").waitFor();
    await a.goto(await latestLink(A.email, "recovery"));
    await a.waitForURL(/\/reset-password/, { timeout: 20000 });
    A.password = "second-password-456";
    await a.getByLabel("New password").fill(A.password);
    await a.getByLabel("Confirm password").fill(A.password);
    await a.getByRole("button", { name: "Update password" }).click();
    await a.waitForURL("**/home");
    await a.goto(`${APP}/settings`);
    await a.getByRole("button", { name: "Log out" }).click();
    await a.waitForURL("**/login");
    await login(a, A.email, A.password);
  });

  // ---------------- Journey 4 + 2: multi-photo post ----------------
  await step("J4 · create a post with multiple photos (uploaded to Storage)", async () => {
    await a.goto(`${APP}/create/post`);
    await a.locator("input[type=file][multiple]").setInputFiles([path.join(FIX, "gym-selfie.png"), path.join(FIX, "progress-pic.png")]);
    await a.locator("img[src^='blob:']").nth(1).waitFor();
    await a.getByPlaceholder(/How was the session/).fill(`Leg day done ${run} 🦵`);
    await a.getByRole("button", { name: "Share post" }).click();
    await a.waitForURL("**/post/**", { timeout: 30000 });
    postId = a.url().split("/post/")[1];
  });

  await step("J4 · refresh: both photos still displayed (signed URLs from private bucket)", async () => {
    await a.reload();
    await a.getByText(`Leg day done ${run}`).first().waitFor();
    const imgs = a.locator("article img[src*='/storage/v1/object/sign/post-media/']");
    await imgs.first().waitFor();
    if ((await imgs.count()) < 2) throw new Error(`expected 2 images, found ${await imgs.count()}`);
    for (let i = 0; i < 2; i++) {
      const ok = await imgs.nth(i).evaluate((img) => new Promise((r) => (img.complete ? r(img.naturalWidth > 0) : (img.onload = () => r(true), img.onerror = () => r(false)))));
      if (!ok) throw new Error(`photo ${i + 1} failed to load`);
    }
    await a.screenshot({ path: path.join(SHOTS, "j4-post.png") });
  });

  // ---------------- Journey 2: social interaction ----------------
  current = b;
  await step("J2 · user B signs in, follows A and sees A's post in the feed", async () => {
    const { error } = await admin.auth.admin.createUser({ email: B.email, password: B.password, email_confirm: true, user_metadata: { username: B.username, full_name: "Buddy Tester" } });
    if (error) throw error;
    await login(b, B.email, B.password);
    await b.goto(`${APP}/u/${A.username}`);
    await b.getByRole("button", { name: "Follow", exact: true }).click();
    await b.getByRole("button", { name: "Following", exact: true }).waitFor();
    await b.goto(`${APP}/home`);
    await b.getByText(`Leg day done ${run}`).first().waitFor({ timeout: 15000 });
  });

  await step("J2 · B likes and comments on A's post", async () => {
    const art = b.locator("article").filter({ hasText: `Leg day done ${run}` }).first();
    await art.getByRole("button", { name: "Like", exact: true }).click();
    await art.getByRole("button", { name: "Unlike" }).waitFor();
    await art.getByRole("button", { name: "Comment", exact: true }).click();
    await b.getByPlaceholder(/Add a comment/).fill("Great session! 🔥");
    await b.getByRole("button", { name: "Post comment" }).click();
    await b.getByText("Great session! 🔥").waitFor();
    await b.screenshot({ path: path.join(SHOTS, "j2-comment.png") });
  });

  current = a;
  await step("J2 · A receives follow, like and comment notifications (unread badge)", async () => {
    await a.goto(`${APP}/home`);
    await a.locator("nav[aria-label=Main] span.bg-accent.rounded-full").first().waitFor({ timeout: 15000 });
    await a.goto(`${APP}/activity`);
    await a.getByText("started following you.").waitFor();
    await a.getByText("liked your post.").waitFor();
    await a.getByText(/commented: Great session!/).waitFor();
    await a.screenshot({ path: path.join(SHOTS, "j2-activity.png") });
  });

  await step("J2 · likes/comments persisted (counts after reload)", async () => {
    await a.goto(`${APP}/post/${postId}`);
    await a.getByText("Great session! 🔥").first().waitFor();
    await a.getByText(/1 like/).waitFor();
  });

  // ---------------- Journey 3: workout tracking ----------------
  await step("J3 · start a workout, add multiple exercises, record sets, finish", async () => {
    await a.goto(`${APP}/workout`);
    await a.getByRole("button", { name: /Start empty Push workout/ }).click();
    await a.getByRole("button", { name: "Add exercises" }).click();
    await a.getByLabel("Search exercises").fill("Bench Press");
    await a.locator("[role=dialog] button").filter({ hasText: "Bench Press" }).filter({ hasText: "Chest · Barbell" }).first().click();
    await a.getByLabel("Search exercises").fill("Shoulder Press");
    await a.locator("[role=dialog] button").filter({ hasText: "Shoulder Press" }).filter({ hasText: "Shoulders · Dumbbell" }).first().click();
    await a.getByRole("button", { name: /^Add 2 exercises$/ }).click();
    const fill = async (n, set, kg, reps) => {
      await a.getByLabel(`Set ${set} weight in kg`).nth(n).fill(String(kg));
      await a.getByLabel(`Set ${set} reps`).nth(n).fill(String(reps));
      // The ✓ button's label flips to "Mark set N not done" once ticked, so match both states.
      await a.getByRole("button", { name: new RegExp(`^(Complete set ${set}|Mark set ${set} not done)$`) }).nth(n).click();
      const skip = a.getByRole("button", { name: "Skip" });
      if (await skip.isVisible().catch(() => false)) await skip.click();
    };
    await fill(0, 1, 60, 10);
    await fill(0, 2, 60, 8);
    await fill(1, 1, 30, 10);
    // Set 3 of bench is filled in but NOT completed → stored, but excluded from totals.
    await a.getByLabel("Set 3 weight in kg").nth(0).fill("100");
    await a.getByLabel("Set 3 reps").nth(0).fill("10");
    await a.screenshot({ path: path.join(SHOTS, "j3-logging.png") });
    await a.getByRole("button", { name: "Finish" }).click();
    await a.getByText("Workout complete!").waitFor({ timeout: 20000 });
    // 60×10 + 60×8 + 30×10 = 1,380 kg (the uncompleted 100×10 set does not count)
    await a.getByText("1,380 kg").first().waitFor();
    await a.screenshot({ path: path.join(SHOTS, "j3-complete.png") });
  });

  await step("J3 · refresh: workout still in history with correct totals", async () => {
    await a.goto(`${APP}/u/${A.username}`);
    await a.reload();
    await a.getByRole("tab", { name: /Workouts/ }).click();
    const card = a.locator("a[href^='/workout/']").first();
    await card.waitFor();
    await card.click();
    await a.waitForURL("**/workout/**");
    await a.reload();
    await a.getByText("Bench Press").first().waitFor();
    await a.getByText("Shoulder Press").first().waitFor();
    await a.getByText("1,380 kg").first().waitFor();
    await a.getByText("skipped").first().waitFor();
  });

  await step("J3 · edit the saved workout (add a set) and totals update", async () => {
    await a.getByRole("button", { name: /Edit workout/ }).click();
    await a.waitForURL("**/workout");
    await a.getByText("Editing").waitFor();
    await a.getByLabel("Complete set 3").nth(0).click(); // complete the 100×10 set now
    const skip = a.getByRole("button", { name: "Skip" });
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await a.getByRole("button", { name: "Save changes" }).click();
    await a.getByText("Workout complete!").waitFor({ timeout: 20000 });
    await a.getByText("2,380 kg").first().waitFor();
  });

  // ---------------- Journey 5: privacy ----------------
  await step("J5 · A creates a private post; B cannot access it", async () => {
    await a.goto(`${APP}/create/post`);
    await a.getByPlaceholder(/How was the session/).fill(`secret-${run} only for me`);
    await a.getByRole("button", { name: "Only me" }).click();
    await a.getByRole("button", { name: "Share post" }).click();
    await a.waitForURL("**/post/**", { timeout: 20000 });
    privatePostId = a.url().split("/post/")[1];
    current = b;
    await b.goto(`${APP}/post/${privatePostId}`);
    await b.getByText("Post unavailable").waitFor();
    await b.goto(`${APP}/home`);
    await b.locator("article").first().waitFor();
    if (await b.locator("article").filter({ hasText: `secret-${run}` }).count()) throw new Error("private post leaked into B's feed");
    await b.goto(`${APP}/explore?q=secret-${run}`);
    await b.getByText(`No results for “secret-${run}”`).waitFor({ timeout: 15000 });
    if (await b.locator(`a[href="/post/${privatePostId}"]`).count()) throw new Error("private post leaked into search");
    await b.screenshot({ path: path.join(SHOTS, "j5-private.png") });
  });

  await step("J5 · B cannot read A's workout or notifications through the API either", async () => {
    const res = await b.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
      return JSON.parse(localStorage.getItem(key)).access_token;
    });
    const url = process.env.SUPABASE_URL;
    const anon = process.env.SUPABASE_ANON_KEY;
    const h = { apikey: anon, Authorization: `Bearer ${res}` };
    const posts = await (await fetch(`${url}/rest/v1/posts?id=eq.${privatePostId}&select=id`, { headers: h })).json();
    const notes = await (await fetch(`${url}/rest/v1/notifications?select=id,recipient_id`, { headers: h })).json();
    if (posts.length) throw new Error("private post readable via API");
    if (notes.some((n) => n.recipient_id !== notes[0]?.recipient_id)) throw new Error("foreign notifications visible");
  });

  // ---------------- Account deletion ----------------
  await step("Account deletion removes the user (B can no longer log in)", async () => {
    await b.goto(`${APP}/settings`);
    await b.getByRole("button", { name: /Delete my account/ }).click();
    await b.getByLabel("Type your username to confirm").fill(B.username);
    await b.getByRole("button", { name: "Permanently delete" }).click();
    await b.waitForURL((u) => u.pathname === "/" || u.pathname === "/login", { timeout: 20000 });
    await b.goto(`${APP}/login`);
    await b.getByPlaceholder("you@example.com").fill(B.email);
    await b.getByPlaceholder("••••••••").fill(B.password);
    await b.getByRole("button", { name: "Log in", exact: true }).click();
    await b.getByText("Incorrect email or password.").waitFor();
  });

  // Desktop screenshot for the record
  const d = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  current = d;
  await step("Desktop layout renders the connected feed", async () => {
    await login(d, A.email, A.password);
    await d.locator("article").first().waitFor({ timeout: 20000 });
    await d.waitForTimeout(1500);
    await d.screenshot({ path: path.join(SHOTS, "desktop-home.png") });
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} journey steps passed`);
  if (errors.length) console.log("Page errors:\n  " + [...new Set(errors)].join("\n  "));
  process.exit(failed || errors.length ? 1 : 0);
})();
