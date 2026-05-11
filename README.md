# 🎬 WoxVideo Editor

Un editor video non-lineare moderno, leggero ed estremamente potente, in esecuzione direttamente nel browser sfruttando le moderne tecnologie web e l'accelerazione hardware **WebGPU**.

🚀 **[PROVALO ORA ONLINE!](https://wox76.github.io/woxvideo/)**

---

## ✨ Caratteristiche Principali

- **🎞️ Timeline Multi-Traccia Avanzata**: Gestisci tracce video, audio e di testo con strumenti di selezione, taglio (taglierina/forbici) ed eliminazione.
- **⚙️ Accelerazione WebGPU**: Utilizza l'API WebGPU di nuova generazione per il rendering in tempo reale e l'elaborazione degli effetti ad alte prestazioni con accelerazione hardware.
- **🌉 Transizioni di Livello Professionale**:
  - **Cross Fade**: Dissolvenza incrociata morbida e lineare o con curva morbida ad S.
  - **Luma Mask (Maschera Luma)**: Usa un video in bianco e nero personalizzato come maschera di transizione per svelare clip successive in modi creativi.
- **🎵 Gestione Audio Dedicata**: Regolazione del guadagno/volume e opzione di mute indipendente per ciascuna clip audio caricata.
- **🎨 Integrazione Stock Pixabay**: Cerca e importa migliaia di video e immagini di stock royalty-free direttamente dal pannello di importazione inserendo la tua API key di Pixabay.
- **🔍 Viewport Interattiva**: Zoom dinamico della preview del lettore tramite rotellina del mouse e opzione a schermo intero per controllare ogni dettaglio del montaggio.
- **📦 Esportatore Integrato**: Esporta i tuoi video finiti direttamente nel browser nei formati MP4 (WebM/VP9) raccomandati o WebM Standard con opzioni di risoluzione fino a **1080p Full HD** e framerate a **60 FPS**.
- **💾 Salvataggio Automatico**: Non perdere mai il tuo lavoro grazie al sistema di autosave integrato.

---

## 🛠️ Tecnologie Utilizzate

- **HTML5 & Semantic Markup**: Struttura dell'app moderna ed accessibile.
- **CSS3 Personalizzato (Vanilla CSS)**: Interfaccia utente elegante e responsiva ispirata ai software di editing professionali (come CapCut e Premiere), completa di supporto drag and drop, effetti di vetro smerigliato (*glassmorphism*) e transizioni fluide.
- **JavaScript (ES6+)**: Logica applicativa interamente modulare ed orientata agli eventi.
- **WebGPU & Web Audio API**: Per l'elaborazione multimediale e gli effetti speciali ad altissime prestazioni.
- **Modern Normalize & FontAwesome**: Per una resa grafica e di icone coerente e cross-browser.

---

## 🚀 Come Iniziare Localmente

Se vuoi eseguire l'editor sul tuo computer locale, non hai bisogno di configurare alcun build system pesante! Segui semplicemente questi passaggi:

1. Clona questo repository:
   ```bash
   git clone https://github.com/wox76/woxvideo.git
   ```
2. Entra nella cartella del progetto:
   ```bash
   cd woxvideo
   ```
3. Avvia un server locale (ad esempio usando l'estensione *Live Server* di VS Code o python):
   ```bash
   # Se usi Python 3
   python -m http.server 8000
   ```
4. Apri il browser all'indirizzo `http://localhost:8000` (è consigliato un browser moderno che supporti WebGPU, come Google Chrome o Microsoft Edge).

---

## 🎮 Come Usare l'Editor

1. **Importa i Media**: Clicca su **Import** per caricare file dal tuo computer o inserisci la tua API Key Pixabay per usare file stock online.
2. **Organizza sulla Timeline**: Trascina e rilascia le clip multimediali sulla timeline.
3. **Applica Transizioni**: Seleziona esattamente due clip adiacenti tenendo premuto `Ctrl` (o `Cmd` su Mac) per sbloccare la scheda **Transizioni** nel pannello di destra. Scegli tra dissolvenza o maschera Luma.
4. **Taglia o Elimina**: Usa l'icona delle forbici (`Cut`) per dividere una clip in corrispondenza dell'indicatore di riproduzione, o seleziona una clip e premi `Canc`/`Backspace` per eliminarla.
5. **Esporta**: Clicca sul pulsante **Export** in alto a destra, seleziona risoluzione, codec e fps, e salva il tuo capolavoro!

---

## 📄 Licenza

Questo progetto è rilasciato per uso personale e di sviluppo. Consultare il codice sorgente per ulteriori dettagli.

---

*Sviluppato con passione da [wox76](https://github.com/wox76).*
