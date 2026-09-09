import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login.component';
import { EditorComponent } from './pages/editor/editor.component';
import { HelpComponent } from './pages/help/help.component';

export const routes: Routes = [
  { path: '', redirectTo: 'editor', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'editor', component: EditorComponent },
  { path: 'help', component: HelpComponent },
  { path: '**', redirectTo: 'editor' }
];
