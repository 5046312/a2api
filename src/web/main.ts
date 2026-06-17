import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from '@web/App.vue';
import { router } from '@web/router';
import { useAdminSessionStore } from '@web/stores/adminSession';
import 'vfonts/Lato.css';
import 'vfonts/FiraCode.css';
import '@styles/main.scss';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia).use(router);
useAdminSessionStore().bindTokenEvents();
app.mount('#root');
