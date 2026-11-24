// Informativa privacy (art. 13 Regolamento UE 2016/679 – GDPR) mostrata ai giocatori e ai genitori.
// Le parti tra [parentesi quadre] vanno completate dalla società prima dell'uso definitivo.
import { sheet } from './util.js';

export const PRIVACY_VERSION = '2026-11-24';

export const PRIVACY_HTML = `
<div class="privacy">
<h3>Informativa sul trattamento dei dati personali</h3>
<p class="small muted">ai sensi dell'art. 13 del Regolamento UE 2016/679 (GDPR) e del D.Lgs. 196/2003 · versione del 23/11/2026</p>

<h4>1. Titolare del trattamento</h4>
<p><strong>A.S.D. Calcio Palazzo</strong>, con sede in [indirizzo della sede], C.F./P.IVA [numero], e-mail [indirizzo e-mail della società], di seguito "la Società".</p>

<h4>2. Quali dati trattiamo</h4>
<ul>
<li><strong>Dati della scheda giocatore</strong> inseriti dal giocatore o dal genitore: nome e cognome, squadra, ruolo, <strong>fotografia</strong>, <strong>data di nascita</strong>, <strong>numero di cellulare</strong> e <strong>indirizzo e-mail</strong>.</li>
<li><strong>Dati sportivi</strong>: presenze ad allenamenti e partite, risposte alle convocazioni, statistiche di gioco (gol, assist, minuti, risultati), dati ricavati dall'analisi dei video delle partite (es. distanza percorsa, posizione in campo).</li>
<li><strong>Messaggi</strong> scritti in risposta agli avvisi della bacheca.</li>
<li><strong>Video delle partite</strong> girati dalla Società o dai suoi incaricati, usati solo per l'analisi tecnica.</li>
</ul>
<ul>
<li><strong>Dati dei genitori</strong> che si registrano: nome, cognome, codice fiscale, data di nascita, cellulare, e-mail, indirizzo e collegamento ai figli.</li>
<li><strong>Documenti</strong> caricati da giocatori o genitori: documento d'identità, <strong>certificato medico di idoneità sportiva</strong> (dato relativo alla salute, art. 9 GDPR, trattato solo per verificare l'idoneità richiesta dalle norme sportive) e altri documenti.</li>
<li><strong>Pagamenti</strong>: modalità scelta, rate pagate, ricevute caricate e <strong>dati per la fattura</strong> (intestatario, codice fiscale o partita IVA, indirizzo, e-mail/PEC, codice SDI).</li>
</ul>

<h4>3. Perché li trattiamo (finalità e base giuridica)</h4>
<ul>
<li>organizzare l'attività sportiva (convocazioni, allenamenti, comunicazioni) – <em>esecuzione del rapporto associativo e sportivo</em> (art. 6.1.b GDPR);</li>
<li>analisi tecnica e statistiche di crescita sportiva del giocatore – <em>consenso</em> (art. 6.1.a);</li>
<li>pubblicazione all'interno dell'app di foto, data di nascita, nome, ruolo e statistiche, visibili a giocatori, genitori e staff della Società – <em>consenso</em> (art. 6.1.a).</li>
</ul>

<h4>4. Chi vede i dati</h4>
<ul>
<li><strong>Visibili nell'app a chi ha il link</strong> (giocatori, genitori, staff): nome, squadra, ruolo, numero di maglia, foto, data di nascita, statistiche sportive, presenze e messaggi in bacheca.</li>
<li><strong>Visibili solo al giocatore, ai genitori collegati e agli allenatori/dirigenti della Società</strong>: documenti, certificato medico, pagamenti, ricevute e dati per la fattura.</li>
<li><strong>Visibili solo agli allenatori e ai dirigenti della Società</strong> (accesso con password): dati dei genitori, cellulare, e-mail, link ai video, risposte alle convocazioni e ai motivi di assenza.</li>
<li>I dati non vengono venduti né ceduti a terzi per scopi commerciali.</li>
</ul>

<h4>5. Dove sono conservati</h4>
<p>I dati sono conservati su servizi cloud usati come <em>responsabili del trattamento</em>: Vercel Inc. (pubblicazione dell'app) e Upstash Inc. (archivio dati), con possibile trasferimento extra UE secondo le garanzie previste dal GDPR (clausole contrattuali standard / Data Privacy Framework). I video sono conservati dalla Società su [Dropbox / Google Drive].</p>

<h4>6. Per quanto tempo</h4>
<p>Per la durata della stagione sportiva e fino a [12] mesi dopo la sua conclusione, oppure fino alla richiesta di cancellazione. I video vengono cancellati dopo l'analisi e comunque entro [6] mesi.</p>

<h4>7. Minori</h4>
<p>Per i giocatori con meno di 14 anni il consenso deve essere dato da chi esercita la responsabilità genitoriale (art. 2-quinquies D.Lgs. 196/2003). Per i ragazzi dai 14 ai 17 anni si raccomanda che la scheda venga compilata insieme a un genitore.</p>

<h4>8. I tuoi diritti</h4>
<p>Puoi chiedere in qualsiasi momento l'accesso ai dati, la rettifica, la <strong>cancellazione</strong>, la limitazione, la portabilità e opporti al trattamento, e puoi <strong>revocare il consenso</strong> senza conseguenze sulla partecipazione all'attività sportiva. Puoi cancellare la scheda direttamente dall'app (Altro → Privacy → Cancella la mia scheda) o scrivere a [e-mail della società]. Puoi inoltre presentare reclamo al Garante per la protezione dei dati personali (www.garanteprivacy.it).</p>

<h4>9. Conferimento</h4>
<p>La compilazione della scheda è facoltativa. Senza scheda il giocatore partecipa comunque all'attività sportiva, ma non può rispondere dall'app a convocazioni e bacheca.</p>
</div>`;

/** Apre l'informativa in un pannello a comparsa. */
export function showPrivacy() {
  return sheet('Informativa privacy', (body) => { body.innerHTML = PRIVACY_HTML; });
}
