import { Routes } from '@angular/router';
import { DashboardComponent } from './components/dashboard/dashboard';
import { HistoryComponent } from './components/history/history';
import { ActivityDetailComponent } from './components/activity-detail/activity-detail';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'history', component: HistoryComponent },
  { path: 'activity/:id', component: ActivityDetailComponent },
  { path: '**', redirectTo: 'dashboard' }
];
