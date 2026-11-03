// The feedback button and its form. A message goes to a private inbox: worker/_worker.js takes it, and docs/status.md says how
// to read it. The page makes no request until someone presses Send, or until a message saved while offline can go.
//
//   mount(app, {top, before, dock})   puts the button in the top bar, and keeps the "Something wrong here?" link in a job step or
//                                     part panel. Those panels repaint themselves freely, so the link is put back after they do.
//   app.ui.feedback(here)             opens the form. here is {aboutKind, about, label}, from hereNow(), or nothing.
import {data, en, jobSteps} from '../data.js';
import {N, plural, t} from '../i18n.js';
import {formatHash, variantCode} from '../state.js';
import {dialog, h, toast} from './widgets.js';

// Absolute, because a file:// copy of the page has no site of its own to post to.
const API = 'https://xk8-workshop.pages.dev/api/feedback';
const QUEUE_KEY = 'xk8-feedback-queue';
const QUEUE_MAX = 20;
const MAX_MESSAGE = 2000, MAX_CONTACT = 200, MAX_PAGE = 500, MAX_ABOUT = 300; // as in worker/_worker.js
const SHOW_COUNT_FROM = 200; // characters left at which the count appears
const WAIT_MS = 15000;
const KINDS = [['wrong', N('Something is wrong')], ['idea', N('I have an idea')], ['thanks', N('Thank you')]];
const BUBBLE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V6A1.5 1.5 0 0 1 4 4.5Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M7 9h10M7 13h6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';

// ---- sending and the saved queue ------------------------------------------------------------------------------------------

