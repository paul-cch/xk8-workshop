// Hands-free steps, for greasy hands. While it is on, each step is read aloud as it opens, the screen stays awake, and where the
// browser can listen a spoken word moves the job on: next, back, repeat, torque, done or stop, in English or French. A browser
// that cannot listen still reads each step aloud. Listening uses the browser's own speech service: in Chrome that sends the
// audio to Google, so the toast that turns it on says so.
//
//   handsFree.toggle(on)        turns it on or off and says what it can do
//   handsFree.use({next, ...})  the current step's actions, replaced on every render
//   handsFree.read(key, text)   the step on screen: read once, now if hands-free is on, or as soon as it comes on
import {getLang, t} from '../i18n.js';
import {toast} from './widgets.js';

const Listener = typeof window !== 'undefined' ? window.SpeechRecognition ?? window.webkitSpeechRecognition : null;
const COMMANDS = [ // the first that matches wins, so stop and back come before the rest
  ['stop', /\b(stop|arr[êe]te[rz]?)\b/i],
  ['back', /\b(back|previous|go back|pr[ée]c[ée]dent[e]?|retour)\b/i],
  ['next', /\b(next|suivant[e]?|apr[èe]s|continue[rz]?)\b/i],
  ['repeat', /\b(repeat|again|say again|r[ée]p[èe]te[rz]?|encore)\b/i],
  ['torque', /\b(torque|tighten|couple|serrage)\b/i],
  ['done', /\b(done|finished|fait|termin[ée]|fini)\b/i],
];

let on = false, listener = null, lock = null, actions = {}, readKey = null, speaking = false;
let current = null; // {key, text}: the step on screen, read as soon as hands-free comes on

const voiceLang = () => (getLang() === 'fr' ? 'fr-FR' : 'en-GB');

/** Units as a voice says them. On screen they stay Nm and lb ft. */
const spoken = (text) => text.replace(/\bNm\b/g, t('newton metres|spoken')).replace(/\blb ft\b/g, t('pound feet|spoken'));

function say(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(spoken(text));
  u.lang = voiceLang();
  u.rate = 0.95;
  // The microphone would hear the voice: it rests while the phone talks.
  u.onstart = () => { speaking = true; listener?.abort(); };
  u.onend = u.onerror = () => { speaking = false; listen(); };
  speechSynthesis.speak(u);
}

function listen() {
  if (!on || !Listener || speaking) return;
  if (!listener) {
    listener = new Listener();
    listener.continuous = true;
    listener.interimResults = false;
    listener.onresult = (e) => {
      const heard = e.results[e.results.length - 1]?.[0]?.transcript ?? '';
      const hit = COMMANDS.find(([, re]) => re.test(heard));
      if (hit) actions[hit[0]]?.();
    };
    listener.onend = () => { if (on && !speaking) setTimeout(listen, 250); }; // Chrome stops after a silence: start again
    listener.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { listener = null; toast(t('The microphone is blocked, so each step is read aloud instead.')); } };
  }
  listener.lang = voiceLang();
  try { listener.start(); } catch { /* already listening */ }
}

async function keepAwake(want) {
  if (!want) { lock?.release().catch(() => {}); lock = null; return; }
  try { lock = await navigator.wakeLock?.request('screen'); } catch { lock = null; }
}

export const handsFree = {
  get on() { return on; },
  toggle(next = !on) {
    on = next;
    readKey = null;
    if (on) {
      keepAwake(true);
      listen();
      if (current) { readKey = current.key; say(current.text); }
      toast(Listener ? t('Hands-free on. Say next, back, repeat, torque or done. Your browser\'s speech service hears what you say.') : t('Hands-free on. This browser cannot listen, so each step is read aloud.'));
    } else {
      keepAwake(false);
      listener?.abort();
      listener = null;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    }
    actions.changed?.();
  },
  /** The current step's actions. stop is added here: saying stop turns hands-free off. */
  use(next) { actions = {...next, stop: () => handsFree.toggle(false)}; },
  read(key, text) { current = {key, text}; if (on && key !== readKey) { readKey = key; say(text); } },
  say,
};

document.addEventListener('visibilitychange', () => { if (!document.hidden && on) { keepAwake(true); listen(); } });
