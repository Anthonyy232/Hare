import { mount } from 'svelte';
import App from './App.svelte';
import '../../assets/ui.css';

const appElement = document.getElementById('app');
if (!appElement) {
  throw new Error('Failed to find app element');
}

const app = mount(App, {
  target: appElement,
});

export default app;
