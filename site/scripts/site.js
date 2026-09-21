// Progressive enhancements for the public pages. Everything works without JavaScript:
// this adds the mobile menu, a direct APK download and the live counter on the hero phone.
(() => {
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.getElementById('menu-movil');
  if (toggle && menu) {
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
      menu.hidden = !open;
    };
    toggle.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', (event) => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) {
        setOpen(false);
        toggle.focus();
      }
    });
  }

  // The APK links point at the GitHub release page, which works on its own. Here we ask
  // GitHub for the .apk asset of the latest release and start the download straight away,
  // the same way the app's Settings page does.
  const RELEASE_API = 'https://api.github.com/repos/David-TheBridgeDev/Trackingfy/releases/latest';
  for (const link of document.querySelectorAll('a[data-apk]')) {
    link.addEventListener('click', async (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      link.setAttribute('aria-busy', 'true');
      let target = link.href;
      try {
        const response = await fetch(RELEASE_API);
        if (response.ok) {
          const release = await response.json();
          const apk = (release.assets || []).find((asset) => asset.name.endsWith('.apk'));
          if (apk) target = apk.browser_download_url;
        }
      } catch {
        // Offline or rate limited: the release page still lists the file.
      }
      link.removeAttribute('aria-busy');
      window.location.href = target;
    });
  }

  const time = document.querySelector('[data-live-time]');
  const distance = document.querySelector('[data-live-distance]');
  if (time && distance && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let seconds = Number(time.dataset.liveTime);
    let meters = Number(distance.dataset.liveDistance);
    const pad = (value) => String(value).padStart(2, '0');
    setInterval(() => {
      if (document.hidden) return;
      seconds += 1;
      meters += 3.1; // about 11 km/h, the average shown next to it
      time.textContent = `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
      distance.textContent = `${(meters / 1000).toFixed(2)} km`;
    }, 1000);
  }
})();
