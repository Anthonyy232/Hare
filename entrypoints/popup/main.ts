import { mount } from 'svelte';
import App from './App.svelte';
import '../../assets/ui.css';

mount(App, { target: document.getElementById('app')! });
