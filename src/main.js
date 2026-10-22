import { start } from './app.js';
import { friends } from './net/friends.js';

const app = start();
if (app) friends(app);
