import './styles.css';
import { App } from './ui/App';

const app = new App(document.getElementById('app')!);
// デバッグ・自動テスト用
(window as any).kuroi = app;
