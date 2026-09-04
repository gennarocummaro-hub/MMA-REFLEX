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

Serve un server statico (i moduli non servono, ma `localStorage` e la
Wake Lock API richiedono un'origine http/https, non `file://`):

```
python3 -m http.server 8080
```

poi apri `http://<ip-del-computer>:8080` da Safari su iPhone, stessa rete Wi-Fi.
Il primo tap su una modalità sblocca l'audio: da lì in poi voce e beep funzionano.

## Verifiche da console

```js
MMARX.debugForeperiod(200)      // istogramma + hazard rate vs baseline uniforme
MMARX.debugSelezione(500)       // ripetizioni consecutive e triple di categoria
MMARX.debugLateralizzazione()   // avanti/dietro con guardie diverse per piano
MMARX.cfg()                     // configurazione corrente
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
