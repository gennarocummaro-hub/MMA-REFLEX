'use strict';
/* =========================================================================
   MMA REFLEX TRAINER — v1
   Fasi implementate: (1) scheduler + foreperiod + libreria comandi + audio
                      (2) UI sessione + timer round + preset
   ========================================================================= */

/* =========================================================================
   1. LIBRERIA COMANDI
   ========================================================================= */

const CATEGORIE = ['striking', 'difesa', 'lotta', 'terra', 'movimento', 'penalita'];

const ETICHETTA_CATEGORIA = {
  striking: 'STRIKING', difesa: 'DIFESA', lotta: 'LOTTA',
  terra: 'TERRA', movimento: 'MOVIMENTO', penalita: 'PENALITÀ'
};

/* piano di default per categoria (le difese sono azioni di piano striking) */
const PIANO_CATEGORIA = {
  striking: 'striking', difesa: 'striking', lotta: 'lotta',
  terra: 'terra', movimento: 'movimento', penalita: 'neutro'
};

/* matrice di transizione piano -> piani ammessi come elemento successivo
   (usata dalla costruzione catene, fase 4) */
const TRANSIZIONI = {
  striking:  ['striking', 'lotta', 'movimento'],
  lotta:     ['lotta', 'terra', 'striking'],
  terra:     ['terra', 'lotta'],
  movimento: ['striking', 'lotta'],
  neutro:    []
};

function cmd(label, categoria, execMs, lateralizzato) {
  return {
    id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    label: label,
    categoria: categoria,
    execMs: execMs,
    lateralizzato: !!lateralizzato,
    piano: PIANO_CATEGORIA[categoria],
    custom: false
  };
}

const COMANDI_BASE = [
  /* STRIKING */
  cmd('jab', 'striking', 400, false),
  cmd('cross', 'striking', 500, false),
  cmd('hook avanti', 'striking', 500, true),
  cmd('hook dietro', 'striking', 500, true),
  cmd('uppercut avanti', 'striking', 500, true),
  cmd('uppercut dietro', 'striking', 500, true),
  cmd('overhand', 'striking', 600, false),
  cmd('low kick avanti', 'striking', 700, true),
  cmd('low kick dietro', 'striking', 750, true),
  cmd('body kick', 'striking', 800, true),
  cmd('head kick', 'striking', 900, true),
  cmd('teep', 'striking', 600, true),
  cmd('ginocchio', 'striking', 600, true),
  cmd('gomito', 'striking', 500, true),
  /* DIFESA */
  cmd('slip avanti', 'difesa', 400, true),
  cmd('slip dietro', 'difesa', 400, true),
  cmd('roll', 'difesa', 500, false),
  cmd('parata', 'difesa', 350, false),
  cmd('copertura', 'difesa', 400, false),
  cmd('back step', 'difesa', 500, false),
  cmd('pivot', 'difesa', 600, true),
  /* LOTTA */
  cmd('sprawl', 'lotta', 1500, false),
  cmd('single leg', 'lotta', 1800, true),
  cmd('double leg', 'lotta', 1800, false),
  cmd('cambio livello', 'lotta', 600, false),
  cmd('underhook', 'lotta', 800, true),
  cmd('whizzer', 'lotta', 800, true),
  cmd('clinch', 'lotta', 900, false),
  cmd('technical stand-up', 'lotta', 2500, false),
  /* TERRA */
  cmd('shrimp', 'terra', 1200, true),
  cmd('bridge', 'terra', 1000, false),
  cmd('granby', 'terra', 2000, false),
  cmd('sit-out', 'terra', 1500, false),
  cmd('ricomponi guardia', 'terra', 1500, false),
  /* MOVIMENTO */
  cmd('switch stance', 'movimento', 600, false),
  cmd("taglia l'angolo", 'movimento', 800, true),
  cmd('circola', 'movimento', 800, true),
  cmd('esci', 'movimento', 600, false),
  /* PENALITÀ */
  cmd('burpee', 'penalita', 3000, false),
  cmd('sprawl-up', 'penalita', 2000, false)
];

/* -------- lateralizzazione: avanti/dietro -> lato fisico -------- */

/* quale guardia governa il piano del comando */
function guardiaDelPiano(piano, cfg) {
  return (piano === 'lotta' || piano === 'terra') ? cfg.guardiaLotta : cfg.guardiaStriking;
}

/* 'avanti'|'dietro' -> 'sinistra'|'destra' secondo la guardia del piano */
function latoFisico(comando, lato, cfg) {
  if (!lato) return null;
  const guardia = guardiaDelPiano(comando.piano, cfg);
  const lead = (guardia === 'ortodossa') ? 'sinistra' : 'destra';
  const rear = (lead === 'sinistra') ? 'destra' : 'sinistra';
  return (lato === 'avanti') ? lead : rear;
}

/* il lato è già nella label ("hook avanti") oppure va estratto a sorte */
function latoDellaLabel(label) {
  if (/\bavanti$/.test(label)) return 'avanti';
  if (/\bdietro$/.test(label)) return 'dietro';
  return null;
}

/* =========================================================================
   2. CONFIGURAZIONE
   ========================================================================= */

const CHIAVE_CFG = 'mmarx.cfg.v1';
const CHIAVE_PRESET = 'mmarx.preset.v1';

