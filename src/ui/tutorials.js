// Tutorials: films and written guides beside the job, fault, weak spot or part they show. data.js picks and orders them; this
// file draws them. Thumbnails load from YouTube as a panel opens, and a film loads only after a tap. The one player sits above
// the panel's scroller, outside what panels repaint, so a repaint cannot restart a film and Next and Back stay on screen.
import {BASICS, convertTorqueText, data, jobSteps, stepTutorial, tutorialsFor} from '../data.js';
import {N, getLang, isFrench, plural, t} from '../i18n.js';
import {callout, icon, openJob, openSection, section} from './jobs.js';
import {gloss} from './terms.js';
import {h, toast} from './widgets.js';

const JOB_SHOWN = 2; // the rest wait behind a tap, so their thumbnails do too
const PANEL_SHOWN = 1;
const ALLOW = ['autoplay', 'encrypted-media', 'picture-in-picture', 'fullscreen'].join('; ');

const FIT = {exact: N('Filmed on an XK8'), 'same-engine': N('Same engine, different Jaguar'), general: N('Same job, different car')};
const LANGUAGE = {en: N('In English'), fr: N('In French')};

const isVideo = (r) => r.kind === 'video';
const embeds = (r) => r.embeddable !== false;
const videoId = (r) => r.id.slice(3);
const watchUrl = (r, at) => `https://www.youtube.com/watch?v=${videoId(r)}${at ? `&t=${at}s` : ''}`;
const embedUrl = (r, at) => `https://www.youtube-nocookie.com/embed/${videoId(r)}?autoplay=1&playsinline=1&rel=0${at ? `&start=${at}` : ''}${isFrench() ? '&hl=fr&cc_lang_pref=fr' : ''}`;
const thumbUrl = (r) => `https://i.ytimg.com/vi/${videoId(r)}/hqdefault.jpg`;
const away = (href) => ({href, target: '_blank', rel: 'noopener noreferrer'});

const fitWord = (r) => (r.fit === 'exact' && !isVideo(r) ? t('Written for an XK8') : t(FIT[r.fit]));
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function length(sec) {
  const n = Math.max(1, Math.round(sec / 60));
  return n < 60 ? t('{n} min', {n}) : t('{h} h {n} min', {h: Math.floor(n / 60), n: n % 60});
}

// ---- the player -------------------------------------------------------------------------------------------------------------

let player = null;

function stop() {
  if (!player) return null;
  const was = player;
  player = null;
  was.off();
  was.dock.remove();
  was.app.ui.film?.(0);
  for (const n of was.root.querySelectorAll('.tut-thumb[hidden]')) n.hidden = false;
  return was;
}

/** Closes the film, if one is open. Someone on the keyboard goes back to the button that started it. */
export function closePlayer() {
  const was = stop();
  if (!was) return;
  was.app.ui.lower?.();
  if (!was.keyboard) return;
  const {fk} = was.from.dataset; // a repaint may have replaced the button
  (was.from.isConnected ? was.from : fk && was.root.querySelector(`[data-fk="${CSS.escape(fk)}"]`))?.focus({preventScroll: true});
}

/** What a film belongs to. When this changes the film stops: a next step keeps it, another job or part does not. */
const placeOf = (s) => [s.mode, s.job?.id, s.mode === 'explore' ? s.selected : null, s.lang].join();

/** A new step, with this film open: on to that step's moment, if one is recorded. Otherwise the film stays where it is. */
function follow(s) {
  const {rec, job, frame} = player;
  const shown = s.job?.step == null ? null : jobSteps(job, s.variant)[s.job.step];
  const n = shown ? job.steps.indexOf(shown) : -1;
  const at = rec.steps?.find((x) => x.job === job.id && x.step === n)?.atSec;
  if (at == null || at === player.at) return;
  player.at = at;
  frame.src = embedUrl(rec, at);
}

