# Agent Office

Bilgisayarındaki AI ajanlarını görsel bir ofiste yöneten masaüstü uygulaması (Electron).

- **Ekip**: PM, Tech Lead, Frontend, Backend, QA (+ opsiyonel Designer, DevOps). Her rol, seçtiğin proje klasöründe kendi kalıcı Claude Code oturumuyla (`claude -p`) çalışır.
- **Haberleşme**: Ajanlar `<message to="qa">…</message>`, `<task assignee="backend" title="…">…</task>`, `<task-update id="T-3" status="done">…</task-update>` etiketleriyle konuşur. Uygulama bunları yönlendirir, karakter alıcının masasına yürür; 3+ alıcıda toplantı odasından duyurur.
- **Görev panosu**: Ajanların ve senin açtığın görevler; durum/atanan değiştirilebilir.
- **Radar / Lobi**: Makinede çalışan diğer ajanlar (Claude Code oturumları, Claude Desktop, Cursor, Codex, Gemini CLI, Aider, Ollama…). Claude Code oturumlarına fork ile soru sorabilir, Terminal'de fork açabilir, süreci durdurabilirsin.
- **Güvenlik**: Döngü koruması (ajan→ajan zinciri `maxHops`'u aşınca mesaj bekletilir), aynı anda çalışan ajan limiti, Duraklat / Hepsini durdur, izin modu seçimi, sormadan çalışacak komut listesi.

## Çalıştırma

```bash
npm install
npm start          # uygulamayı açar
npm run check      # sözdizimi + unit testler
npm run dist       # (opsiyonel) electron-builder ile .dmg — önce: npm i -D electron-builder
```

Gereksinim: `claude` CLI (Claude Code) kurulu ve giriş yapılmış olmalı.

## Kullanım

1. **📁 Proje seç** → ekibin çalışacağı klasör.
2. Model ve izin modunu seç (başlangıç için *Haiku / Sonnet* + *Dosya düzenleyebilir* önerilir).
3. Alttaki kutudan PM'e hedefi yaz: “Login ekranına şifremi unuttum akışı ekleyelim, QA doğrulasın.”
4. Ofiste akışı izle; bir kişiye tıkla → canlı log, maliyet, doğrudan mesaj, durdur/oturum sıfırla.
5. Sana gelen mesajlar sarı vurgulanır ve bildirim olarak düşer (“Bana gelen” filtresi).

## Geliştirici ipuçları

- `AGENT_OFFICE_DATA=/dir` ayrı bir state klasörü kullanır.
- `AGENT_OFFICE_KICKOFF="metin"` açılışta PM'e brief gönderir.
- `AGENT_OFFICE_SNAPSHOT=/tmp/s%d.png` periyodik ekran görüntüsü alır.