/** What became of a send. sent: it is there. offline, down, busy: worth another try later. refused: it will never be taken. */
async function post(item) {
  if (navigator.onLine === false) return 'offline';
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), WAIT_MS);
  try {
    const r = await fetch(API, {method: 'POST', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', headers: {'content-type': 'application/json'}, body: JSON.stringify(item), signal: stop.signal});
    if (r.ok) return 'sent';
    if (r.status === 429) return 'busy';
    return r.status >= 500 ? 'down' : 'refused';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

function readQueue() {
  try {
    const q = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(q) ? q : [];
  } catch { return []; }
}
function writeQueue(q) {
  try {
    if (q.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); else localStorage.removeItem(QUEUE_KEY);
    return true;
  } catch { return false; }
}
/** False when this device cannot hold it: the person has to hear that, because the message is about to go. */
function keep(item) {
  const q = readQueue();
  return q.length < QUEUE_MAX && writeQueue([...q, item]);
}

let flushing = false;
/** Sends what was saved, oldest first, and stops at the first one that cannot go yet. */
async function flush() {
  if (flushing || navigator.onLine === false || !readQueue().length) return;
  flushing = true;
  let sent = 0, lost = 0;
  try {
    for (;;) {
      const [item] = readQueue();
      if (!item) break;
      const result = await post(item);
      if (result !== 'sent' && result !== 'refused') break;
      if (result === 'sent') sent++; else lost++;
      const gone = JSON.stringify(item); // by content, not position: another tab may be working through the same list
      writeQueue(readQueue().filter((x) => JSON.stringify(x) !== gone));
    }
  } finally {
    flushing = false;
  }
  if (lost) toast(plural(lost, 'A saved message could not be sent, and was removed.', '{n} saved messages could not be sent, and were removed.'));
  else if (sent) toast(plural(sent, 'Your saved message has been sent.', 'Your {n} saved messages have been sent.'));
}

// ---- what the message is about ----------------------------------------------------------------------------------------------

/** The job step or part on screen, or null. about is English, for the inbox. label is in the reader's language, for the form. */
function hereNow(s) {
  if (s.mode === 'jobs' && s.job?.step != null) {
    const job = data.jobs.byId.get(s.job.id);
    const st = job && jobSteps(job, s.variant)[s.job.step];
    if (st) return {aboutKind: 'step', about: `${en(job, 'title')} > ${s.job.step + 1} > ${en(st, 'title')}`, label: t('{job}, step {n}', {job: job.title, n: s.job.step + 1})};
  }
  const part = s.mode === 'explore' && s.selected ? data.parts.byId.get(s.selected) : null;
  return part ? {aboutKind: 'part', about: `${en(part, 'name')} (${part.id})`, label: part.name} : null;
}

// ---- the form -------------------------------------------------------------------------------------------------------------

function outcome(kind) {
  switch (kind) {
    case 'sent': return [t('Message sent'), t('Thank you. Your message has reached us.')];
    case 'offline': return [t('Saved for later'), t('You are offline. Your message is saved on this device and will be sent next time you are online.')];
    case 'busy': return [t('Saved for later'), t('Too many messages have come from here this hour. Yours is saved on this device and will be sent later.')];
    default: return [t('Saved for later'), t('We could not reach the inbox just now. Your message is saved on this device and will be sent later.')];
  }
}

function openForm(app, here) {
  const s = app.store.get();
  const choices = KINDS.map(([value, label]) => h('label.fb-choice', [h('input', {type: 'radio', name: 'fb-kind', value, checked: !!here && value === 'wrong'}), h('span', t(label))]));
  const message = h('textarea.fb-input.fb-text', {id: 'fb-message', rows: 4, maxLength: MAX_MESSAGE});
  const contact = h('input.fb-input', {id: 'fb-contact', type: 'email', autocomplete: 'email', maxLength: MAX_CONTACT});
  const trap = h('input', {type: 'text', name: 'website', tabIndex: -1, autocomplete: 'off'}); // only a robot fills this in
  const left = h('p.fb-left', {'aria-live': 'polite'});
  const problem = h('p.fb-problem', {role: 'alert', hidden: true});
  const send = h('button.btn.fb-send', {type: 'submit'}, t('Send'));
  const say = (text) => { problem.textContent = text; problem.hidden = !text; };
  const chosen = () => choices.map((c) => c.querySelector('input')).find((i) => i.checked)?.value;

  message.addEventListener('input', () => {
    const n = MAX_MESSAGE - message.value.length;
    left.textContent = n <= SHOW_COUNT_FROM ? plural(n, '{n} character left', '{n} characters left') : '';
  });

  const form = h('form.fb', {noValidate: true}, [
    here && h('p.fb-about', t('About: {what}', {what: here.label})),
    h('fieldset.fb-kinds', [h('legend.vh', t('What kind of message is this?')), choices]),
    h('label.fb-label', {for: 'fb-message'}, t('Your message')),
    message,
    left,
    h('label.fb-label', {for: 'fb-contact'}, t('Your email, if you would like a reply (optional)')),
    contact,
    h('label.vh', {'aria-hidden': 'true'}, [t('Leave this empty'), trap]),
    h('p.fb-note', t('We receive your message, the page you were on and which car you chose. Your email is used only to reply. We do not keep your IP address: a scrambled tag that stops spam is wiped within an hour.')),
    problem,
    send,
  ]);

  const d = dialog({title: t('Send feedback'), className: 'dlg-feedback', body: form});

  const finish = (result) => {
    const [title, text] = outcome(result);
    const done = h('button.btn.fb-send', {type: 'button', onclick: () => d.close()}, t('Close'));
    form.replaceWith(h('div.fb.fb-done', {role: 'status'}, [h('p.fb-done-title', title), h('p', text), done]));
    done.focus();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = chosen();
    const text = message.value.trim();
    if (!kind) { say(t('Choose one of the three first.')); choices[0].querySelector('input').focus(); return; }
    if (!text && kind !== 'thanks') { say(t('Please write a few words first.')); message.focus(); return; }
    say('');
    send.disabled = true;
    send.textContent = t('Sending');
    const item = {
      kind, message: text, contact: contact.value.trim(), page: formatHash(s).slice(0, MAX_PAGE),
      car: s.chosen || s.linked ? variantCode(s.variant) : '',
      aboutKind: here?.aboutKind ?? '', about: here?.about.slice(0, MAX_ABOUT) ?? '', website: trap.value,
    };
    const result = await post(item);
    if (result === 'sent') { finish('sent'); flush(); return; }
    if (result !== 'refused' && keep(item)) { finish(result); return; }
    // Nothing was kept, so the words stay on screen where the person can still copy them.
    say(result === 'refused' ? t('That could not be sent. Your words are still here: please check them and try again.') : t('That could not be sent or saved on this device. Your words are still here: please try again later.'));
    send.disabled = false;
    send.textContent = t('Send');
  });
  // A ring round the first choice reads as chosen on a phone, and focus on the box would throw the keyboard up.
  if (!here && matchMedia('(pointer: coarse)').matches) { const head = d.querySelector('.dlg-title'); head.tabIndex = -1; head.focus(); } else (here ? message : choices[0].querySelector('input')).focus();
}

// ---- the button and the link --------------------------------------------------------------------------------------------

export function mount(app, {top, before, dock}) {
  const {store} = app;
  const word = h('span.fb-word');
  const button = h('button.toggle.fb-btn', {type: 'button', onclick: () => app.ui.feedback()});
  button.innerHTML = BUBBLE;
  button.append(word);
  top.insertBefore(button, before);

  const link = h('button.link.fb-here', {type: 'button', onclick: () => app.ui.feedback(hereNow(store.get()))});
  const paintWords = () => {
    word.textContent = t('Feedback');
    button.setAttribute('aria-label', t('Send feedback'));
    button.title = t('Send feedback');
    link.textContent = t('Something wrong here?');
  };

  /** The end of the step or part on screen, or null. */
  const home = () => {
    const s = store.get();
    if (!hereNow(s)) return null;
    if (s.mode === 'jobs') {
      const scroll = dock.querySelector('.panel[data-mode=jobs] .ws-scroll');
      return scroll?.dataset.key?.startsWith('step-') ? scroll : null;
    }
    return dock.querySelector('.panel[data-mode=explore] .part-prov')?.parentElement ?? null;
  };
  const place = () => {
    const to = home();
    if (!to) link.remove();
    else if (to.lastElementChild !== link) to.append(link);
  };

  app.ui.feedback = (here = null) => openForm(app, here);
  paintWords();
  new MutationObserver(place).observe(dock, {childList: true, subtree: true});
  store.subscribe((s, changed) => {
    if (changed.has('lang')) paintWords();
    place();
  }, ['lang', 'mode', 'job', 'selected', 'variant']);
  place();

  // A message saved earlier goes when the network comes back, or when the page next opens or is looked at again.
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  flush();
}