function cfgDefault() {
  const comandi = {};
  COMANDI_BASE.forEach(c => { comandi[c.id] = { attivo: true, execMs: c.execMs }; });
  const categorie = {};
  const pesi = {};
  CATEGORIE.forEach(k => { categorie[k] = true; pesi[k] = 1; });
  return {
    guardiaStriking: 'ortodossa',
    guardiaLotta: 'ortodossa',
    fpMin: 800,
    fpMax: 4000,
    lambda: 1.2,
    pCatena: 0.35,
    catenaMin: 2,
    catenaMax: 4,
    pNoGo: 0.15,
    noGoModo: 'A',
    parolaNoGo: 'fake',
    pStop: 0.10,
    stopSegnale: 'beep',
    stopConCambio: true,
    ssdMin: 150,
    ssdMax: 350,
    rate: 1.15,
    volume: 1.0,
    voiceURI: null,
    round: 5,
    durataLavoroS: 240,
    durataRecuperoS: 60,
    categorie: categorie,
    pesiCategoria: pesi,
    comandi: comandi,
    custom: []
  };
}

function clonaProfondo(o) { return JSON.parse(JSON.stringify(o)); }

function caricaCfg() {
  const base = cfgDefault();
  try {
    const raw = localStorage.getItem(CHIAVE_CFG);
    if (!raw) return base;
    const salvata = JSON.parse(raw);
    const out = Object.assign(base, salvata);
    out.categorie = Object.assign(cfgDefault().categorie, salvata.categorie || {});
    out.pesiCategoria = Object.assign(cfgDefault().pesiCategoria, salvata.pesiCategoria || {});
    out.comandi = Object.assign(cfgDefault().comandi, salvata.comandi || {});
    out.custom = salvata.custom || [];
    return out;
  } catch (e) {
    console.warn('cfg illeggibile, uso i default', e);
    return base;
  }
}

function salvaCfg() {
  try { localStorage.setItem(CHIAVE_CFG, JSON.stringify(cfg)); }
  catch (e) { console.warn('salvataggio cfg fallito', e); }
}

let cfg = caricaCfg();

/* libreria effettiva = base + custom, con execMs sovrascritti dalla cfg */
function libreria() {
  const custom = (cfg.custom || []).map(c => ({
    id: c.id, label: c.label, categoria: c.categoria, execMs: c.execMs,
    lateralizzato: !!c.lateralizzato, piano: PIANO_CATEGORIA[c.categoria] || 'neutro', custom: true
  }));
  return COMANDI_BASE.concat(custom).map(c => {
    const s = cfg.comandi[c.id];
    return s ? Object.assign({}, c, { execMs: s.execMs }) : c;
  });
}

/* pool = comandi attivi in categorie attive */
function pool() {
  return libreria().filter(c => cfg.categorie[c.categoria] && cfg.comandi[c.id] && cfg.comandi[c.id].attivo);
}

/* =========================================================================
   3. FOREPERIOD — esponenziale troncata su [fpMin, fpMax]
   ========================================================================= */

function foreperiod(fpMin, fpMax, lambda) {
  if (fpMin === undefined) fpMin = cfg.fpMin;
  if (fpMax === undefined) fpMax = cfg.fpMax;
  if (lambda === undefined) lambda = cfg.lambda;
  const u = Math.random();
  const range = fpMax - fpMin;
  const x = -Math.log(1 - u * (1 - Math.exp(-lambda))) / lambda;
  return fpMin + x * range;
}

/* =========================================================================
   4. SELEZIONE COMANDO
   ========================================================================= */

function pescaPesato(chiavi, pesi) {
  let tot = 0;
  for (const k of chiavi) tot += Math.max(0, pesi[k] || 0);
  if (tot <= 0) return chiavi[Math.floor(Math.random() * chiavi.length)];
  let r = Math.random() * tot;
  for (const k of chiavi) {
    r -= Math.max(0, pesi[k] || 0);
    if (r <= 0) return k;
  }
  return chiavi[chiavi.length - 1];
}

/* storia: array di comandi già emessi (dal più vecchio al più recente) */
function selezionaComando(disponibili, storia) {
  if (!disponibili.length) return null;
  const ultimo = storia.length ? storia[storia.length - 1] : null;
  const penultimo = storia.length > 1 ? storia[storia.length - 2] : null;

  let categorie = [];
  disponibili.forEach(c => { if (categorie.indexOf(c.categoria) < 0) categorie.push(c.categoria); });

  /* vincolo: mai 3 comandi consecutivi della stessa categoria */
  if (ultimo && penultimo && ultimo.categoria === penultimo.categoria && categorie.length > 1) {
    categorie = categorie.filter(k => k !== ultimo.categoria);
  }

  const cat = pescaPesato(categorie, cfg.pesiCategoria);
  let candidati = disponibili.filter(c => c.categoria === cat);

  /* vincolo: mai lo stesso comando due volte di fila */
  if (ultimo && candidati.length > 1) {
    const filtrati = candidati.filter(c => c.id !== ultimo.id);
    if (filtrati.length) candidati = filtrati;
  }
  return candidati[Math.floor(Math.random() * candidati.length)];
}

/* costruisce lo stimolo completo (comando + lato estratto se serve) */
function costruisciStimolo(comando) {
  let lato = latoDellaLabel(comando.label);
  if (!lato && comando.lateralizzato) lato = (Math.random() < 0.5) ? 'avanti' : 'dietro';
  const parlato = (lato && !latoDellaLabel(comando.label)) ? (comando.label + ' ' + lato) : comando.label;
  return {
    comando: comando,
    lato: lato,
    latoFisico: lato ? latoFisico(comando, lato, cfg) : null,
    parlato: parlato,
    execMs: comando.execMs
  };
}

/* =========================================================================
   5. AUDIO — beep via AudioContext, voce via speechSynthesis
   ========================================================================= */

