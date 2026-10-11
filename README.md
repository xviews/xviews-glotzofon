# Xviews Glotzofon

**Nervt es dich auch?** Du willst deinen Freunden nur kurz etwas auf deinem Bildschirm zeigen, und plötzlich muss jeder erst ein Fernwartungsprogramm installieren, ein Konto anlegen oder in einen Call einsteigen.

**Mit Xviews Glotzofon geht das so:** EXE starten, Code weitergeben, fertig. Deine Freunde schauen in der App oder einfach im Browser zu. Ohne Installation, ohne Konto, ohne Fernsteuerung, nur zuschauen. Eine einzige EXE mit rund 9 MB, kostenlos.

[![Download XviewsGlotzofon.exe](https://img.shields.io/github/v/release/xviews/xviews-glotzofon?label=Download%20XviewsGlotzofon.exe&style=for-the-badge&logo=windows&logoColor=white&color=2ea44f)](https://github.com/xviews/xviews-glotzofon/releases/latest/download/XviewsGlotzofon.exe)

Direkter Download der neuesten Version für Windows 10/11 (64 Bit), ohne Installation. Weitere Hinweise unter [Download](#download).

![Startseite](bilder/1-start.png)

## Funktionen

- **Zeigen:** Ganzen Bildschirm oder einzelnes Fenster freigeben, auf Wunsch mit Systemton. Die App zeigt einen kurzen Code wie `K7M-X4P`, den du weitergibst.
  - **Zwei Modi:** *Scharf* (30 fps, Auflösung hat Vorrang, für Text und Desktop) und *Flüssig* (60 fps, Bildrate hat Vorrang, für Spiele und Videos).
  - **Mehrere Zuschauer** gleichzeitig.
  - **Nur lizenzfreie Codecs:** AV1, VP9 und VP8. Kann die Grafikkarte AV1 (NVIDIA RTX 40/50, Intel Arc, neuere AMD), kodiert sie das Bild, sonst übernimmt die CPU mit VP9. Die App zeigt an, welcher Encoder läuft.
  - **Schnellauswahl:** Modus, Auflösung und Datenrate während des Teilens umstellen, sofort und ohne neue Verbindung.
  - **Schwebende Leiste:** Nach dem Start wird das Fenster zu einer schmalen Leiste am Bildschirmrand, mit Code, Zuschauern und den wichtigsten Schaltern. Ohne Maus klappt sie zu einem kleinen Reiter zusammen. Für Zuschauer ist sie unsichtbar. Alternativ geht das Fenster in den Infobereich oder bleibt offen.
  - **Grafikkarte:** Auf Laptops mit zwei Grafikchips nutzt Glotzofon die leistungsstarke Karte.
  - **Quelle wechseln:** anderen Monitor oder anderes Fenster teilen, ohne neuen Code.
  - **Fester Code:** auf Wunsch immer derselbe Code, den sich Freunde merken können.
- **Zuschauen:** Code eingeben, verbinden. Vollbild per Doppelklick oder F11, Ton an/aus, Anzeige von Auflösung, fps und Datenrate.
  - **Auch ohne App im Browser:** einfach den Link öffnen, z. B. `https://xviews.github.io/xviews-glotzofon/#K7M-X4P`.
  - **Zoom und Verschieben** mit Mausrad und Ziehen, praktisch bei großen Bildschirmen.
  - **Reaktionen und Zeigen-Ping:** 👍, „Größer bitte“, „Ton fehlt“ … Mit Rechtsklick ins Bild erscheint beim Teilenden an genau der Stelle ein Kreis auf dem Bildschirm.
  - **Verbindungsampel:** grün, gelb oder rot, mit Ping und Paketverlust.
- **Deutsch und Englisch** umschaltbar.
- **Verbindungswege zum Auswählen:**
  - **Über Code (Internet):** klappt fast überall. Beide Seiten finden sich über einen Vermittlungsserver (öffentlich oder dein eigener).
  - **Direkt im eigenen Netz (IP-Adresse):** ganz ohne Server und auch ohne Internet, z. B. im Heimnetz oder auf einer LAN-Party.
  - **Relay-Server (TURN, optional):** für Netze, in denen keine direkte Verbindung zustande kommt.
- **Einstellungen:** Modus, höchste Auflösung und Datenrate, Grafikkarte, Codec, Verhalten beim Teilen, Systemton, Code automatisch kopieren, fester Code, Verbindungswege, Server, Design (Wie Windows, Hell, Dunkel), Sprache.
- **Updates mit einem Klick:** Die App meldet neue Versionen, lädt sie nach Rückfrage, prüft die Prüfsumme und startet neu.

![Teilen](bilder/2-teilen.png)

![Einstellungen](bilder/3-einstellungen.png)

## Download

➡️ **[Neueste Version unter „Releases“](../../releases/latest)**

| Datei | Größe | Hinweis |
|---|---|---|
| `XviewsGlotzofon.exe` | ca. 9 MB | läuft sofort, keine Installation |

**Voraussetzungen:** Windows 10 oder 11 (64 Bit). Die App nutzt Microsoft Edge WebView2, das bei Windows dabei ist, egal welchen Browser du verwendest.

**Sicherheit:** Die Prüfsumme (SHA-256) jeder Version steht im Release-Text. Mit `Get-FileHash .\XviewsGlotzofon.exe` in PowerShell kannst du sie selbst prüfen. Jede Version wird außerdem bei VirusTotal geprüft, das Ergebnis steht mit Link ebenfalls im Release-Text.

**Beim ersten Start:**
- Meldet SmartScreen „Unbekannter Herausgeber“, auf **„Weitere Informationen“** und dann auf **„Trotzdem ausführen“** klicken. Die EXE ist nicht signiert, weil ein Zertifikat Geld kostet.
- Nutzt du die Direktverbindung, fragt die Windows-Firewall einmal nach, ob Glotzofon im Netzwerk erreichbar sein darf.
- Einstellungen liegen in deinem Windows-Benutzerordner (`%LOCALAPPDATA%\XviewsGlotzofon`). Unter **Info** lässt sich auf den portablen Modus umstellen, dann liegt alles neben der EXE, praktisch auf einem USB-Stick.

## Wichtig

- Wer zuschaut, sieht alles, was im freigegebenen Bildschirm oder Fenster passiert. Vorher prüfen, was geteilt wird, und den Code nur Leuten geben, die du kennst.
- Nutzung auf eigene Verantwortung.
- Das Tool sammelt keine Daten und schickt nichts an mich. Ins Internet geht es nur in diesen Fällen:
  - **Vermittlungsserver** (öffentlich `0.peerjs.com` vom PeerJS-Projekt, oder dein eigener): nur beim Teilen und Zuschauen über Code, um die Verbindung aufzubauen. Der Server sieht den Code und die IP-Adressen, nicht das Bild.
  - **STUN** (Google, Cloudflare): Damit erfahren beide Seiten ihre öffentliche Adresse.
  - **Das Bild** läuft direkt und verschlüsselt (DTLS-SRTP) von PC zu PC, außer du stellst selbst einen Relay-Server ein.
  - **Update-Suche:** Die öffentliche Release-Seite auf GitHub wird abgefragt, standardmäßig einmal am Tag. In den Einstellungen wählbar: bei jedem Start, einmal am Tag, einmal pro Woche oder nie.

## Über den Namen

**Glotzofon** steht wirklich im [Duden](https://www.duden.de/rechtschreibung/Glotzofon): So nannte man um 1960 scherzhaft den Fernseher, aus *glotzen* und *-fon* wie beim Grammofon. Damals saß die ganze Familie vor dem Glotzofon. Heute ist es dein Bildschirm, der für ein paar Minuten zum Fernseher für deine Freunde wird.

Und **Xviews**? Das steht für „das Unbekannte sehen“. Hier ist es das, was du gerade auf deinem Bildschirm hast und deinen Leuten unbedingt zeigen willst.

**Xviews Glotzofon: Code rüber, Glotze an.**

## Fehler melden

Fehler und Wünsche gerne unter **[Issues](../../issues)**, am besten mit Screenshot und Windows-Version.

## Nutzungsbedingungen

Xviews Glotzofon ist **kostenlos für die private Nutzung**. Die unveränderte Weitergabe der Programmdatei ist erlaubt.

Nicht gestattet sind: der Verkauf, das Verändern des Programms, das Zurückentwickeln (Dekompilieren, Disassemblieren), die Übernahme von Programmcode oder Teilen davon in andere Software sowie das Einspeisen des Programms oder seines Codes in KI-Systeme, um es zu analysieren oder nachzubauen.

© 2026 Xviews. Die Rechte an eingebundenen Komponenten (PeerJS, go-webview2, go-winloader, coder/websocket, Go, Microsoft Edge WebView2 SDK) liegen bei ihren jeweiligen Urhebern. Die Lizenzen stehen in der App unter **Info**.
