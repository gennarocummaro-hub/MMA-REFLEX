# MMA Reflex Trainer

Allenamento dei riflessi e del tempo di reazione di scelta nelle MMA tramite
comandi vocali erogati a intervalli randomizzati. HTML + CSS + JS vanilla,
nessun framework, nessun build step, nessuna dipendenza esterna.

## Stato: fasi 1 e 2 del piano di costruzione

Implementato:

1. **Scheduler + foreperiod + libreria comandi + audio** — testabile da console.
2. **UI sessione + timer round + preset.**

Non ancora implementato (fasi 3-7 della spec): no-go, stop-signal, catene,
test RT, log/storico/export CSV, service worker e manifest PWA.
La Wake Lock API è già attiva perché senza di essa la sessione non è provabile
su iPhone.

## Come provarla

Serve un server statico (i moduli non servono, ma `localStorage`, IndexedDB e la
Wake Lock API richiedono un'origine http/https, non `file://`):

```
python3 -m http.server 8080
```

poi apri `http://<ip-del-computer>:8080` da Safari su iPhone, stessa rete Wi-Fi.
Il primo tap su una modalità sblocca l'audio: da lì in poi voce e beep funzionano.

Per registrare la voce coach serve **https** (il microfono è bloccato su http
fuori da localhost): GitHub Pages o un tunnel.

## Voce

Tre livelli, in ordine di naturalezza crescente:

1. **Voce di sistema base** — quella che trovi già installata. Robotica.
2. **Voce neurale di sistema** — marcata ★★ nell'elenco. Su iPhone va scaricata
   da Impostazioni → Accessibilità → Contenuto letto → Voci → Italiano, poi
   compare qui. Nettamente migliore, ma resta sintesi.
3. **Clip registrate** — IMPOSTAZIONI → VOCE COACH → REGISTRA. Registri i comandi
   con la tua voce o quella del tuo allenatore; dove c'è una clip, `speak()` usa
   quella e ignora la sintesi. Le clip stanno in IndexedDB, vengono decodificate
   all'avvio della sessione e riprodotte da un `AudioBuffer` già pronto: onset
   più basso e più costante della sintesi vocale.

Le voci Siri non sono esposte alle pagine web da nessun browser: non è una
limitazione di questa app.

## Modalità libera

LIBERA non parte più subito: apre una schermata di **setup** dove imposti round,
tempi, foreperiod, colpi attivi (con tutti/nessuno per categoria), pesi delle
categorie, guardie e voce, con la durata totale e il numero di comandi nel pool
ricalcolati mentre modifichi. In fondo, AVVIA SESSIONE.

È lo stesso pannello di IMPOSTAZIONI e la stessa configurazione: quello che
cambi in un posto vale nell'altro. Da lì puoi anche salvare tutto come preset.

## Verifiche da console

```js
MMARX.debugForeperiod(200)      // istogramma + hazard rate vs baseline uniforme
MMARX.debugSelezione(500)       // ripetizioni consecutive e triple di categoria
MMARX.debugLateralizzazione()   // avanti/dietro con guardie diverse per piano
MMARX.cfg()                     // configurazione corrente
MMARX.Voce.ordinate()           // voci disponibili, migliori per prime
MMARX.Clip.presenti             // comandi che hanno una clip registrata
```

## Note di implementazione

- **Foreperiod**: esponenziale troncata su `[fpMin, fpMax]`, formula della spec,
  `lambda` configurabile. Il troncamento fa salire la hazard rate verso `fpMax`:
  con i default resta comunque più piatta di una uniforme (CV 0.42 contro 0.57).
  Alzare `lambda` appiattisce ulteriormente la hazard ma concentra i foreperiod
  vicino a `fpMin`.
- **Scheduler**: `setTimeout` ricorsivo su target assoluti di `performance.now()`,
  avvicinamento in due stadi. Errore misurato < 1 ms su 25 eventi, nessuna deriva.
- **Finestra di esecuzione**: `tProssimo = tStimolo + execMs + foreperiod`.
  L'`execMs` non fa parte del foreperiod.
- **Lateralizzazione**: i comandi si pronunciano sempre con avanti/dietro, mai
  destra/sinistra. Il lato fisico viene risolto dal piano del comando
  (`striking`/`movimento` → `guardiaStriking`, `lotta`/`terra` → `guardiaLotta`)
  ed è mostrato come SX/DX solo per verifica.
- **Voce**: riferimento risolto una sola volta su `voiceschanged`, mai per comando.
  `speak(label)` è l'unico punto di erogazione, sostituibile con clip registrate.
- **Beep**: generati con oscillatori `AudioContext`, mai file audio.
- **Catene**: `speakSequenza` aggancia la pausa di 180 ms alla *fine* della parola
  precedente, non al suo inizio, con una rete di sicurezza se `onend` non arriva.
  Serve alla fase 4, è già verificato: 3 clip da 300 ms escono a 484 e 490 ms
  di distanza.