const Suono = {
  ctx: null,
  pronto: false,

  /* da chiamare SOLO dentro un gesto utente (tap su START) */
  sblocca() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { console.warn('AudioContext non disponibile'); return; }
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    /* tick muto: sblocca il grafo audio su iOS */
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + 0.02);
    this.pronto = true;
  },

  /* converte un istante di AudioContext in performance.now() */
  aPerf(tCtx) {
    if (!this.ctx) return performance.now();
    if (this.ctx.getOutputTimestamp) {
      const ts = this.ctx.getOutputTimestamp();
      if (ts && ts.contextTime != null && ts.performanceTime != null) {
        return ts.performanceTime + (tCtx - ts.contextTime) * 1000;
      }
    }
    return performance.now() + (tCtx - this.ctx.currentTime) * 1000;
  },

  /* un beep. ritorna l'onset in tempo performance.now() */
  beep(freq, ms, opzioni) {
    opzioni = opzioni || {};
    if (!this.ctx) return performance.now();
    const t0 = this.ctx.currentTime + (opzioni.ritardoS || 0) + 0.005;
    const dur = ms / 1000;
    const picco = (opzioni.gain == null) ? 0.35 : opzioni.gain;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = opzioni.tipo || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(picco, t0 + 0.004);
    g.gain.setValueAtTime(picco, t0 + Math.max(0.005, dur - 0.015));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return this.aPerf(t0);
  },

  /* sequenza di beep: [[freq, ms], [freq, ms], ...] con gap in ms */
  sequenza(lista, gapMs) {
    if (!this.ctx) return performance.now();
    let off = 0;
    let primo = null;
    lista.forEach(b => {
      const t = this.beep(b[0], b[1], { ritardoS: off / 1000, gain: b[2] });
      if (primo === null) primo = t;
      off += b[1] + (gapMs || 0);
    });
    return primo;
  },

  /* segnali di struttura */
  inizioRound() { return this.beep(440, 500); },
  ultimi10s()   { return this.sequenza([[660, 90], [660, 90], [660, 90]], 110); },
  fineRound()   { return this.sequenza([[220, 160], [220, 160]], 120); }
};

/* astrazione voce: sostituibile con clip pre-registrate senza toccare il resto */
const Voce = {
  voce: null,
  elenco: [],

  init() {
    this.carica();
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.addEventListener('voiceschanged', () => this.carica());
    }
  },

  /* il riferimento alla voce viene risolto QUI, una volta sola, mai per comando */
  carica() {
    if (typeof speechSynthesis === 'undefined') return;
    this.elenco = speechSynthesis.getVoices() || [];
    if (!this.elenco.length) return;
    let v = null;
    if (cfg.voiceURI) v = this.elenco.find(x => x.voiceURI === cfg.voiceURI) || null;
    if (!v) v = this.elenco.find(x => /^it(-|_|$)/i.test(x.lang)) || null;
    if (!v) v = this.elenco.find(x => x.default) || this.elenco[0];
    this.voce = v;
    if (typeof aggiornaElencoVoci === 'function') aggiornaElencoVoci();
  },

  /* pre-riscaldamento motore vocale (iOS) — dentro un gesto utente */
  sblocca() {
    if (typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance('');
      if (this.voce) u.voice = this.voce;
      u.volume = 0; u.rate = cfg.rate;
      speechSynthesis.speak(u);
    } catch (e) { console.warn('warm-up voce fallito', e); }
  },

  cancella() {
    if (typeof speechSynthesis === 'undefined') return;
    try { speechSynthesis.cancel(); } catch (e) {}
  },

  /* tronca il comando precedente solo se e' ancora in pronuncia: su iOS un
     cancel() a vuoto subito prima di speak() puo' inghiottire l'utterance */
  troncaSeInCorso() {
    if (typeof speechSynthesis === 'undefined') return;
    if (speechSynthesis.speaking || speechSynthesis.pending) this.cancella();
  },

  /* speak(label) — punto unico di erogazione dei comandi */
  speak(label, opzioni) {
    opzioni = opzioni || {};
    if (typeof speechSynthesis === 'undefined') return null;
    const u = new SpeechSynthesisUtterance(label);
    if (this.voce) { u.voice = this.voce; u.lang = this.voce.lang; }
    else { u.lang = 'it-IT'; }
    u.rate = (opzioni.rate == null) ? cfg.rate : opzioni.rate;
    u.volume = (opzioni.volume == null) ? cfg.volume : opzioni.volume;
    u.pitch = 1;
    if (opzioni.onstart) u.onstart = opzioni.onstart;
    if (opzioni.onend) u.onend = opzioni.onend;
    speechSynthesis.speak(u);
    return u;
  },

  /* sequenza di label con pausa fissa fra le parole (catene, fase 4) */
  speakSequenza(labels, gapMs, opzioni) {
    opzioni = opzioni || {};
    const gap = (gapMs == null) ? 180 : gapMs;
    let i = 0;
    const timers = [];
    const passo = () => {
      if (i >= labels.length) return;
      const primo = (i === 0);
      this.speak(labels[i], {
        onstart: primo ? opzioni.onstart : null,
        onend: (i === labels.length - 1) ? opzioni.onend : null
      });
      i++;
      if (i < labels.length) timers.push(setTimeout(passo, gap));
    };
    passo();
    return { annulla() { timers.forEach(clearTimeout); } };
  }
};

/* =========================================================================
   6. SCHEDULER — setTimeout ricorsivo con correzione della deriva
   ========================================================================= */

/* arma un callback su un istante assoluto di performance.now() */
function armaA(targetPerf, callback) {
  let id = null;
  const passo = () => {
    const restante = targetPerf - performance.now();
    /* avvicinamento in due stadi: il timeout lungo assorbe l'attesa, l'ultimo
       tratto viene rifinito a passi corti per non anticipare l'onset */
    if (restante > 12) { id = setTimeout(passo, restante - 8); }
    else if (restante > 0.5) { id = setTimeout(passo, 0); }
    else { callback(); }
  };
  id = setTimeout(passo, Math.max(0, targetPerf - performance.now() - 8));
  return { annulla() { clearTimeout(id); } };
}

