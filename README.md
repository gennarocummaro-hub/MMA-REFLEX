# MMA Reflex Trainer

Allenamento dei riflessi e del tempo di reazione di scelta nelle MMA tramite
comandi vocali erogati a intervalli randomizzati. HTML + CSS + JS vanilla,
nessun framework, nessun build step, nessuna dipendenza esterna.

## Stato: v1 completa

Tutte e sette le fasi del piano di costruzione sono implementate:
scheduler e foreperiod, UI di sessione e preset, no-go e stop-signal, catene
con matrice di transizione, test RT, log/storico/export, PWA offline.

## Verifica dei criteri di accettazione

| # | Criterio | Esito |
|---|---|---|
| 1 | Foreperiod non uniforme, hazard piatta | istogramma non uniforme (χ² 2400 su 20k); hazard più piatta della uniforme (CV 0.42 vs 0.57) ma **in salita verso fpMax** — vedi sotto |
| 2 | Nessun comando due volte di fila su 500 | 0 ripetizioni |
| 3 | Nessuna tripla di categoria su 500 | 0 triple |
| 4 | pNoGo 0.15 ± 0.02 su 500 | generatore non distorto (0.1508 su 200k); la banda ±0.02 su n=500 è 1.25σ — vedi sotto |
| 5 | Stop-signal fra 150 e 350 ms dall'onset | verificato in sessione reale, min 205 max 345 |
| 6 | Nessuna catena viola la matrice | 0 violazioni su ~1200 catene |
| 7 | Guardie indipendenti per piano | hook avanti → sinistra, single leg avanti → destra |
| 8 | Tap a 250 ms registrato come 250 ± 15 ms | scarto massimo 3.9 ms su 16 prove |
| 9 | Funziona offline dopo la prima apertura | ricarica offline 200 dalla cache, app montata |
| 10 | Densità = comandi emessi / durata round | esatta |

### Due criteri che non si possono soddisfare alla lettera

Non sono difetti di implementazione: sono proprietà matematiche di quello che
la spec prescrive. In entrambi i casi il codice fa esattamente ciò che è
scritto e il test verifica ciò che è verificabile.

**Criterio 1 — hazard piatta.** Per una esponenziale troncata su [0,1] la
hazard è h(x) = λ/(1−e^(−λ(1−x))), che diverge per x→1. Con λ=1.2 sale da 0.16
a 0.52 attraverso la finestra: più piatta di una uniforme, non piatta. Alzare
`lambda` la appiattisce davvero (a λ=12 il CV scende a 0.02) ma concentra i
foreperiod vicino a `fpMin`, rinunciando alla parte alta della finestra.
`lambda` è configurabile; `debugForeperiod()` stampa il confronto con la
baseline uniforme.

**Criterio 4 — 0.15 ± 0.02 su 500 stimoli.** Con un'estrazione di Bernoulli
indipendente — che è quello che "con probabilità pNoGo" prescrive — l'errore
standard su n=500 è 0.016, quindi ±0.02 è 1.25σ e viene rispettato solo
nell'~81% dei blocchi. Il test verifica che il generatore non sia distorto
(0.1508 su 200 000 estrazioni) e che la quota di blocchi dentro la banda sia
coerente con la binomiale. Se preferisci che il criterio passi alla lettera
serve un'estrazione stratificata (esattamente 75 no-go ogni 500, in ordine
casuale) invece che indipendente: dimmelo e la cambio.

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
MMARX.sessioniSalvate()         // storico grezzo
MMARX.csvSessioni()             // export CSV come stringa
MMARX.Sessione.ssdLog           // SSD effettivi dell'ultima sessione
```

## Go / No-go, stop-signal, catene

- **No-go** (`pNoGo` 0.15): stimolo a cui non si risponde. Modo A parola
  configurabile (default "fake"), modo B doppio beep 880 Hz, oppure alternati.
- **Stop-signal** (`pStop` 0.10): dopo un comando go, a un SSD casuale fra 150 e
  350 ms dall'onset. Con `stopConCambio` attivo (default) non arriva un semplice
  "stop" ma **un comando nuovo che sovrascrive il precedente**: la finestra di
  esecuzione riparte dall'onset del nuovo comando.
- I due meccanismi non capitano mai sullo stesso stimolo: lo stop viene estratto
  solo se il no-go non è uscito.
- **Catene** (`pCatena` 0.35): il primo elemento è una normale estrazione e
  rispetta i vincoli di §2.3; i successivi seguono la matrice dei piani. I
  vincoli "mai due volte lo stesso comando" e "mai 3 di fila della stessa
  categoria" valgono sulla scelta dello stimolo, non dentro la catena — la
  matrice ammette esplicitamente striking → striking, cioè le combinazioni.

## Test RT

Gira prima e dopo ogni sessione (disattivabile). RT semplice 15 stimoli, RT di
scelta 20 su quattro quadranti colorati con suoni distinti. L'onset è quello
**audio**, ricavato da `AudioContext.getOutputTimestamp()`, non l'istante in cui
gira il JS; le risposte usano `event.timeStamp` quando disponibile. Sotto 150 ms
sono anticipazioni, sopra 1500 ms lapse: entrambe escluse dalle statistiche e
contate a parte, come gli errori di quadrante. Media, mediana e deviazione
standard (campionaria, n−1) si calcolano sulle risposte valide e corrette.

## Storico

Grafico a linee dell'RT medio pre nel tempo, due serie (semplice e scelta) con
legenda ed etichetta diretta sull'ultimo punto. Palette validata sulla
superficie scura: blu #3987e5 e arancio #d95926, separazione CVD ΔE 26.8.
Export CSV di tutte le sessioni, una riga per round; su iPhone il download può
aprire il file invece di salvarlo, per questo c'è anche COPIA NEGLI APPUNTI.

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
  Verificato: 3 clip da 300 ms escono a 484 e 490 ms di distanza.
- **PWA**: `sw.js` cachea l'app shell con strategia cache-first e aggiornamento in
  sottofondo; alza `VERSIONE` a ogni rilascio. Le icone sono data URI dentro
  `manifest.json`, così i file restano quelli previsti dalla spec — su iOS
  l'`apple-touch-icon` come data URI non è garantito, se la home screen mostra
  un'icona generica servirà un vero file PNG.
- **Wake lock**: richiede un secure context. Su `http://<ip>` non è disponibile e
  l'app te lo dice; su https funziona.
