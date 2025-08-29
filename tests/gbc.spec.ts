import { test, expect } from '@playwright/test';

test('homepage', async ({ page }) => {

  await page.goto('https://georgebrown.ca/');

  await page.screenshot({
    path: page.viewportSize()?.width + "_home.png"
  });

  await page.screenshot({
    path: page.viewportSize()?.width + "_home_full.png",
    fullPage: true
  });

});

test('g418', async ({ page, isMobile }) => {

  if (isMobile == true) {
    test.skip();
  }

  await page.goto('https://www.georgebrown.ca/programs/web-development-front-end-design-program-postgraduate-g418');

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418.png"
  });

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_full.png",
    fullPage: true
  });

  await page.locator("#tab-courses-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_courses_full.png",
    fullPage: true
  });

  await page.locator("#tab-tuition-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_tuition_full.png",
    fullPage: true
  });

  await page.locator("#tab-apply-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_apply_full.png",
    fullPage: true
  });

  await page.locator("#tab-outcomes-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_outcomes_full.png",
    fullPage: true
  });

  await page.locator("#tab-contact-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g418_contact_full.png",
    fullPage: true
  });
});




test('g301', async ({ page, isMobile }) => {

  if (isMobile == true) {
    test.skip();
  }

  await page.goto('https://www.georgebrown.ca/programs/honours-bachelor-of-digital-experience-design-program-g301');

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301.png"
  });

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301_full.png",
    fullPage: true
  });

  await page.locator("#tab-courses-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_301_courses_full.png",
    fullPage: true
  });

  await page.locator("#tab-tuition-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301_tuition_full.png",
    fullPage: true
  });

  await page.locator("#tab-apply-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301_apply_full.png",
    fullPage: true
  });

  await page.locator("#tab-outcomes-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301_outcomes_full.png",
    fullPage: true
  });

  await page.locator("#tab-contact-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g301_contact_full.png",
    fullPage: true
  });
});



test('g113', async ({ page, isMobile }) => {

  if (isMobile == true) {
    test.skip();
  }

  await page.goto('https://www.georgebrown.ca/programs/interaction-design-program-g113');

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113.png"
  });

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_full.png",
    fullPage: true
  });

  await page.locator("#tab-courses-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_courses_full.png",
    fullPage: true
  });

  await page.locator("#tab-tuition-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_tuition_full.png",
    fullPage: true
  });

  await page.locator("#tab-apply-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_apply_full.png",
    fullPage: true
  });

  await page.locator("#tab-outcomes-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_outcomes_full.png",
    fullPage: true
  });

  await page.locator("#tab-contact-2025").click();

  await page.screenshot({
    path: page.viewportSize()?.width + "_g113_contact_full.png",
    fullPage: true
  });
});