const Sessione = {
  attiva: false,
  inPausa: false,
  fase: 'idle',            /* idle | lavoro | recupero | fine */
  modo: 'libera',
  roundCorrente: 0,
  roundTotali: 0,
  fineFaseAt: 0,           /* istante performance.now() di fine fase */
  restanteInPausa: 0,
  timerStimolo: null,
  timerFase: null,
  timerUI: null,
  timerAvviso10s: null,
  storia: [],
  contatori: null,
  record: null,
  caloConsecutivi: 0,
  wakeLock: null,

  /* ---------- avvio ---------- */
  async avvia(modo) {
    this.modo = modo;
    this.attiva = true;
    this.inPausa = false;
    this.roundTotali = cfg.round;
    this.roundCorrente = 0;
    this.caloConsecutivi = 0;
    this.record = {
      id: uuid(), data: new Date().toISOString(), modalita: modo,
      configurazione: clonaProfondo(cfg), round: [], distribuzioneComandi: {}
    };
    await this.acquisisciWakeLock();
    mostraSchermo('sessione');
    this.prossimoRound();
  },

  prossimoRound() {
    this.roundCorrente++;
    if (this.roundCorrente > this.roundTotali) { this.termina(true); return; }
    this.fase = 'lavoro';
    this.storia = [];
    this.contatori = { comandi: 0, stimoli: 0, noGo: 0, stop: 0 };
    Suono.inizioRound();
    const durata = cfg.durataLavoroS * 1000;
    this.fineFaseAt = performance.now() + durata;
    this.armaFineFase(() => this.fineLavoro());
    this.armaAvviso10s();
    /* primo stimolo dopo un foreperiod completo */
    this.programmaStimolo(performance.now() + foreperiod());
    aggiornaUISessione();
  },

  armaFineFase(cb) {
    if (this.timerFase) this.timerFase.annulla();
    this.timerFase = armaA(this.fineFaseAt, cb);
  },

  armaAvviso10s() {
    if (this.timerAvviso10s) this.timerAvviso10s.annulla();
    const t = this.fineFaseAt - 10000;
    if (t > performance.now()) this.timerAvviso10s = armaA(t, () => Suono.ultimi10s());
  },

  programmaStimolo(targetPerf) {
    if (this.timerStimolo) this.timerStimolo.annulla();
    /* non emettere stimoli oltre la fine del round */
    if (targetPerf >= this.fineFaseAt) return;
    this.timerStimolo = armaA(targetPerf, () => this.emettiStimolo());
  },

  emettiStimolo() {
    if (!this.attiva || this.inPausa || this.fase !== 'lavoro') return;
    const disponibili = pool();
    if (!disponibili.length) { mostraToast('Nessun comando attivo'); this.termina(false); return; }

    const comando = selezionaComando(disponibili, this.storia);
    const stimolo = costruisciStimolo(comando);
    this.storia.push(comando);

    /* se il precedente è ancora in pronuncia, troncalo */
    Voce.troncaSeInCorso();
    const onset = performance.now();
    Voce.speak(stimolo.parlato);

    this.contatori.comandi += 1;
    this.contatori.stimoli += 1;
    const d = this.record.distribuzioneComandi;
    d[comando.id] = (d[comando.id] || 0) + 1;

    mostraUltimoComando(stimolo);
    aggiornaUISessione();

    /* tProssimo = tFineEsecuzione + foreperiod */
    const fineEsecuzione = onset + stimolo.execMs;
    this.programmaStimolo(fineEsecuzione + foreperiod());
  },

  fineLavoro() {
    if (this.timerStimolo) this.timerStimolo.annulla();
    Voce.cancella();
    Suono.fineRound();
    const durataS = cfg.durataLavoroS;
    const densita = this.contatori.comandi / (durataS / 60);
    this.record.round.push({
      n: this.roundCorrente, durataS: durataS,
      comandiEmessi: this.contatori.comandi, densita: Math.round(densita * 100) / 100,
      noGoEmessi: this.contatori.noGo, stopEmessi: this.contatori.stop,
      erroriRiportati: 0, rpe: null
    });
    this.fase = 'recupero';
    this.fineFaseAt = performance.now() + cfg.durataRecuperoS * 1000;
    this.armaFineFase(() => this.fineRecupero());
    aggiornaUISessione();
    apriFineRound(this.roundCorrente, densita);
  },

  fineRecupero() {
    chiudiFineRound(true);
    if (this.roundCorrente >= this.roundTotali) { this.termina(true); return; }
    this.prossimoRound();
  },

  pausa() {
    if (!this.attiva || this.inPausa) return;
    this.inPausa = true;
    this.restanteInPausa = Math.max(0, this.fineFaseAt - performance.now());
    if (this.timerStimolo) this.timerStimolo.annulla();
    if (this.timerFase) this.timerFase.annulla();
    if (this.timerAvviso10s) this.timerAvviso10s.annulla();
    Voce.cancella();
    aggiornaUISessione();
  },

  riprendi() {
    if (!this.attiva || !this.inPausa) return;
    this.inPausa = false;
    this.fineFaseAt = performance.now() + this.restanteInPausa;
    this.armaFineFase(() => (this.fase === 'lavoro' ? this.fineLavoro() : this.fineRecupero()));
    if (this.fase === 'lavoro') {
      this.armaAvviso10s();
      this.programmaStimolo(performance.now() + foreperiod());
    }
    aggiornaUISessione();
  },

  termina(completata) {
    this.attiva = false;
    this.fase = 'fine';
    if (this.timerStimolo) this.timerStimolo.annulla();
    if (this.timerFase) this.timerFase.annulla();
    if (this.timerAvviso10s) this.timerAvviso10s.annulla();
    if (this.timerUI) { clearTimeout(this.timerUI); this.timerUI = null; }
    Voce.cancella();
    chiudiFineRound(true);
    this.rilasciaWakeLock();
    /* il salvataggio del record è la fase 6 */
    console.log('[sessione]', this.record);
    mostraSchermo('home');
    mostraToast(completata ? 'Sessione completata' : 'Sessione interrotta');
  },

  /* ---------- wake lock (fallback documentato) ---------- */
  async acquisisciWakeLock() {
    if (!('wakeLock' in navigator)) {
      /* Fallback: Safari iOS < 16.4 non espone la Wake Lock API. Nessun
         sostituto affidabile senza video in loop (vietato dalla spec: nessun
         suono/asset extra). L'utente deve alzare il timeout di blocco schermo. */
      mostraToast('Wake Lock non disponibile: disattiva il blocco schermo');
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch (e) {
      mostraToast('Wake Lock negato: disattiva il blocco schermo');
    }
  },

  rilasciaWakeLock() {
    if (this.wakeLock) { try { this.wakeLock.release(); } catch (e) {} this.wakeLock = null; }
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Sessione.attiva && !Sessione.inPausa && !Sessione.wakeLock) {
    Sessione.acquisisciWakeLock();
  }
});

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* =========================================================================
   7. PRESET DI MODALITÀ
   ========================================================================= */

