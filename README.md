# Diario del Mister – web app per allenatori di calcio giovanile

PWA installabile su iPhone (e Android/PC) per gestire **rosa, partite, eventi live e statistiche**.
Ogni telefono tiene i dati in locale (IndexedDB) e funziona anche **offline**. Facoltativamente, i mister possono condividere un unico **archivio online** (giocatori, partite, eventi, tracking) protetto da un codice di accesso.

## Funzioni

- **Squadre e stagioni**: più squadre, più stagioni per squadra, copia della rosa nella nuova stagione.
- **Rosa**: profilo completo (foto, ruolo, posizione, piede, numero di maglia con storico, data/luogo di nascita, altezza, peso, contatto genitore, scadenza visita medica, note, **campi personalizzati**), pagina di modifica dedicata.
- **Partite** da 1 a 3 tempi, convocati e titolari, **tagging live dal telefono**: gol (con assist), tiri in porta/fuori, passaggi riusciti/sbagliati, palle perse, recuperi, cambi, gol subiti. Cronometro per tempo, schermo sempre acceso, annulla/modifica evento. **Minuti giocati** calcolati automaticamente da titolari, cambi e durata dei tempi. Inserimento manuale degli eventi anche a fine partita.
- **Statistiche** per partita (giocatori e squadra per tempo) e cumulative di stagione.
- **Scheda giocatore in PDF** (dati anagrafici, riepilogo, valori per 90′, andamento, tendenze, heatmap, tabella partite).
- **Tracking**: import di un file JSON per partita con soli numeri di maglia (distanza, velocità, sprint, posizioni, heatmap). I dati vengono agganciati ai giocatori tramite **numero di maglia + squadra + stagione**, tenendo conto dello storico dei numeri; ogni collegamento è correggibile. Funzione **Unisci giocatori** per i casi di doppioni o cambio numero.
- **Analisi**: andamento di ogni giocatore nella stagione, confronto tra giocatori dello stesso ruolo, tabella **per 90 minuti**, confronto **1° / 2° (/3°) tempo** di squadra, **segnalazioni automatiche** di miglioramenti e cali nelle ultime 3 partite.
- **Backup**: esporta/importa un file JSON con tutti i dati.
- **Archivio condiviso** (facoltativo): tutti i mister che hanno il codice vedono e modificano gli stessi dati; sincronizzazione automatica, funziona anche offline (le modifiche partono appena torna la rete).

## Pubblicare su Vercel – passo passo

Non serve installare nulla sul computer e non c'è nessuna fase di "build": sono file statici.

### Metodo A – da GitHub (consigliato, aggiornamenti automatici)

1. **Metti il codice su GitHub.** La cartella `mister-app/` deve trovarsi in un repository GitHub (es. questo repository).
2. **Crea un account Vercel.** Vai su <https://vercel.com/signup> e scegli *Continue with GitHub*. Il piano *Hobby* è gratuito.
3. **Importa il progetto.** Nella dashboard premi **Add New… → Project**, trova il repository e premi **Import**.
   Se non compare, premi *Adjust GitHub App Permissions* e autorizza Vercel ad accedere al repository.
4. **Configura il progetto** nella schermata *Configure Project*:
   - **Framework Preset**: `Other`
   - **Root Directory**: premi *Edit* e scegli `mister-app`
   - **Build Command**: lascia vuoto (oppure attiva *Override* e lascia il campo vuoto)
   - **Output Directory**: `.` (un punto)
   - **Install Command**: lascia vuoto
5. Premi **Deploy**. Dopo circa 30 secondi ottieni un indirizzo tipo `https://mister-app-xxxx.vercel.app`.
6. *(Facoltativo)* **Scegli un nome più semplice**: *Settings → Domains*, aggiungi per esempio `diario-mister.vercel.app` se è libero, oppure un tuo dominio.
7. **Aggiornamenti**: ogni volta che modifichi i file su GitHub, Vercel ripubblica da solo. Quando cambi il codice, aumenta `VERSION` in `sw.js` (es. `mister-v1.0.1`): così i telefoni scaricano la nuova versione.

### Metodo B – senza GitHub (Vercel CLI)

1. Installa Node.js da <https://nodejs.org>.
2. In un terminale:
   ```bash
   npm i -g vercel
   cd mister-app
   vercel          # la prima volta: login e conferma del progetto (rispondi alle domande, directory "./")
   vercel --prod   # pubblica la versione definitiva
   ```
3. Il comando stampa l'indirizzo pubblico da condividere.

### Attivare l'archivio condiviso (una volta sola)

L'archivio usa un piccolo database gratuito collegato al progetto Vercel.

