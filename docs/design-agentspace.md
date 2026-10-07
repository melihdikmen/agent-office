# Tasarım spec — AgentSpace hissi (T-2)

Hedef: ofis "canlı" görünsün; bir bakışta kim ne yapıyor anlaşılsın. Uygulayıcı: Ada.
Dosyalar: `src/renderer/office/office.js` (simülasyon + çizim), `office/sprites.js`, `styles.css`, `views/*`.

Mevcut durum: `workers.js` şu durumları veriyor → `offline | starting | idle | working | waiting` (+ `waitingFor`, `statusSince`).
Çizimde zaten var: çalışırken masada bob, bekleyende sarı `!`, offline'da `z z`, boştayken kahve odasına gezinti (`wanderSpot`).
Eksik: balonların tek tip olması, "onay ister" ile "girdi bekliyor" ayrımı, gezinti nedenleri, üst çubuk/sekme tutarlılığı.

## 1. Durum → görünüm tablosu

| Durum | Karakter | Balon (kafa üstü) | Masa/ekran | Renk |
|---|---|---|---|---|
| `working` | Masada, bob (mevcut) + 2 kare yazma kolu | `…` üç nokta, 0.4 sn'de bir dolar (`.` `..` `...`); görev varsa kısa başlık (≤24 kr) 4 sn'de bir dönüşümlü | Ekran parlak (`def.work`), hafif titreşim | `--blue` |
| `waiting` + `waitingFor` onay/izin içeriyor | Masada, kolu havada (el kaldırma karesi) | Sarı `!` yerine `? Onay` kapsül; yukarı-aşağı zıplama (mevcut sin, 3 px) | Ekran sarı çerçeve | `--yellow` |
| `waiting` (diğer: soru/girdi) | Masada, başı yana | Mavi-mor `…?` kapsül, zıplama yok, yavaş nabız | Ekran normal | `--purple` |
| `idle` | Masada boş durur; 40–120 sn'de bir gezinti | Yok. Gezintideyse bağlama göre ikon balonu (bkz. §2) | Ekran sönük | — |
| `starting` | Masaya doğru yürür / belirir (fade-in 0.4 sn) | `…` gri | Ekran kapalı | `--muted` |
| `offline` | Masada oturmaz, **başı masada** (uyku karesi), alfa 0.45 (mevcut) | `z` `zz` `zzz` döngü, yukarı süzülür | Ekran kapalı | `--muted` |

Kural: bir karakterde aynı anda **tek** balon. Öncelik: elle verilen `c.bubble` (mesaj/olay) > `waiting` > `offline` > `starting` > `working` ipucu.
Balon boyutu sabit: yükseklik 14 px, köşe 3 px, 1 px koyu kenar, altta 3 px kuyruk. Metin yalnızca `ui-monospace 9px`; tek istisna `!`/`?` (bold 11 px).
`waiting` ≥ 60 sn sürerse balon nabzı hızlanır ve odanın üst çubuğundaki sayaç (bkz. §4) kırmızıya döner — sahibin dikkati gereken yer burası.

## 2. Odalar arası yürüme

Mevcut: yalnız `idle` + rastgele kahve/lounge/toplantı odası. Yeni: **neden** göstersin.

| Tetik | Hedef | Süre | Balon |
|---|---|---|---|
| `idle` ≥ 40 sn, rastgele | Kahve/lounge | 5–9 sn bekler | ☕ ikon (7×7 piksel sprite) |
| İki ajan arasında `message` gitti | Gönderen, alıcının masasına yürür; 3 sn durur; döner | 3 sn | Gönderende `✉`, alıcıda `!` kısa |
| Görev `done` olunca | Çalışan, lider odasına/Nova'nın masasına gider (rapor) | 3 sn | `✓` yeşil |
| `waiting` | **Yürümez** (sahibi bulmak kolay olsun) | — | — |
| `working` | Yürümez; gezinti varsa iptal, yol masaya (mevcut `errand` iptali korunur) | — | — |

Kurallar:
- Aynı anda en fazla 2 karakter odalar arasında gezinsin (ofis kalabalık/kaotik görünmesin). Sayaç `Office` seviyesinde, `nextWander` ile birlikte kontrol edilir.
- Gezinti iptalinde ışınlanma yok: normal yoldan masaya dönsün (mevcut davranış doğru).
- Yürüme hızı `SPEED=3.2` kalsın; kapıda (oda sınırı) 0.15 sn yavaşlama istemiyoruz — gereksiz.
- Toplantı odası: ≥2 karakter aynı anda gezintideyse kahveye değil toplantı odasına gitsinler, birbirine dönük dursunlar (`dir` karşılıklı).
- `prefers-reduced-motion`: gezinti ve balon animasyonları kapalı, durum yalnız statik balon + renk.