const PRESET_ESPLOSIVITA_POOL = ['sprawl', 'double-leg', 'jab', 'cross', 'cambio-livello', 'low-kick-dietro'];

function applicaPreset(modo) {
  if (modo === 'esplosivita') {
    cfg.round = 6; cfg.durataLavoroS = 8; cfg.durataRecuperoS = 50;
    cfg.pCatena = 0.20; cfg.catenaMin = 1; cfg.catenaMax = 2;
    cfg.fpMin = 800; cfg.fpMax = 2500;
    cfg.pNoGo = 0.10; cfg.pStop = 0.05;
    /* pool ristretto ai 6 comandi del preset */
    Object.keys(cfg.comandi).forEach(id => { cfg.comandi[id].attivo = PRESET_ESPLOSIVITA_POOL.indexOf(id) >= 0; });
    CATEGORIE.forEach(k => { cfg.categorie[k] = false; });
    PRESET_ESPLOSIVITA_POOL.forEach(id => {
      const c = libreria().find(x => x.id === id);
      if (c) cfg.categorie[c.categoria] = true;
    });
  } else if (modo === 'cardio-tecnica') {
    cfg.round = 5; cfg.durataLavoroS = 240; cfg.durataRecuperoS = 60;
    cfg.pCatena = 0.50; cfg.catenaMin = 3; cfg.catenaMax = 5;
    cfg.fpMin = 600; cfg.fpMax = 2500;
    cfg.pNoGo = 0.15; cfg.pStop = 0.10;
    CATEGORIE.forEach(k => { cfg.categorie[k] = true; });
    Object.keys(cfg.comandi).forEach(id => { cfg.comandi[id].attivo = true; });
  }
  salvaCfg();
}

function presetSalvati() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_PRESET) || '[]'); }
  catch (e) { return []; }
}

function salvaPreset(nome) {
  const lista = presetSalvati().filter(p => p.nome !== nome);
  lista.push({ nome: nome, cfg: clonaProfondo(cfg) });
  localStorage.setItem(CHIAVE_PRESET, JSON.stringify(lista));
}

function eliminaPreset(nome) {
  localStorage.setItem(CHIAVE_PRESET, JSON.stringify(presetSalvati().filter(p => p.nome !== nome)));
}

/* =========================================================================
   8. UI
   ========================================================================= */

const $ = s => document.querySelector(s);
const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));

function mostraSchermo(nome) {
  $$('.screen').forEach(s => s.classList.remove('attiva'));
  const el = document.getElementById('scr-' + nome);
  if (el) el.classList.add('attiva');
  document.body.classList.toggle('in-sessione', nome === 'sessione');
  if (nome === 'impostazioni') disegnaImpostazioni();
}

