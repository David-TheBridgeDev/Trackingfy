import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context(
            viewport={'width': 390, 'height': 844},
            record_video_dir="/home/jules/verification/videos/",
            record_video_size={"width": 390, "height": 844}
        )
        page = await context.new_page()

        print("Navigating to app...")
        await page.goto('http://localhost:4200/')

        print("Waiting 2s for modal...")
        await page.wait_for_timeout(2000)

        # In the HTML we see "onboarding.go" translates to GO in English and Empezar in Spanish.
        # But wait, we saw "WELCOME TO TRACKINGFY".
        # Click exactly on the GO or Empezar button. Let's use the explicit button selector.
        print("Attempting to click onboarding go button...")
        try:
            # The button has text from translation: {{ ts.t('onboarding.go') }}
            await page.locator('button:has-text("GO")').click(timeout=3000)
            print("Clicked GO!")
        except Exception as e:
            print("GO button click failed:", e)
            try:
                await page.locator('button:has-text("Empezar")').click(timeout=3000)
                print("Clicked Empezar!")
            except Exception as e2:
                print("Empezar button click failed:", e2)

        print("Waiting 2s for transition...")
        await page.wait_for_timeout(2000)

        print("Attempting to click Start Tracking button...")
        try:
            await page.locator('button').filter(has=page.locator('svg')).nth(2).click(force=True, timeout=3000)
            print("Clicked Start!")
        except Exception as e:
            print("Could not click start:", e)
            # Try alternate selector
            try:
                await page.evaluate("""() => {
                    const btns = document.querySelectorAll('button');
                    for (const b of btns) {
                        if (b.classList.contains('w-24') && b.classList.contains('h-24')) {
                            b.click();
                            return;
                        }
                    }
                }""")
                print("Clicked Start via JS!")
            except Exception as e3:
                print("JS click failed:", e3)

        print("Waiting 3s for tracking active state...")
        await page.wait_for_timeout(3000)

        await page.screenshot(path='/home/jules/verification/screenshots/dashboard_active_v2.png', full_page=True)
        print("Screenshot saved to /home/jules/verification/screenshots/dashboard_active_v2.png")

        await context.close()
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