## 3. Panel/sekme cilası

Sorun: sekmeler (`.tabs`, 38 px) ile ofis üstündeki araçlar farklı yükseklik/ritimde; boş ve aktif durumlar tutarsız.

- **Tek üst çubuk**: yükseklik 38 px, sol 78 px trafik ışığı boşluğu (mevcut), sürükleme alanı (mevcut). Alt çizgi `--line`.
- **Sekme durumları**: normal `--muted`; hover `--text` + `--panel2` %50; aktif `--text` + `--panel2` + alt 2 px `--accent` çizgi. Şu an aktifte yalnız arka plan var; alt çizgi eklenecek.
- **Sekme rozeti**: Pano → açık/review görev sayısı; Terminal → `waiting` ajan sayısı (kırmızı değil sarı, ≥60 sn ise kırmızı). Rozet 14 px yükseklik, `font-size:10px`, mevcut `.muted` yerine `.badge`.
- **Boş durumlar**: her görünüm (pano, hafıza, raporlar, izle) boşken tek satır açıklama + tek eylem; ortalanmış, `--muted`, ikon yok.
- **Başlıklar**: görünüm başlığı 13 px/600, alt metin 11 px `--muted`; tüm görünümlerde aynı üst boşluk (12 px) ve yan boşluk (14 px).
- **Düğmeler**: iki tip yeter — birincil (`--accent` zemin, `--accent-ink` yazı) ve ikincil (şeffaf, `--line` kenar). Köşe 6 px. Mevcut serbest stilli düğmeler bu ikiye indirilsin.
- **Durum noktası** (ajan listelerinde, terminal sekmesi başlığında, pano kartında): çalışıyor `--blue`, bekliyor `--yellow` (nabız), boşta `--green`, offline `--muted`. Ofis balon renkleriyle aynı eşleme — tek kaynak: CSS değişkenleri, canvas'ta `getComputedStyle` ile okunsun (sabit hex tekrarı yok).

## 4. Oda başlıkları ve üst bilgi

- Oda adı (mevcut, küçük yazı) yanına o odadaki aktif ajan sayısı: `Geliştirme · 2`.
- Ofis sağ üst köşede tek satır özet: `● 2 çalışıyor  ● 1 bekliyor  ○ 1 uyuyor` (aynı durum renkleri). Tıklayınca ilgili ajan seçilir (`select(id)`); `waiting` varsa ilk onda o seçili gelir.
- Karaktere tıklama (mevcut seçim) → ajan kartı: ad, rol, durum, `statusSince` ("4 dk'dır bekliyor"), `waitingFor` metni, "Terminale git" düğmesi.

## 5. Uygulama notları (Ada için)

1. `drawChar` içindeki balon bloğunu (`office.js` ~472–484) `bubbleFor(c, v)` fonksiyonuna çıkar: `{text|icon, bg, fg, anim}` döndürsün; çizim tek yerde.
2. `waitingFor` ayrımı için basit regex yeterli: `/izin|onay|permission|approve|allow/i` → "Onay"; değilse "girdi".
3. Yeni sprite'lar `sprites.js`'e: kahve fincanı, zarf, onay işareti (7×7), el kaldırma ve uyku kareleri (karakter başına 2 ek kare). Ek kare yoksa ilk sürümde sadece balonlar yapılsın, kare animasyonu ikinci adım.
4. Sürekli animasyon için `this.t` zaten var; `setInterval` ekleme.
5. Öncelik sırası: (a) balonlar + renk eşlemesi, (b) üst özet + sekme rozetleri, (c) mesaj/done yürüyüşleri, (d) kare animasyonları.

## 6. Kabul ölçütleri

- Dört durum (çalışıyor/bekliyor/onay/uyuyor) ofiste 1 sn içinde ayırt edilebilir; her biri tek bakışta benzersiz renk+şekil.
- `waiting` ajan hiçbir zaman yürümez; `working` ajan hiçbir zaman gezintide değildir.
- Aynı anda ≤2 gezinen karakter.
- Tüm durum renkleri CSS değişkenlerinden gelir; canvas'ta hex yok.
- Sekme çubuğu tüm görünümlerde aynı yükseklik/ritim; aktif sekme alt çizgiyle belli.
- `prefers-reduced-motion` açıkken hareket yok, bilgi kaybı yok.
