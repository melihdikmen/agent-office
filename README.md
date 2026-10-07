# Agent Office

Bilgisayarında bir AI ekibi kur, pixel-art ofiste yönet (Electron). Her çalışan kendi terminalinde Claude Code olarak çalışır; sen hedefi yazarsın, lider böler, ekip çalışır, iş kanıtlı raporla kapanır.

## Neler var

- **Pixel-art ofis**: Odalar, masalar, isimli çalışanlar. Çalışan masasında mavi parlar, seni bekleyen "!" ile seslenir, uyuyan "z z" ile oturur, boşta kalan dolaşır. Sprite'a tıkla → son cevabı ve komut kutusu; çift tıkla → terminali. **EDIT** ile eşyaları sürükle, masa ata, zemin değiştir.
- **Terminal bölmeleri**: Her çalışan ve her shell gerçek bir pty'de (node-pty + xterm). Yana/alta böl, büyüt, kapat; bölme başlığında model, branch ve **kullanım sayacı** (toplam $ ve token).
- **Ekip**: `+ Çalışan` tek kişi, `+ Takım` şablondan (yazılım, pazarlama, araştırma, ürün). Rol, görev tanımı, model, izin modu. Kalıcı kimlik: her çalışanın oturumu ve hafıza dosyası kalır; kapatıp açınca aynı konuşmaya döner.
- **Görev panosu**: Backlog → Yapılacak → Yapılıyor → İncelemede → Bitti. Sahibin eklediği hedef lidere gider; lider `task_create` ile alt görevlere böler ve dağıtır. Atanan kart çalışanın terminaline düşer; uyuyorsa uyanır.
- **Kanıtlı raporlar**: Bir görev yalnızca `task_done` ile, çalıştırılan doğrulamalar (typecheck, build, test…) ve değişen dosyalarla kapanır. Raporlar sekmesinde okunur.
- **Hands-off**: Sol alttaki anahtar açıkken boşa düşen çalışan sıradaki açık kartı alır.
- **Hafıza**: Çalışanlar `memory_note` ile karar ve tercihleri yazar, `memory_search` ile takımın hafızasında arar. Hafıza sekmesi notları ve `[[etiket]]` bağlarını harita olarak çizer.
- **Kod / Canlı izle**: Projede değişen dosyalar anlık listelenir, tıklayınca diff.
- **Tarayıcı**: Uygulama içi webview (localhost dahil).
- **Hub**: GitHub, Sentry, Supabase, Linear, Notion, Vercel, Stripe, PostgreSQL, Playwright, Context7. Bir kez bağla; sonra başlayan her çalışan MCP aracı olarak kullanır. Anahtarlar sistem anahtar zincirinde şifreli saklanır.
- **Türkçe**: Arayüz ve çalışanların dili.

## Çalıştırma

```bash
npm install            # node-pty Electron için derlenir (Xcode Command Line Tools gerekir)
npm start              # derler ve açar
npm run check          # sözdizimi + derleme + testler
npm run shot           # deneme ofisi kurup out/shots/ altına görüntü alır (2 gerçek Haiku oturumu başlatır)
```

Gereksinim: `claude` CLI (Claude Code v2.1.224+) kurulu ve giriş yapılmış olmalı.

## Nasıl çalışır

- Çalışan başlatmak = `claude --name <ad> --model … --permission-mode … --append-system-prompt <brifing> --mcp-config <ofis>` komutunu bir pty'de açmak. Brifing kimliği, takımı, pano kurallarını ve hafıza dosyasını anlatır.
- Uygulama yerel bir **MCP sunucusu** çalıştırır (`src/main/mcp.js`); her çalışan kendi token'lı adresinden bağlanır ve `board_list`, `task_create`, `task_update`, `task_done`, `message`, `memory_note`, `memory_search`, `team_list` araçlarını alır. Pano, raporlar ve hafıza bu araçlarla yürür.
- Durum (çalışıyor / boşta / seni bekliyor) Claude Code'un kendi oturum kaydından (`~/.claude/sessions`), son cevap ve maliyet oturum dökümünden okunur.
- Sahibin komutu ve pano bildirimleri çalışanın terminaline yazılır; Claude hazır olana kadar kuyrukta bekler.
- Veriler: ofisler, çalışanlar, kartlar ve raporlar `office.json`'da; hafıza dosyaları `workspaces/<ofis>/memory/` altında (uygulama veri klasöründe). Kod, terminal çıktısı ve oturum dökümleri kendi diskinde kalır.

## Bilinmesi gerekenler

- Her çalışan ayrı bir Claude oturumudur; 4–5 kişilik konuşan bir ekip tek oturumdan çok daha fazla token harcar. Bölme başlığındaki sayaç gerçek maliyeti gösterir.
- Varsayılan izin modu **auto**; yine de bazı komutlar onay ister, çalışan o zaman ofiste "!" ile görünür ve bildirim gelir; terminalinde yanıtlarsın. "Hiç sormaz" modu seçilebilir (riskli).
- `~/.claude/sessions` ve döküm biçimi Claude Code'un iç yapısıdır; değişirse durum göstergeleri kabalaşır, iş akışı bozulmaz.
- Hub'daki paket ve adresler servislerin resmi MCP sunucularıdır; ilk bağlantıda OAuth isteyenler tarayıcı açar.

## Geliştirme

- `AGENT_OFFICE_DATA=/dir` ayrı bir veri klasörü kullanır.
- `scripts/shot.js` uygulamayı görünmez bir pencerede açıp görüntü alır; `SHOT_ONLY=office,board` seçili görünümler, `SHOT_WAIT=60000` liderin görevleri bölmesi için bekleme.