let toastTimer = null;
function mostraToast(testo) {
  const t = $('#toast');
  t.textContent = testo;
  t.classList.add('visibile');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visibile'), 2600);
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function mostraUltimoComando(stimolo) {
  const lato = stimolo.latoFisico ? ' · ' + (stimolo.latoFisico === 'sinistra' ? 'SX' : 'DX') : '';
  $('#ultimo-comando').textContent = stimolo.parlato.toUpperCase() + lato;
}

function aggiornaUISessione() {
  const s = Sessione;
  $('#round-label').textContent = 'ROUND ' + s.roundCorrente + ' / ' + s.roundTotali;
  const lavoro = (s.fase === 'lavoro');
  document.body.classList.toggle('fase-recupero', !lavoro);
  $('#fase-label').textContent = s.inPausa ? 'PAUSA' : (lavoro ? 'LAVORO' : 'RECUPERO');
  $('#btn-pausa').textContent = s.inPausa ? 'RIPRENDI' : 'PAUSA';
  if (s.contatori) {
    /* tempo di lavoro trascorso al netto delle pause: fineFaseAt viene
       traslato alla ripresa, quindi la differenza esclude la pausa */
    const restante = s.inPausa ? s.restanteInPausa : (s.fineFaseAt - performance.now());
    const lavoratoMs = lavoro ? (cfg.durataLavoroS * 1000 - restante) : cfg.durataLavoroS * 1000;
    const trascorsiMin = Math.max(0.0001, lavoratoMs / 60000);
    $('#densita-live').textContent = (s.contatori.comandi / trascorsiMin).toFixed(1);
    $('#conta-comandi').textContent = s.contatori.comandi;
  }
}

function tickUI() {
  if (Sessione.attiva) {
    const restante = Sessione.inPausa ? Sessione.restanteInPausa : (Sessione.fineFaseAt - performance.now());
    $('#timer').textContent = mmss(restante);
    if (Sessione.fase === 'recupero') $('#fr-recupero').textContent = 'RECUPERO ' + mmss(restante);
    if (!Sessione.inPausa && Sessione.fase === 'lavoro') aggiornaUISessione();
  }
  Sessione.timerUI = setTimeout(tickUI, 100);
}

/* ---------- modale fine round ---------- */
let frStato = { errori: 0, rpe: null, calo: null, aperto: false };

function apriFineRound(n, densita) {
  frStato = { errori: 0, rpe: null, calo: null, aperto: true };
  $('#fr-titolo').textContent = 'FINE ROUND ' + n + ' — ' + densita.toFixed(1) + '/min';
  $('#fr-errori').textContent = '0';
  $$('#fr-rpe .btn').forEach(b => b.classList.remove('scelto'));
  $$('#fr-calo .btn').forEach(b => b.classList.remove('scelto'));
  $('#fr-calo').classList.toggle('nascosto', Sessione.modo !== 'esplosivita');
  $('#modal-fine-round').classList.add('visibile');
}

function chiudiFineRound(silenzioso) {
  if (!frStato.aperto) { $('#modal-fine-round').classList.remove('visibile'); return; }
  frStato.aperto = false;
  $('#modal-fine-round').classList.remove('visibile');
  const r = Sessione.record.round[Sessione.record.round.length - 1];
  if (r) { r.erroriRiportati = frStato.errori; r.rpe = frStato.rpe; }
  if (Sessione.modo === 'esplosivita' && frStato.calo !== null) {
    Sessione.caloConsecutivi = frStato.calo ? Sessione.caloConsecutivi + 1 : 0;
    if (Sessione.caloConsecutivi >= 2 && !silenzioso) {
      if (confirm('Velocità calata due blocchi di fila. Chiudere la sessione?')) Sessione.termina(false);
    }
  }
}

/* ---------- impostazioni ---------- */
function aggiornaElencoVoci() {
  const sel = $('#set-voce');
  if (!sel) return;
  sel.innerHTML = '';
  Voce.elenco.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = v.name + ' (' + v.lang + ')';
    sel.appendChild(o);
  });
  if (Voce.voce) sel.value = Voce.voce.voiceURI;
}

function disegnaImpostazioni() {
  $('#set-guardia-striking').value = cfg.guardiaStriking;
  $('#set-guardia-lotta').value = cfg.guardiaLotta;
  $('#set-fpmin').value = cfg.fpMin;
  $('#set-fpmax').value = cfg.fpMax;
  $('#set-lambda').value = cfg.lambda;
  $('#set-round').value = cfg.round;
  $('#set-lavoro').value = cfg.durataLavoroS;
  $('#set-recupero').value = cfg.durataRecuperoS;
  $('#set-rate').value = cfg.rate;
  aggiornaElencoVoci();
  notaGuardia();

  const lc = $('#lista-categorie');
  lc.innerHTML = '';
  CATEGORIE.forEach(k => {
    const riga = document.createElement('div');
    riga.className = 'campo-riga';
    riga.innerHTML = '<label><input type="checkbox" data-cat="' + k + '"' + (cfg.categorie[k] ? ' checked' : '') +
      '> ' + ETICHETTA_CATEGORIA[k] + '</label><input class="peso" type="number" min="0" max="10" step="0.5" data-peso="' + k + '" value="' + cfg.pesiCategoria[k] + '">';
    lc.appendChild(riga);
  });

  const lcm = $('#lista-comandi');
  lcm.innerHTML = '';
  CATEGORIE.forEach(k => {
    const gruppo = libreria().filter(c => c.categoria === k);
    if (!gruppo.length) return;
    const h = document.createElement('h4');
    h.textContent = ETICHETTA_CATEGORIA[k];
    lcm.appendChild(h);
    gruppo.forEach(c => {
      const riga = document.createElement('div');
      riga.className = 'campo-riga comando';
      riga.innerHTML = '<label><input type="checkbox" data-cmd="' + c.id + '"' + (cfg.comandi[c.id] && cfg.comandi[c.id].attivo ? ' checked' : '') +
        '> ' + c.label + (c.lateralizzato ? ' <i>lat</i>' : '') + '</label>' +
        '<input class="exec" type="number" min="100" max="10000" step="50" data-exec="' + c.id + '" value="' + (cfg.comandi[c.id] ? cfg.comandi[c.id].execMs : c.execMs) + '">' +
        (c.custom ? '<button class="btn mini" data-del="' + c.id + '">×</button>' : '');
      lcm.appendChild(riga);
    });
  });

  const cc = $('#cc-cat');
  cc.innerHTML = '';
  CATEGORIE.forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = ETICHETTA_CATEGORIA[k];
    cc.appendChild(o);
  });

  const lp = $('#lista-preset');
  lp.innerHTML = '';
  presetSalvati().forEach(p => {
    const riga = document.createElement('div');
    riga.className = 'campo-riga';
    riga.innerHTML = '<button class="btn secondario" data-preset-load="' + p.nome + '">' + p.nome + '</button>' +
      '<button class="btn mini" data-preset-del="' + p.nome + '">×</button>';
    lp.appendChild(riga);
  });
}

