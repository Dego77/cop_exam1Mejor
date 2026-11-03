import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login.component';
import { EditorComponent } from './pages/editor/editor.component';
import { HelpComponent } from './pages/help/help.component';
import { ViewerProjectsComponent } from './pages/viewer/viewer-projects.component';
import { ViewerComponent } from './pages/viewer/viewer.component';

export const routes: Routes = [
  { path: '', redirectTo: 'editor', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'editor', component: EditorComponent },
  { path: 'help', component: HelpComponent },
  // "Modo Ver" for the mobile app: real-time, read-only
  { path: 'view', component: ViewerProjectsComponent },
  { path: 'view/:projectId', component: ViewerComponent },
  { path: '**', redirectTo: 'editor' }
];
