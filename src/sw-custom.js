importScripts('./ngsw-worker.js');

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-activities') {
    console.log('[SW] Syncing activities...');
    // Here you would call an API to sync pending activities to a server
    // For now, it's a placeholder for future cloud sync
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'tracking-keep-alive') {
    console.log('[SW] Periodic keep-alive triggered');
    // This event "wakes up" the Service Worker.
    // We can show a notification to keep the user informed
    // or try to communicate with the app.
    event.waitUntil(
      self.registration.showNotification('Trackingfy', {
        body: 'Manteniendo el tracking activo...',
        icon: '/icons/favicon-96x96.png',
        tag: 'tracking-active',
        silent: true
      })
    );
  }
});