function notaGuardia() {
  const finto = { piano: 'striking' }, finto2 = { piano: 'lotta' };
  $('#nota-guardia').textContent =
    'avanti → striking: ' + latoFisico(finto, 'avanti', cfg) +
    ' · lotta/terra: ' + latoFisico(finto2, 'avanti', cfg);
}

/* =========================================================================
   9. EVENTI
   ========================================================================= */

function primoGestoUtente() {
  Suono.sblocca();
  Voce.carica();
  Voce.sblocca();
}

document.addEventListener('DOMContentLoaded', () => {
  Voce.init();
  tickUI();

  $$('[data-vai]').forEach(b => b.addEventListener('click', () => mostraSchermo(b.dataset.vai)));

  $$('.modo').forEach(b => b.addEventListener('click', () => {
    const modo = b.dataset.modo;
    if (modo === 'test-rt') { mostraToast('Test RT: fase 5 del piano'); return; }
    primoGestoUtente();               /* sblocco audio dentro il gesto */
    if (modo !== 'libera') applicaPreset(modo);
    if (!pool().length) { mostraToast('Nessun comando attivo'); return; }
    Sessione.avvia(modo);
  }));

  $('#btn-pausa').addEventListener('click', () => Sessione.inPausa ? Sessione.riprendi() : Sessione.pausa());
  $('#btn-stop').addEventListener('click', () => { if (confirm('Interrompere la sessione?')) Sessione.termina(false); });

  /* fine round */
  $$('#modal-fine-round [data-err]').forEach(b => b.addEventListener('click', () => {
    frStato.errori = Math.max(0, frStato.errori + parseInt(b.dataset.err, 10));
    $('#fr-errori').textContent = frStato.errori;
  }));
  const rpe = $('#fr-rpe');
  for (let i = 1; i <= 10; i++) {
    const b = document.createElement('button');
    b.className = 'btn step'; b.textContent = i; b.dataset.rpe = i;
    b.addEventListener('click', () => {
      frStato.rpe = i;
      $$('#fr-rpe .btn').forEach(x => x.classList.toggle('scelto', x === b));
    });
    rpe.appendChild(b);
  }
  $$('#fr-calo .btn').forEach(b => b.addEventListener('click', () => {
    frStato.calo = b.dataset.calo === '1';
    $$('#fr-calo .btn').forEach(x => x.classList.toggle('scelto', x === b));
  }));
  $('#fr-ok').addEventListener('click', () => chiudiFineRound(false));

  /* impostazioni */
  const bind = (sel, chiave, trasf) => $(sel).addEventListener('change', e => {
    cfg[chiave] = trasf(e.target.value); salvaCfg(); notaGuardia();
  });
  bind('#set-guardia-striking', 'guardiaStriking', v => v);
  bind('#set-guardia-lotta', 'guardiaLotta', v => v);
  bind('#set-fpmin', 'fpMin', v => Math.max(100, parseInt(v, 10) || 800));
  bind('#set-fpmax', 'fpMax', v => Math.max(200, parseInt(v, 10) || 4000));
  bind('#set-lambda', 'lambda', v => Math.max(0.1, parseFloat(v) || 1.2));
  bind('#set-round', 'round', v => Math.max(1, parseInt(v, 10) || 5));
  bind('#set-lavoro', 'durataLavoroS', v => Math.max(5, parseInt(v, 10) || 240));
  bind('#set-recupero', 'durataRecuperoS', v => Math.max(5, parseInt(v, 10) || 60));
  bind('#set-rate', 'rate', v => Math.min(2, Math.max(0.5, parseFloat(v) || 1.15)));
  $('#set-voce').addEventListener('change', e => {
    cfg.voiceURI = e.target.value; salvaCfg(); Voce.carica();
  });
  $('#btn-prova-voce').addEventListener('click', () => { primoGestoUtente(); Voce.speak('jab'); });

  $('#lista-categorie').addEventListener('change', e => {
    if (e.target.dataset.cat) { cfg.categorie[e.target.dataset.cat] = e.target.checked; salvaCfg(); }
    if (e.target.dataset.peso) { cfg.pesiCategoria[e.target.dataset.peso] = parseFloat(e.target.value) || 0; salvaCfg(); }
  });
  $('#lista-comandi').addEventListener('change', e => {
    if (e.target.dataset.cmd) { cfg.comandi[e.target.dataset.cmd].attivo = e.target.checked; salvaCfg(); }
    if (e.target.dataset.exec) {
      cfg.comandi[e.target.dataset.exec].execMs = Math.max(100, parseInt(e.target.value, 10) || 500);
      salvaCfg();
    }
  });
  $('#lista-comandi').addEventListener('click', e => {
    const id = e.target.dataset.del;
    if (!id) return;
    cfg.custom = cfg.custom.filter(c => c.id !== id);
    delete cfg.comandi[id];
    salvaCfg(); disegnaImpostazioni();
  });

  $('#cc-add').addEventListener('click', () => {
    const label = $('#cc-label').value.trim();
    if (!label) { mostraToast('Label mancante'); return; }
    const id = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (cfg.comandi[id]) { mostraToast('Comando già presente'); return; }
    const execMs = Math.max(100, parseInt($('#cc-exec').value, 10) || 600);
    const categoria = $('#cc-cat').value;
    cfg.custom.push({ id: id, label: label, categoria: categoria, execMs: execMs, lateralizzato: false });
    cfg.comandi[id] = { attivo: true, execMs: execMs };
    salvaCfg(); $('#cc-label').value = ''; disegnaImpostazioni();
  });

  $('#preset-salva').addEventListener('click', () => {
    const nome = $('#preset-nome').value.trim();
    if (!nome) { mostraToast('Nome preset mancante'); return; }
    salvaPreset(nome); $('#preset-nome').value = ''; disegnaImpostazioni();
    mostraToast('Preset salvato');
  });
  $('#lista-preset').addEventListener('click', e => {
    const load = e.target.dataset.presetLoad, del = e.target.dataset.presetDel;
    if (load) {
      const p = presetSalvati().find(x => x.nome === load);
      if (p) { cfg = Object.assign(cfgDefault(), p.cfg); salvaCfg(); disegnaImpostazioni(); mostraToast('Preset caricato'); }
    }
    if (del) { eliminaPreset(del); disegnaImpostazioni(); }
  });

  $('#btn-reset').addEventListener('click', () => {
    if (!confirm('Ripristinare tutti i default?')) return;
    cfg = cfgDefault(); salvaCfg(); disegnaImpostazioni(); mostraToast('Default ripristinati');
  });
});

