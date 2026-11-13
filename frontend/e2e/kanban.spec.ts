import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("نام کاربری").fill("user");
  await page.getByLabel("رمز عبور").fill("password");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("heading", { name: "تختهٔ تیم محصول" })).toBeVisible();
}

test("rejects invalid credentials and accepts the demo account", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "ورود به حساب کاربری" }),
  ).toBeVisible();
  await expect(page.getByTestId("board-columns")).toHaveCount(0);

  await page.getByLabel("نام کاربری").fill("invalid");
  await page.getByLabel("رمز عبور").fill("credentials");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.locator(".signin-error")).toHaveText(
    "نام کاربری یا رمز عبور نادرست است.",
  );
  await expect(page.getByTestId("board-columns")).toHaveCount(0);

  await page.getByLabel("نام کاربری").fill("user");
  await page.getByLabel("رمز عبور").fill("password");
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page.getByRole("heading", { name: "تختهٔ تیم محصول" })).toBeVisible();
});

test("preserves the tab session across reload and clears it on logout", async ({
  page,
}) => {
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "تختهٔ تیم محصول" })).toBeVisible();

  const browser = page.context().browser();
  if (!browser) throw new Error("Unable to create a fresh browser session");
  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/");
    await expect(
      freshPage.getByRole("heading", { name: "ورود به حساب کاربری" }),
    ).toBeVisible();
    await expect(freshPage.getByTestId("board-columns")).toHaveCount(0);
  } finally {
    await freshContext.close();
  }

  await page.getByRole("button", { name: "خروج" }).click();
  await expect(
    page.getByRole("heading", { name: "ورود به حساب کاربری" }),
  ).toBeVisible();
  await expect(page.getByTestId("board-columns")).toHaveCount(0);
});

test("shows the sample board in Persian with six fixed columns", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page).toHaveTitle("مدیر پروژه | تختهٔ کانبان");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/project-manager-logo.svg",
  );
  await expect(
    page.getByRole("link", { name: "مدیر پروژه، صفحهٔ اصلی" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "تختهٔ تیم محصول" })).toBeVisible();
  await expect(page.getByTestId(/^kanban-column-/)).toHaveCount(6);
  for (const name of [
    "برای انجام",
    "در حال انجام",
    "انجام‌شده",
    "در انتظار تأیید",
    "پروژه‌های در انتظار",
    "پروژه‌های اتمام‌شده",
  ]) {
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  await expect(page.getByText("بازنویسی متن صفحهٔ اصلی")).toBeVisible();
  await expect(page.getByTestId("card-count")).toHaveText("9");
});

test("adds and removes a card", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "افزودن کارت به برای انجام" }).click();
  await page.getByLabel("عنوان کارت").fill("آزمون جریان جدید");
  await page.getByLabel("جزئیات کارت").fill("این کارت برای آزمودن رابط ساخته شده است.");
  await page.getByRole("button", { name: "ثبت کارت" }).click();

  await expect(page.getByText("آزمون جریان جدید")).toBeVisible();
  await page
    .getByRole("button", { name: "حذف کارت آزمون جریان جدید" })
    .click();
  await expect(page.getByText("آزمون جریان جدید")).toHaveCount(0);
});

test("renames a column", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "تغییر نام ستون برای انجام" }).click();
  const nameInput = page.getByRole("textbox", { name: "نام ستون" });

  await nameInput.fill("ایده‌های تازه");
  await nameInput.press("Enter");

  await expect(
    page.getByRole("heading", { name: "ایده‌های تازه" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "نام ستون" })).toHaveCount(0);
  await expect(page.getByTestId(/^kanban-column-/)).toHaveCount(6);
});

test("closes the column editor on Enter when the name is blank", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "تغییر نام ستون برای انجام" }).click();
  const nameInput = page.getByRole("textbox", { name: "نام ستون" });

  await nameInput.fill(" ");
  await nameInput.press("Enter");

  await expect(page.getByRole("heading", { name: "برای انجام" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "نام ستون" })).toHaveCount(0);
});

test("edits a card title and details", async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId("kanban-card-brand-story");
  await card.getByRole("button", { name: "ویرایش کارت روایت تازه برای برند" }).click();
  await card.getByLabel("عنوان کارت").fill("روایت بازنگری‌شده");
  await card.getByLabel("جزئیات کارت").fill("جزئیات بازنگری‌شده");
  await card.getByRole("button", { name: "ذخیره تغییرات" }).click();

  await expect(card.getByRole("heading", { name: "روایت بازنگری‌شده" })).toBeVisible();
  await expect(card.getByText("جزئیات بازنگری‌شده")).toBeVisible();
});

test("moves a card to another column", async ({ page }) => {
  await signIn(page);
  const card = page.getByTestId("kanban-card-product-copy");
  const handle = card.getByTestId("drag-handle");
  const destination = page
    .getByTestId("kanban-column-awaiting-approval")
    .locator(".card-list");

  const sourceBox = await handle.boundingBox();
  const destinationBox = await destination.boundingBox();

  if (!sourceBox || !destinationBox) {
    throw new Error("Unable to locate the card or destination column");
  }

  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: destinationBox.x + destinationBox.width / 2,
    y: destinationBox.y + destinationBox.height / 2,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y + 8, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();

  await expect(
    page.getByTestId("kanban-column-awaiting-approval").getByText(
      "بازنویسی متن صفحهٔ اصلی",
    ),
  ).toBeVisible();
  await expect(
    page.getByTestId("kanban-column-in-progress").getByText(
      "بازنویسی متن صفحهٔ اصلی",
    ),
  ).toHaveCount(0);
});

test("reorders cards within the same column", async ({ page }) => {
  await signIn(page);
  const column = page.getByTestId("kanban-column-todo");
  const source = page
    .getByTestId("kanban-card-onboarding")
    .getByTestId("drag-handle");
  const target = page.getByTestId("kanban-card-brand-story");
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error("Unable to locate the cards to reorder");
  }

  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y - 8, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();

  await expect(column.locator(".task-card").first()).toHaveAttribute(
    "data-testid",
    "kanban-card-onboarding",
  );
});

test("reorders columns without moving their cards", async ({ page }) => {
  await signIn(page);
  const sourceColumn = page.getByTestId("kanban-column-in-progress");
  const targetColumn = page.getByTestId("kanban-column-todo");
  const sourceHandle = sourceColumn.getByTestId("column-drag-handle");
  const targetHeader = targetColumn.locator(".column-header");
  const sourceBox = await sourceHandle.boundingBox();
  const targetBox = await targetHeader.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error("Unable to locate the columns to reorder");
  }

  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();

  const columns = page.getByTestId("board-columns").locator(".kanban-column");
  await expect(columns.nth(0)).toHaveAttribute(
    "data-testid",
    "kanban-column-in-progress",
  );
  await expect(columns.nth(0).getByText("بازنویسی متن صفحهٔ اصلی")).toBeVisible();
  await expect(columns.nth(1)).toHaveAttribute(
    "data-testid",
    "kanban-column-todo",
  );
  await expect(columns.nth(1).getByText("روایت تازه برای برند")).toBeVisible();
});

test("keeps the columns horizontally scrollable on a small screen", async ({
  page,
}) => {
  await signIn(page);
  await page.setViewportSize({ width: 390, height: 844 });

  const dimensions = await page.locator(".board-columns").evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
});
