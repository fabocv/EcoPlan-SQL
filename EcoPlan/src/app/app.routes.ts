import { Routes } from '@angular/router';
import { Dashboard } from './core/dashboard/dashboard';

export const routes: Routes = [
    { path: 'dash', component: Dashboard },
    { path: '', redirectTo: 'dash', pathMatch: 'full' },
    { path: '**', redirectTo: 'dash' }
];