1. Su vercel.com apri il progetto → scheda **Storage** → **Create Database** (o *Browse Marketplace*) → scegli **Upstash** → **Redis** → piano **Free** → crea il database e **collegalo al progetto** (Connect Project). Vercel aggiunge da solo le variabili `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
2. Nel progetto vai su **Settings → Environment Variables** e aggiungi:
   - **Key**: `ACCESS_CODE`
   - **Value**: un codice difficile da indovinare, es. `rondine-tigre-4827` (non usare il nome della squadra)
   - spunta tutti gli ambienti (Production, Preview, Development) e salva.
3. Vai su **Deployments**, sui tre puntini dell'ultimo deploy scegli **Redeploy** (serve per leggere le nuove variabili).
4. Nell'app: **Altro → Archivio condiviso**, scrivi il codice e premi **Collega**. Lascia spuntato *Carica anche i dati già presenti* se hai già inserito squadre e giocatori.
5. Gli altri mister installano l'app dallo stesso link e al primo avvio scrivono il codice in **"Ti hanno dato un codice?"**.

Per **togliere l'accesso** a qualcuno cambia `ACCESS_CODE` su Vercel, fai *Redeploy* e comunica il nuovo codice solo a chi deve continuare a usarlo.

Come funziona: ogni modifica viene salvata subito sul telefono e inviata all'archivio dopo pochi secondi; ogni 30 secondi (e quando riapri l'app) arrivano le modifiche degli altri. Se due persone modificano la stessa scheda, resta la modifica più recente. L'icona ☁︎ in alto mostra lo stato (un numero indica modifiche ancora da inviare).

### Condividerla con altri mister

1. Manda il link (WhatsApp, email…).
2. Ognuno lo apre **con Safari** su iPhone → tasto **Condividi** (quadrato con freccia) → **Aggiungi alla schermata Home** → **Aggiungi**.
3. Si apre come un'app a schermo intero e funziona anche senza connessione.

Senza archivio condiviso ogni allenatore ha i **propri dati, solo sul proprio telefono**. Con l'archivio condiviso, chi inserisce il codice vede gli stessi dati di tutti gli altri.

### Prova in locale (facoltativa)

```bash
cd mister-app
python3 -m http.server 8080
# apri http://localhost:8080
```
(Il service worker funziona solo su `localhost` o su HTTPS, come su Vercel.)

## Uso in partita – consigli

1. Prima della partita: **Partite → ＋**, inserisci avversario, numero e durata dei tempi, convocati e **titolari**.
2. Al fischio d'inizio: **Avvia live → ▶ Inizia**. Tocca un'azione (es. *Passaggio ok*) e poi il numero del giocatore. Per i ragazzi in panchina usa *Panchina…*.
3. *Cambio*: prima chi esce, poi chi entra. A fine tempo premi **Fine tempo**; all'inizio del tempo successivo puoi cambiare la formazione (utile con i cambi "a blocchi" tipici delle categorie giovanili).
4. Se registri a fine partita: imposta lo stato **finita** e aggiungi gli eventi da *Eventi → Aggiungi evento*.

## Formato del file di tracking

```json
{
  "formato": "mister-tracking",
  "versione": 1,
  "partita": { "data": "2026-10-12", "avversario": "…", "squadra": "Esordienti", "stagione": "2026/27" },
  "campo": { "lunghezza": 65, "larghezza": 45 },
  "giocatori": [
    {
      "numero": 7,
      "distanza_m": 5230,
      "velocita_max_kmh": 23.4,
      "sprint": 11,
      "minuti": 50,
      "posizioni": [[0, 32.5, 22.0], [5, 33.1, 21.4]],
      "heatmap": { "colonne": 12, "righe": 8, "valori": [0, 1, 4, …] }
    }
  ]
}
```

- Solo `giocatori[].numero` è obbligatorio; tutti gli altri campi sono facoltativi.
- `posizioni`: `[secondo, x in metri, y in metri]`, origine nell'angolo in alto a sinistra del campo. Se manca `heatmap` viene calcolata dalle posizioni.
- `heatmap` accetta anche una matrice `[[…],[…]]`. Sono accettate anche le chiavi in inglese (`players`, `number`, `distance_m`, `positions`…).
- I dati `partita.*` servono solo per avvisare se il file sembra di un'altra partita.
- Esempio completo: `esempi/tracking-esempio.json`.

## Come vengono calcolate le statistiche

- **Minuti giocati**: per ogni tempo, dal momento in cui il giocatore è in campo (titolare o entrato) fino all'uscita o alla fine del tempo. Durata del tempo = cronometro live, oppure durata impostata (modificabile in *Formazioni → Durata*).
- **Per 90′**: valore ÷ minuti × 90. Per distanza e sprint si usano solo i minuti delle partite con tracking.
- **Tendenze**: media delle ultime 3 partite (con almeno 10′ giocati) confrontata con le precedenti; servono almeno 4 presenze. Si segnalano variazioni di almeno il 25% (10 punti percentuali per la precisione passaggi). Per le palle perse un calo è un miglioramento.
- **Tiri**: un gol conta anche come tiro in porta.

## Struttura

```
mister-app/
├── index.html, manifest.webmanifest, sw.js, vercel.json
├── api/sync.js        archivio condiviso (funzione Vercel + Upstash Redis)
├── js/sync.js         sincronizzazione lato app
├── css/app.css
├── js/app.js          router, stato, intestazione
├── js/db.js           IndexedDB + backup
├── js/stats.js        minuti, statistiche, per 90, tendenze, numeri di maglia
├── js/charts.js       grafici SVG e heatmap
├── js/tracking.js     lettura e validazione file di tracking
├── js/pdf.js          scheda giocatore PDF (jsPDF)
├── js/views/*.js      schermate
├── vendor/            jsPDF (licenza MIT)
├── icons/             icone app
└── esempi/            file di tracking di esempio
```

## Privacy

Senza archivio condiviso i dati (anche foto e dati di minori) restano nel browser del dispositivo. Con l'archivio condiviso attivo, **tutti i dati, compresi foto, date di nascita, contatti dei genitori e visite mediche, sono salvati sul database Upstash** e visibili a chiunque abbia il codice: dai il codice solo allo staff, cambialo quando qualcuno lascia la società, e verifica con la società l'informativa privacy per i genitori. Raccogli comunque il consenso dei genitori per foto e dati personali, ed esporta regolarmente il backup: se elimini l'app dalla schermata Home o cancelli i dati di Safari, i dati locali vengono persi.
