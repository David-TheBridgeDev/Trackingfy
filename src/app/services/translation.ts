import { Injectable, signal } from '@angular/core';

export type Lang = 'en' | 'es';

@Injectable({
  providedIn: 'root',
})
export class TranslationService {
  currentLang = signal<Lang>('es');
  version = '1.0.4';

  private translations: Record<Lang, Record<string, string>> = {
    es: {
      'app.title': 'Trackingfy',
      'app.back': 'Atrás',
      'app.offline': 'Sin conexión',
      'app.history': 'Historial',
      'app.install_app': 'Instalar App',
      'app.download_apk': 'Descargar APK (Android)',
      'app.toast_exit': 'Presiona atrás de nuevo para salir',
      'app.error_download_not_found': 'No se encontró un APK en la última versión',
      'app.error_download_connection': 'Error al buscar actualizaciones',

      'onboarding.welcome': 'Bienvenido a Trackingfy',
      'onboarding.description':
        'Registra tus actividades al aire libre con precisión. Estadísticas en tiempo real, mapas interactivos e historial completo. No hay registro ni tampoco recopilamos tu información.',
      'onboarding.disclaimer':
        'Como no recopilamos ningún tipo de datos, y todo se almacena de forma local, cuando borres la aplicación se borrarán todos tus datos, incluido el historial. Ten en cuenta esto y recuerda hacer una copia de seguridad de todo para que puedas restaurarlo posteriormente si cambias de móvil.',
      'onboarding.go': 'Comenzar',

      'settings.title': 'Ajustes',
      'settings.language': 'Idioma',
      'settings.theme': 'Tema',
      'settings.theme.dark': 'Oscuro',
      'settings.theme.light': 'Claro',
      'settings.theme.coming_soon': 'Próximamente',
      'settings.version': 'Versión',
      'settings.made_by': 'Creado por David',
      'settings.close': 'Cerrar',
      'settings.tab.info': 'Información',
      'settings.tab.settings': 'Ajustes',
      'settings.default_activity': 'Actividad predeterminada',
      'settings.created_with_love': 'Creado con mucho amor y cariño:',
      'settings.backup': 'Copia de seguridad',
      'settings.backup.export': 'Exportar datos',
      'settings.backup.import': 'Importar datos',
      'settings.backup.success': 'Datos restaurados correctamente',
      'settings.backup.error': 'Error al restaurar los datos',
      'settings.backup.import_hint':
        'Acepta tanto una copia de seguridad completa como una ruta suelta compartida por otro usuario. En Android también puedes abrir el fichero o compartirlo directamente con Trackingfy.',
      'settings.backup.route_imported': 'Ruta importada a tu historial',
      'settings.backup.route_duplicate': 'Esa ruta ya está en tu historial',
      'settings.backup.route_invalid': 'Ese fichero no es una ruta de Trackingfy',
      'settings.backup.elevation_note':
        '* Al editar una ruta para añadirle un tramo, las coordenadas de ese tramo se envían a OpenMeteo, un proveedor externo, para obtener la altitud del terreno. El resto de la aplicación sigue funcionando solo en local.',

      'confirm.title.stop': '¿Detener actividad?',
      'confirm.message.stop': '¿Estás seguro de que deseas detener y guardar esta sesión?',
      'confirm.btn.stop': 'Detener y guardar',
      'confirm.btn.resume': 'Reanudar',
      'confirm.btn.pause': 'Pausar',
      'confirm.message.active': 'Actividad en curso. ¿Qué deseas hacer?',
      'confirm.message.paused': 'Tu actividad está pausada.',
      'confirm.btn.confirm': 'Confirmar',
      'confirm.btn.cancel': 'Cancelar',
      'confirm.btn.got_it': 'Entendido',

      'confirm.title.delete_single': 'Eliminar actividad',
      'confirm.message.delete_single':
        '¿Estás seguro de que deseas eliminar esta actividad? Esta acción no se puede deshacer.',
      'confirm.btn.delete': 'Eliminar',

      'confirm.title.delete_multiple': 'Eliminar actividades',
      'confirm.message.delete_multiple':
        '¿Estás seguro de que deseas eliminar {count} actividades? Esta acción no se puede deshacer.',
      'confirm.btn.delete_all': 'Eliminar todas',

      'dashboard.duration': 'Duración',
      'dashboard.moving_time': 'T. Movimiento',
      'dashboard.distance': 'Distancia',
      'dashboard.pace': 'Ritmo',
      'dashboard.avg_speed': 'Vel. Media',
      'dashboard.max_speed': 'Vel. Máx',
      'dashboard.climb': 'Desnivel +',
      'dashboard.descent': 'Desnivel -',
      'dashboard.altitude': 'Altitud',
      'dashboard.grade': 'Pendiente',
      'dashboard.activity': 'Actividad',
      'dashboard.center': 'Centrar',
      'dashboard.cancel_route': 'Limpiar mapa',

      'activity.Cycling': 'Ciclismo',
      'activity.Running': 'Correr',
      'activity.Walking': 'Caminata',
      'activity.Activity': 'Actividad',

      'history.selected': '{count} seleccionados',
      'history.activities': 'Actividades',
      'history.delete_selected': 'Eliminar selecc.',
      'history.cancel_selection': 'Cancelar',
      'history.no_activities': 'Aún no hay actividades registradas.',
      'history.start_first': 'Empieza tu primer registro',
      'history.no_results': 'Sin resultados',
      'history.adjust_filters': 'Intenta ajustar los filtros.',
      'history.clear_filters': 'Limpiar filtros',
      'history.filter.all': 'Todos',
      'history.sort.date': 'Fecha',
      'history.sort.distance': 'Distancia',
      'history.sort.duration': 'Duración',
      'history.sort.climb': 'Desnivel +',
      'history.sort.descent': 'Desnivel -',

      'detail.not_found': 'Actividad no encontrada.',
      'detail.back_history': 'Volver al historial',
      'detail.follow_route': 'Seguir esta ruta',
      'detail.export_route': 'Exportar ruta (JSON)',
      'detail.export.error': 'No se pudo exportar la ruta',
      'detail.edit_route': 'Editar ruta',
      'detail.edited_badge': 'Editada',

      'detail.edit.title': 'Añadir tramo al inicio',
      'detail.edit.help':
        'Toca el mapa marcando el recorrido que no se grabó, desde donde saliste de verdad hasta el punto rojo donde arrancó la grabación. Arrastra un punto para moverlo, o tócalo para quitarlo. Si vuelves a editar la ruta, el tramo que ya añadiste aparece aquí para que lo retoques.',
      'detail.edit.help_button': 'Cómo funciona',
      'detail.edit.map_hint': 'Toca para añadir · arrastra o toca un punto',
      'detail.edit.clears_opening':
        'Al guardar se quitará el tramo añadido y la actividad volverá a lo que grabó el GPS.',
      'detail.edit.points': 'Puntos',
      'detail.edit.added_distance': 'Distancia +',
      'detail.edit.added_time': 'Tiempo +',
      'detail.edit.start_time': 'Hora real de inicio',
      'detail.edit.start_time_hint':
        'Proponemos la hora que sale de aplicar tu ritmo medio. Corrígela con la hora a la que saliste de verdad.',
      'detail.edit.segment_speed': 'Velocidad del tramo',
      'detail.edit.speed_warning':
        'Esa velocidad es poco realista para esta actividad. Revisa la hora de inicio o los puntos marcados.',
      'detail.edit.elevation_note':
        'El desnivel del tramo se calcula al guardar, consultando el modelo de elevación del terreno.',
      'detail.edit.undo': 'Deshacer',
      'detail.edit.clear': 'Borrar',
      'detail.edit.save': 'Guardar',
      'detail.edit.saving': 'Guardando...',
      'detail.edit.saved': 'Ruta actualizada',
      'detail.edit.error': 'No se pudo guardar el tramo añadido',
      'detail.edit.invalid.no-points': 'Marca al menos un punto en el mapa.',
      'detail.edit.invalid.no-anchor': 'Esta actividad no tiene puntos grabados.',
      'detail.edit.invalid.zero-distance': 'Los puntos marcados están demasiado juntos.',
      'detail.edit.invalid.start-after-anchor':
        'La hora de inicio tiene que ser anterior al primer punto grabado.',

      'tracking.bg_message': 'Trackingfy está registrando tu actividad.',
      'tracking.bg_title': 'Rastreo en curso',
      'share.title': 'Mi ruta en Trackingfy',
      'share.text': '¡Mira mi ruta en Trackingfy!',
      'share.dialog_title': 'Compartir ruta',
      'share.route.title': 'Ruta de Trackingfy',
      'share.route.text': 'Te comparto esta ruta para que la abras en Trackingfy.',
      'share.route.dialog_title': 'Compartir ruta (JSON)',
    },
    en: {
      'app.title': 'Trackingfy',
      'app.back': 'Back',
      'app.offline': 'Offline',
      'app.history': 'History',
      'app.install_app': 'Install App',
      'app.download_apk': 'Download APK (Android)',
      'app.toast_exit': 'Press back again to exit',
      'app.error_download_not_found': 'No APK found in the latest release',
      'app.error_download_connection': 'Error checking for updates',

      'onboarding.welcome': 'Welcome to Trackingfy',
      'onboarding.description':
        'Track your outdoor activities with precision. Real-time stats, interactive maps, and full history. No registration required, and we do not collect your information.',
      'onboarding.disclaimer':
        'Since we do not collect any type of data, and everything is stored locally, when you delete the application all your data will be deleted, including your history. Keep this in mind and remember to backup everything so you can restore it later if you change your phone.',
      'onboarding.go': 'Go',

      'settings.title': 'Settings',
      'settings.language': 'Language',
      'settings.theme': 'Theme',
      'settings.theme.dark': 'Dark',
      'settings.theme.light': 'Light',
      'settings.theme.coming_soon': 'Coming soon',
      'settings.version': 'Version',
      'settings.made_by': 'Made by David',
      'settings.close': 'Close',
      'settings.tab.info': 'Info',
      'settings.tab.settings': 'Settings',
      'settings.default_activity': 'Default activity',
      'settings.created_with_love': 'Created with lots of love and care:',
      'settings.backup': 'Backup & Restore',
      'settings.backup.export': 'Export Data',
      'settings.backup.import': 'Import Data',
      'settings.backup.success': 'Data restored successfully',
      'settings.backup.error': 'Error restoring data',
      'settings.backup.import_hint':
        'Accepts both a full backup and a single route shared by another user. On Android you can also open the file or share it straight to Trackingfy.',
      'settings.backup.route_imported': 'Route imported into your history',
      'settings.backup.route_duplicate': 'That route is already in your history',
      'settings.backup.route_invalid': 'That file is not a Trackingfy route',
      'settings.backup.elevation_note':
        '* When you edit a route to add a stretch, the coordinates of that stretch are sent to OpenMeteo, an external provider, to obtain the terrain altitude. Everything else in the app stays local.',

      'confirm.title.stop': 'Stop Activity?',
      'confirm.message.stop': 'Are you sure you want to end and save this session?',
      'confirm.btn.stop': 'Stop and Save',
      'confirm.btn.resume': 'Resume',
      'confirm.btn.pause': 'Pause',
      'confirm.message.active': 'Activity in progress. What would you like to do?',
      'confirm.message.paused': 'Your activity is paused.',
      'confirm.btn.confirm': 'Confirm',
      'confirm.btn.cancel': 'Cancel',
      'confirm.btn.got_it': 'Got it',

      'confirm.title.delete_single': 'Delete Activity',
      'confirm.message.delete_single':
        'Are you sure you want to delete this activity? This action cannot be undone.',
      'confirm.btn.delete': 'Delete',

      'confirm.title.delete_multiple': 'Delete Activities',
      'confirm.message.delete_multiple':
        'Are you sure you want to delete {count} activities? This action cannot be undone.',
      'confirm.btn.delete_all': 'Delete All',

      'dashboard.duration': 'Duration',
      'dashboard.moving_time': 'Moving Time',
      'dashboard.distance': 'Distance',
      'dashboard.pace': 'Pace',
      'dashboard.avg_speed': 'Avg. Speed',
      'dashboard.max_speed': 'Max Speed',
      'dashboard.climb': 'Climb +',
      'dashboard.descent': 'Descent -',
      'dashboard.altitude': 'Altitude',
      'dashboard.grade': 'Grade',
      'dashboard.activity': 'Activity',
      'dashboard.center': 'Center',
      'dashboard.cancel_route': 'Clear Map',

      'activity.Cycling': 'Cycling',
      'activity.Running': 'Running',
      'activity.Walking': 'Walking',
      'activity.Activity': 'Activity',

      'history.selected': '{count} selected',
      'history.activities': 'Activities',
      'history.delete_selected': 'Delete Selected',
      'history.cancel_selection': 'Cancel',
      'history.no_activities': 'No activities recorded yet.',
      'history.start_first': 'Start your first track',
      'history.no_results': 'No results found',
      'history.adjust_filters': 'Try adjusting your filters.',
      'history.clear_filters': 'Clear all filters',
      'history.filter.all': 'All',
      'history.sort.date': 'Date',
      'history.sort.distance': 'Distance',
      'history.sort.duration': 'Duration',
      'history.sort.climb': 'Climb',
      'history.sort.descent': 'Descent',

      'detail.not_found': 'Activity not found.',
      'detail.back_history': 'Back to History',
      'detail.follow_route': 'Follow this route',
      'detail.export_route': 'Export route (JSON)',
      'detail.export.error': 'Could not export the route',
      'detail.edit_route': 'Edit route',
      'detail.edited_badge': 'Edited',

      'detail.edit.title': 'Add an opening stretch',
      'detail.edit.help':
        'Tap the map to trace the stretch that was never recorded, from where you actually set off to the red point where recording began. Drag a point to move it, or tap it to remove it. Editing the route again brings the stretch you already added back here to be adjusted.',
      'detail.edit.help_button': 'How this works',
      'detail.edit.map_hint': 'Tap to add · drag or tap a point',
      'detail.edit.clears_opening':
        'Saving will remove the added stretch and return the activity to what the GPS recorded.',
      'detail.edit.points': 'Points',
      'detail.edit.added_distance': 'Distance +',
      'detail.edit.added_time': 'Time +',
      'detail.edit.start_time': 'Actual start time',
      'detail.edit.start_time_hint':
        'We propose the time your average pace implies. Correct it with the time you really set off.',
      'detail.edit.segment_speed': 'Segment speed',
      'detail.edit.speed_warning':
        'That speed is unrealistic for this activity. Check the start time or the points you marked.',
      'detail.edit.elevation_note':
        'Elevation for this stretch is resolved on save, from a terrain elevation model.',
      'detail.edit.undo': 'Undo',
      'detail.edit.clear': 'Clear',
      'detail.edit.save': 'Save',
      'detail.edit.saving': 'Saving...',
      'detail.edit.saved': 'Route updated',
      'detail.edit.error': 'Could not save the added stretch',
      'detail.edit.invalid.no-points': 'Mark at least one point on the map.',
      'detail.edit.invalid.no-anchor': 'This activity has no recorded points.',
      'detail.edit.invalid.zero-distance': 'The marked points are too close together.',
      'detail.edit.invalid.start-after-anchor':
        'The start time must be earlier than the first recorded point.',

      'tracking.bg_message': 'Trackingfy is tracking your activity.',
      'tracking.bg_title': 'Tracking in progress',
      'share.title': 'My route on Trackingfy',
      'share.text': 'Check out my route on Trackingfy!',
      'share.dialog_title': 'Share route',
      'share.route.title': 'Trackingfy route',
      'share.route.text': 'Here is a route for you to open in Trackingfy.',
      'share.route.dialog_title': 'Share route (JSON)',
    },
  };

  constructor() {
    this.loadLang();
  }

  private loadLang() {
    const saved = localStorage.getItem('trackingfy_lang') as Lang;
    if (saved === 'en' || saved === 'es') {
      this.currentLang.set(saved);
    } else {
      const browserLang = navigator.language.startsWith('es') ? 'es' : 'en';
      this.currentLang.set(browserLang);
    }
  }

  setLanguage(lang: Lang) {
    this.currentLang.set(lang);
    localStorage.setItem('trackingfy_lang', lang);
  }

  t(key: string, params?: Record<string, string | number>): string {
    const lang = this.currentLang();
    let text = this.translations[lang]?.[key] || this.translations['en']?.[key] || key;

    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
      });
    }

    return text;
  }
}
