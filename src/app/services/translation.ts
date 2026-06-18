import { Injectable, signal } from '@angular/core';

export type Lang = 'en' | 'es';

@Injectable({
  providedIn: 'root'
})
export class TranslationService {
  currentLang = signal<Lang>('es');
  version = '1.0.0';

  private translations: Record<Lang, Record<string, string>> = {
    es: {
      'app.title': 'Trackingfy',
      'app.back': 'Atrás',
      'app.offline': 'Sin conexión',
      'app.history': 'Historial',
      'app.install_app': 'Instalar App',
      'app.toast_exit': 'Presiona atrás de nuevo para salir',
      
      'onboarding.welcome': 'Bienvenido a Trackingfy',
      'onboarding.description': 'Registra tus actividades al aire libre con precisión. Estadísticas en tiempo real, mapas interactivos e historial completo. No hay registro ni tampoco recopilamos tu información.',
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
      
      'confirm.title.stop': '¿Detener actividad?',
      'confirm.message.stop': '¿Estás seguro de que deseas detener y guardar esta sesión?',
      'confirm.btn.stop': 'Detener y guardar',
      'confirm.btn.resume': 'Reanudar',
      'confirm.btn.pause': 'Pausar',
      'confirm.message.active': 'Actividad en curso. ¿Qué deseas hacer?',
      'confirm.message.paused': 'Tu actividad está pausada.',
      'confirm.btn.confirm': 'Confirmar',
      'confirm.btn.cancel': 'Cancelar',
      
      'confirm.title.delete_single': 'Eliminar actividad',
      'confirm.message.delete_single': '¿Estás seguro de que deseas eliminar esta actividad? Esta acción no se puede deshacer.',
      'confirm.btn.delete': 'Eliminar',
      
      'confirm.title.delete_multiple': 'Eliminar actividades',
      'confirm.message.delete_multiple': '¿Estás seguro de que deseas eliminar {count} actividades? Esta acción no se puede deshacer.',
      'confirm.btn.delete_all': 'Eliminar todas',
      
      'dashboard.duration': 'Duración',
      'dashboard.distance': 'Distancia',
      'dashboard.avg_speed': 'Vel. Media',
      'dashboard.climb': 'Desnivel +',
      'dashboard.descent': 'Desnivel -',
      'dashboard.altitude': 'Altitud',
      'dashboard.activity': 'Actividad',
      'dashboard.center': 'Centrar',
      
      'activity.Cycling': 'Ciclismo',
      'activity.Running': 'Carrera',
      'activity.Walking': 'Caminata',
      'activity.Activity': 'Actividad',
      
      'history.selected': '{count} seleccionados',
      'history.activities': 'Actividades',
      'history.delete_selected': 'Eliminar selecc.',
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
      
      'tracking.bg_message': 'Trackingfy está registrando tu actividad.',
      'tracking.bg_title': 'Rastreo en curso',
    },
    en: {
      'app.title': 'Trackingfy',
      'app.back': 'Back',
      'app.offline': 'Offline',
      'app.history': 'History',
      'app.install_app': 'Install App',
      'app.toast_exit': 'Press back again to exit',
      
      'onboarding.welcome': 'Welcome to Trackingfy',
      'onboarding.description': 'Track your outdoor activities with precision. Real-time stats, interactive maps, and full history. No registration required, and we do not collect your information.',
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
      
      'confirm.title.stop': 'Stop Activity?',
      'confirm.message.stop': 'Are you sure you want to end and save this session?',
      'confirm.btn.stop': 'Stop and Save',
      'confirm.btn.resume': 'Resume',
      'confirm.btn.pause': 'Pause',
      'confirm.message.active': 'Activity in progress. What would you like to do?',
      'confirm.message.paused': 'Your activity is paused.',
      'confirm.btn.confirm': 'Confirm',
      'confirm.btn.cancel': 'Cancel',
      
      'confirm.title.delete_single': 'Delete Activity',
      'confirm.message.delete_single': 'Are you sure you want to delete this activity? This action cannot be undone.',
      'confirm.btn.delete': 'Delete',
      
      'confirm.title.delete_multiple': 'Delete Activities',
      'confirm.message.delete_multiple': 'Are you sure you want to delete {count} activities? This action cannot be undone.',
      'confirm.btn.delete_all': 'Delete All',
      
      'dashboard.duration': 'Duration',
      'dashboard.distance': 'Distance',
      'dashboard.avg_speed': 'Avg Speed',
      'dashboard.climb': 'Climb',
      'dashboard.descent': 'Descent',
      'dashboard.altitude': 'Altitude',
      'dashboard.activity': 'Activity',
      'dashboard.center': 'Center',
      
      'activity.Cycling': 'Cycling',
      'activity.Running': 'Running',
      'activity.Walking': 'Walking',
      'activity.Activity': 'Activity',
      
      'history.selected': '{count} selected',
      'history.activities': 'Activities',
      'history.delete_selected': 'Delete Selected',
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
      
      'tracking.bg_message': 'Trackingfy is tracking your activity.',
      'tracking.bg_title': 'Tracking in progress',
    }
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