/* =========================================================================
   10. DEBUG — verifiche dei criteri di accettazione da console
   ========================================================================= */

/* criterio 1: istogramma dei foreperiod + hazard rate.
   Nota misurata: la esponenziale TRONCATA prescritta dalla spec ha una hazard
   piu' piatta di una uniforme (CV ~0.35 contro ~0.48 su [fpMin, fpMin+0.8*range])
   ma in salita verso fpMax: e' una proprieta' intrinseca del troncamento.
   Il CV stampato qui sotto e' il confronto diretto con la baseline uniforme.
   Alzare cfg.lambda appiattisce ulteriormente la hazard, a costo di concentrare
   i foreperiod vicino a fpMin. */
function debugForeperiod(n, bin) {
  n = n || 200; bin = bin || 10;
  const v = [];
  for (let i = 0; i < n; i++) v.push(foreperiod());
  v.sort((a, b) => a - b);
  const min = cfg.fpMin, max = cfg.fpMax, largh = (max - min) / bin;
  const conta = new Array(bin).fill(0);
  v.forEach(x => { conta[Math.min(bin - 1, Math.floor((x - min) / largh))]++; });
  let sopravvissuti = n, sopravvissutiU = n;
  const righe = [], hz = [], hzU = [];
  for (let i = 0; i < bin; i++) {
    const hazard = sopravvissuti > 0 ? conta[i] / sopravvissuti : 0;
    const hazardU = sopravvissutiU > 0 ? (n / bin) / sopravvissutiU : 0;
    righe.push({
      bin: Math.round(min + i * largh) + '-' + Math.round(min + (i + 1) * largh) + 'ms',
      n: conta[i],
      hazard: Math.round(hazard * 1000) / 1000,
      'hazard uniforme': Math.round(hazardU * 1000) / 1000,
      isto: '#'.repeat(Math.round(conta[i] / n * 100))
    });
    if (i < bin - 1) { hz.push(hazard); hzU.push(hazardU); }
    sopravvissuti -= conta[i];
    sopravvissutiU -= n / bin;
  }
  console.table(righe);
  const cv = a => {
    const m = a.reduce((x, y) => x + y, 0) / a.length;
    return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / a.length) / m;
  };
  const media = v.reduce((a, b) => a + b, 0) / n;
  console.log('n=' + n, 'media=' + media.toFixed(0) + 'ms',
    'min=' + v[0].toFixed(0), 'max=' + v[n - 1].toFixed(0));
  console.log('CV hazard: generatore=' + cv(hz).toFixed(3) + '  uniforme=' + cv(hzU).toFixed(3) +
    '  (piu\' basso = piu\' piatta)');
  return { righe: righe, cvGeneratore: cv(hz), cvUniforme: cv(hzU) };
}

/* criteri 2 e 3: nessuna ripetizione immediata, mai 3 di fila della stessa categoria */
function debugSelezione(n) {
  n = n || 500;
  const disponibili = pool();
  const storia = [];
  let ripetizioni = 0, tripli = 0;
  for (let i = 0; i < n; i++) {
    const c = selezionaComando(disponibili, storia);
    if (storia.length && storia[storia.length - 1].id === c.id) ripetizioni++;
    if (storia.length > 1 && storia[storia.length - 1].categoria === c.categoria &&
        storia[storia.length - 2].categoria === c.categoria) tripli++;
    storia.push(c);
  }
  const dist = {};
  storia.forEach(c => { dist[c.categoria] = (dist[c.categoria] || 0) + 1; });
  console.log('n=' + n, 'ripetizioni consecutive=' + ripetizioni, 'triple di categoria=' + tripli);
  console.table(dist);
  return { ripetizioni, tripli, dist };
}

/* criterio 7: lateralizzazione indipendente per piano */
function debugLateralizzazione() {
  const salva = { s: cfg.guardiaStriking, l: cfg.guardiaLotta };
  cfg.guardiaStriking = 'ortodossa'; cfg.guardiaLotta = 'southpaw';
  const hook = libreria().find(c => c.id === 'hook-avanti');
  const single = libreria().find(c => c.id === 'single-leg');
  const a = latoFisico(hook, 'avanti', cfg);
  const b = latoFisico(single, 'avanti', cfg);
  console.log('hook avanti ->', a, '| single leg avanti ->', b, '| opposti:', a !== b);
  cfg.guardiaStriking = salva.s; cfg.guardiaLotta = salva.l;
  return a !== b;
}

window.MMARX = {
  cfg: () => cfg, libreria, pool, foreperiod, selezionaComando, costruisciStimolo,
  latoFisico, Sessione, Suono, Voce, TRANSIZIONI, armaA,
  debugForeperiod, debugSelezione, debugLateralizzazione
};
