// Entry point: boot the game, then wire the menu card to it.

import { Game } from './Game.js';

const $ = (id) => document.getElementById(id);
const overlay = $('overlay');
const title = $('ov-title');
const lede = $('ov-lede');
const note = $('ov-note');
const primary = $('btn-primary');
const restart = $('btn-restart');
const stats = $('ov-stats');
const controls = $('ov-controls');
const settings = $('ov-settings');

const COPY = {
  title: {
    title: 'LUCIA', small: false, button: 'Start',
    lede: 'One lane in the old city, one service pistol, five infected. Get through the gate at the far end. You carry 24 rounds; there are a few more if you look.',
  },
  paused: { title: 'PAUSED', small: true, button: 'Resume', lede: 'The lane waits.' },
  dead: { title: 'LUCIA IS DEAD', small: true, button: 'Try again', lede: 'They do not stop once they have hold of you. Keep your distance, and shoot before the swing lands: any hit breaks it.' },
  won: { title: 'END OF PROTOTYPE', small: true, button: 'Play again', lede: 'Lucia is through the gate. This is as far as the concept goes.' },
};

function fmtTime(t) {
  const m = Math.floor(t / 60), s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showState(game, state) {
  if (state === 'playing') {
    overlay.hidden = true;
    return;
  }
  const c = COPY[state];
  overlay.hidden = false;
  overlay.dataset.state = state;
  title.textContent = c.title;
  title.classList.toggle('small', c.small);
  lede.textContent = c.lede;
  primary.textContent = c.button;
  primary.disabled = false;
  restart.hidden = state !== 'paused';
  stats.hidden = state !== 'won' && state !== 'dead';
  controls.hidden = state === 'won' || state === 'dead';
  settings.hidden = state === 'won' || state === 'dead';
  note.hidden = state !== 'title';
  if (!stats.hidden) {
    const s = game.summary();
    $('s-time').textContent = fmtTime(s.time);
    $('s-kills').textContent = `${s.kills} / ${s.total}`;
    $('s-shots').textContent = s.shots;
    $('s-hits').textContent = s.hits;
    $('s-heads').textContent = s.headshots;
    $('s-acc').textContent = `${s.accuracy}%`;
    $('s-ammo').textContent = s.ammoLeft;
    $('s-dmg').textContent = s.damage;
  }
  // Death and the ending land after a beat, so the moment reads first.
  if (state === 'dead' || state === 'won') {
    primary.disabled = true;
    setTimeout(() => { primary.disabled = false; primary.focus(); }, 900);
  } else primary.focus();
}

async function boot() {
  // Thai shop signs are painted with canvas text, so give the web font a moment.
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load('700 40px "Chonburi"', 'กาแฟ'), document.fonts.load('400 16px "Silkscreen"', 'LUCIA')]),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
    }
  } catch (e) { /* fall back to system fonts */ }

  let game;
  try {
    game = new Game($('view'));
  } catch (err) {
    overlay.dataset.state = 'error';
    title.textContent = 'CANNOT START';
    title.classList.add('small');
    lede.textContent = `${err.message} This prototype needs a desktop browser with WebGL 2 and hardware acceleration turned on.`;
    console.error(err);
    return;
  }
  window.__game = game;

  const grain = $('grain');
  grain.style.backgroundImage = `url(${game.textures.grainCanvas.toDataURL()})`;

  game.onState = (s) => showState(game, s);
  showState(game, 'title');

  primary.addEventListener('click', () => game.start());
  restart.addEventListener('click', () => game.restart());

  const res = $('set-res'), sh = $('set-shadows'), gr = $('set-grain'), sens = $('set-sens');
  const apply = () => {
    game.settings.height = parseInt(res.value, 10);
    game.settings.shadows = sh.checked;
    game.settings.grain = gr.checked;
    $('scan').hidden = !gr.checked;
    game.camera.sensitivity = 0.0023 * parseFloat(sens.value);
    game.applySettings();
  };
  for (const el of [res, sh, gr, sens]) el.addEventListener('input', apply);
  apply();

  game.run();
}

boot();
