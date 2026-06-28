import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # Set mobile viewport to see how it looks on a phone, as Ionic is typically mobile first
        context = await browser.new_context(
            viewport={'width': 390, 'height': 844},
            record_video_dir="/home/jules/verification/videos/",
            record_video_size={"width": 390, "height": 844}
        )
        page = await context.new_page()

        # Go to the local app
        await page.goto('http://localhost:4200/')

        # Wait for the onboarding modal to appear
        await page.wait_for_timeout(2000)

        # Click the "GO" button
        try:
            await page.get_by_text("GO").click(timeout=3000)
        except Exception:
            pass

        try:
            await page.get_by_text("Empezar").click(timeout=3000)
        except Exception:
            pass

        # Wait for transition
        await page.wait_for_timeout(2000)

        # Click Start Activity button (the big round button in the center bottom)
        # It's an ion-fab-button with class "tracking-button"
        try:
            await page.locator('ion-fab-button.tracking-button').click(force=True, timeout=3000)
        except Exception as e:
            print("Could not click start:", e)

        # Wait to let the tracking state update and UI changes reflect
        await page.wait_for_timeout(3000)

        # Take a screenshot
        await page.screenshot(path='/home/jules/verification/screenshots/dashboard_active.png', full_page=True)
        print("Screenshot saved to /home/jules/verification/screenshots/dashboard_active.png")

        await context.close()
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