function play(app, r, at, from) {
  if (navigator.onLine === false) { toast(t('Videos need a connection. The written steps still work.')); return; }
  stop();
  const keyboard = from.matches(':focus-visible');
  const root = from.closest('.ws') ?? from.closest('.panel');
  const close = h('button.tut-close', {type: 'button', onclick: closePlayer}, [icon('x'), t('Close video')]);
  const frame = h('iframe', {title: r.title, allow: ALLOW, allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', src: embedUrl(r, at)});
  const dock = h('div.tut-dock', {role: 'region', 'aria-label': t('Video player')}, [
    h('div.tut-frame', frame),
    h('div.tut-bar', [h('a.tut-out', away(watchUrl(r, at)), [icon('out'), t('Open on YouTube')]), close]),
  ]);
  // On a phone the film goes over the car, where it costs the text nothing, and the sheet sits under it. On a wide screen it heads the panel.
  const over = app.ui.filmOver?.(dock);
  if (!over) root.prepend(dock);
  const s = app.store.get(), place = placeOf(s);
  player = {app, dock, from, root, keyboard, rec: r, job: data.jobs.byId.get(s.job?.id), frame, at, off: app.store.subscribe((n) => { if (placeOf(n) !== place) stop(); else if (player.job) follow(n); }, ['mode', 'job', 'selected', 'lang'])};
  if (from.classList.contains('tut-thumb')) from.hidden = true; // the same picture and play button under a playing film is one more thing to tap
  if (keyboard) close.focus({preventScroll: true});
  if (!over) app.ui.reveal(s.job?.step != null ? dock : root);
}

// ---- cards --------------------------------------------------------------------------------------------------------------------

const tags = (r) => h('div.tut-tags', [
  !isVideo(r) && h('span.ws-tag', r.kind === 'forum' ? t('Forum thread') : t('Written guide')),
  h('span.ws-tag.tut-fit', fitWord(r)),
  h(`span.ws-tag.tut-fit${r.lang === getLang() ? '' : '.ws-tag--ink'}`, t(LANGUAGE[r.lang])),
]);
const caution = (r, s) => r.caution && callout('warn', t('Be careful'), h('p', convertTorqueText(r.caution, s.units)));

function thumb(app, r) {
  const face = [
    h('img.tut-img', {alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer', src: thumbUrl(r), onerror: (e) => e.target.remove()}), // the plain panel under it is the offline look
    h('span.tut-play', icon('play')),
  ];
  if (!embeds(r)) return h('a.tut-thumb', {...away(watchUrl(r)), 'aria-label': t('Watch on YouTube: {title}', {title: r.title})}, [face, h('span.tut-note', t('Opens on YouTube'))]);
  return h('button.tut-thumb', {type: 'button', hidden: player?.rec === r, 'aria-label': t('Play: {title}', {title: r.title}), 'data-fk': `play-${r.id}`, onclick: (e) => play(app, r, 0, e.currentTarget)}, face);
}

function card(app, s, r) {
  if (!isVideo(r)) {
    return h('article.tut.tut--guide', {dataset: {tut: r.id}}, h('div.tut-body', [
      h('h4.tut-title', {lang: r.lang}, r.title),
      h('p.tut-meta', r.source),
      tags(r),
      caution(r, s),
      h('p.tut-why', convertTorqueText(r.why, s.units)),
      h('a.ws-btn', away(r.url), [icon('out'), r.kind === 'forum' ? t('Read the forum thread') : t('Read the guide')]),
    ]));
  }
  return h('article.tut', {dataset: {tut: r.id}}, [
    thumb(app, r),
    h('div.tut-body', [
      h('h4.tut-title', {lang: r.lang}, r.title),
      h('p.tut-meta', t('{source}, {length}', {source: r.source, length: length(r.seconds)})),
      tags(r),
      caution(r, s),
      h('p.tut-why', convertTorqueText(r.why, s.units)),
    ]),
  ]);
}

/** Cards built when they are first opened, so nothing below is fetched until someone asks for it. */
function fold(app, s, list, summary) {
  const box = h('div.tut-cards');
  return h('details.ws-more.tut-fold', {ontoggle: (e) => { if (e.target.open && !box.childElementCount) box.append(...list.map((r) => card(app, s, r))); }}, [h('summary', summary), box]);
}

const moreWord = (n) => plural(n, '{n} more to watch or read|one', '{n} more to watch or read');

function cards(app, s, list, shown) {
  const rest = list.slice(shown);
  return [...list.slice(0, shown).map((r) => card(app, s, r)), rest.length > 0 && fold(app, s, rest, moreWord(rest.length))];
}

// ---- what the panels place ------------------------------------------------------------------------------------------------------

/** The job overview's section, or null: a job with no tutorial shows nothing. */
export function watchSection(app, s, job) {
  const list = tutorialsFor('jobs', job.id, s.variant);
  return list.length ? h('section.tut-sec', [h('h3.tut-head', t('Watch it being done')), cards(app, s, list, JOB_SHOWN)]) : null;
}

/** "Watch this step", for a step with a real timestamp on this car, or null. */
export function stepWatch(app, s, job, st) {
  const hit = stepTutorial(job, st, s.variant);
  if (!hit) return null;
  const {rec: r, atSec} = hit;
  // The caution belongs to the film, so it shows in full at the first step the film is on, and one tap away after that.
  const first = (r.steps ?? []).filter((x) => x.job === job.id).map((x) => job.steps[x.step]).find((x) => x && jobSteps(job, s.variant).includes(x)) === st;
  const warned = caution(r, s);
  const face = [icon('play'), h('span.tut-go-text', [h('strong', t('Watch this step')), h('span', embeds(r) ? t('{source}, from {time}', {source: r.source, time: clock(atSec)}) : t('Opens on YouTube'))])];
  return h('div.tut-step', [
    embeds(r) ? h('button.tut-go', {type: 'button', 'data-fk': 'watch-step', onclick: (e) => play(app, r, atSec, e.currentTarget)}, face) : h('a.tut-go', away(watchUrl(r, atSec)), face),
    // In a step only what differs from what you would assume is said: a film for another car, or in another language.
    (r.fit !== 'exact' || r.lang !== getLang()) && h('div.tut-tags', [
      r.fit !== 'exact' && h('span.ws-tag.tut-fit', fitWord(r)),
      r.lang !== getLang() && h('span.ws-tag.tut-fit.ws-tag--ink', t(LANGUAGE[r.lang])),
    ]),
    warned && (first ? warned : h('details.ws-more', [h('summary', t('Be careful with this film')), warned])),
  ]);
}

/** Cards for a fault, weak spot or part, or null when there are none. */
export function tutorialList(app, s, kind, id) {
  const list = tutorialsFor(kind, id, s.variant);
  return list.length ? h('div.tut-sec', cards(app, s, list, PANEL_SHOWN)) : null;
}

/** The same behind one tap, for a place where cards would crowd out what the panel is for. */
export function foldedTutorials(app, s, kind, id, summary) {
  const list = tutorialsFor(kind, id, s.variant);
  return list.length ? fold(app, s, list, summary ?? plural(list.length, '{n} video or guide on this', '{n} videos and guides on this')) : null;
}

let topic = null;

/** Opens one topic, for a search result that sends someone here. */
export function showBasics(id) { topic = id; openSection('basics'); }

/** The top of Jobs: topics as plain tiles, so the list fetches nothing until a topic is opened. */
export function basicsBlock(app, s, repaint) {
  const topics = BASICS.map((x) => ({...x, list: tutorialsFor('basics', x.id, s.variant)})).filter((x) => x.list.length);
  if (!topics.length) return null;
  const open = topics.find((x) => x.id === topic);
  return section('basics', t('Learn the basics'), null,
    h('div.ws-tiles.tut-topics', topics.map((x) => h('button.ws-tile', {type: 'button', 'aria-pressed': String(x === open), 'data-fk': `basics-${x.id}`, onclick: () => { topic = x === open ? null : x.id; repaint(); }}, [h('strong', t(x.word)), h('span', plural(x.list.length, '{n} to watch or read|one', '{n} to watch or read'))]))),
    open && h('div.tut-sec', [
      h('p.tut-lead', gloss(t(open.lead))),
      open.id === 'jacking' && h('button.ws-row', {type: 'button', onclick: () => openJob(app, 'jacking-stands')}, [h('span.ws-row-main', [h('strong', t('Where to jack and where the stands go')), h('span', t('Read this before lifting the car'))]), icon('right')]),
      cards(app, s, open.list, JOB_SHOWN),
    ]));
}
