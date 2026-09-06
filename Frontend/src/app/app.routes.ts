import { Routes } from '@angular/router';
import { LoginComponent } from './pages/login/login.component';
import { EditorComponent } from './pages/editor/editor.component';

export const routes: Routes = [
  { path: '', redirectTo: 'editor', pathMatch: 'full' },
  { path: 'login', component: LoginComponent },
  { path: 'editor', component: EditorComponent },
  { path: '**', redirectTo: 'editor' }
];
