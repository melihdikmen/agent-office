// Turkish is the source language; English is applied on top. Static and dynamic
// DOM text is translated by exact match (and a few patterns), so views stay untouched.
// New components use tt('Türkçe', 'English') directly.
const PAIRS = [
  ['Ofis', 'Office'], ['Sohbet', 'Chat'], ['İnceleme', 'Review'], ['Editör', 'Editor'], ['Tasarım', 'Design'], ['Takım sohbeti', 'Team chat'], ['Kod', 'Code'], ['Terminal', 'Terminal'], ['Görevler', 'Tasks'], ['Raporlar', 'Reports'], ['Hafıza', 'Memory'], ['Tarayıcı', 'Browser'], ['Hub', 'Hub'],
  ['＋ Takım', '＋ Team'], ['＋ Çalışan', '＋ Worker'], ['⚙ Yönet', '⚙ Manage'], ['EDIT', 'EDIT'], ['▮ Terminal', '▮ Terminal'], ['◫ 3B Ofis', '◫ 3D Office'],
  ['Ofis kur', 'Set up an office'], ['📁 Proje klasörü seç', '📁 Choose project folder'], ['OFİS YOK', 'NO OFFICE'], ['UYUYOR', 'ASLEEP'], ['Ofis · Kod', 'Office · Code'],
  ['Bir proje klasörü seç; çalışanlar o klasörde, kendi terminallerinde çalışır.', 'Pick a project folder; workers run in it, each in its own terminal.'],
  ['Ofisler', 'Offices'], ['Çalışan ekle', 'Add worker'], ['Yeni terminal', 'New terminal'], ['Yeni terminal grubu', 'New terminal group'], ['Yeni çalışan', 'New worker'],
  ['3B ofis alanına terminal koy / geri al', 'Put terminals in the 3D office area / take them back'], ['3B ofis alanını kapat, yerine terminalleri koy', 'Close the 3D office, show terminals in its place'],
  ['Ofisi gizle (⌘\\)', 'Hide the office (⌘\\)'], ['Ofisi göster (⌘\\)', 'Show the office (⌘\\)'], ['Odaktaki terminali yana böl', 'Split the focused terminal sideways'],
  ['Ofisi değiştir / yeniden adlandır', 'Switch / rename office'], ['Bildirimler', 'Notifications'], ['Bildirimler açık', 'Notifications on'], ['Ses', 'Sound'],
  ['✓ okundu', '✓ mark read'], ['Temizle', 'Clear'], ['Ayarlar', 'Settings'], ['Hepsini okundu yap', 'Mark all as read'], ['şimdi', 'now'],
  ['Sistem bildirimi yalnızca uygulama arkadayken', 'System notification only when the app is in the background'],
  ['Görev tamamlandı', 'Task completed'], ['Onay / yanıt bekliyor', 'Waiting for approval / reply'], ['Çalışmayı bıraktı (boşta)', 'Stopped working (idle)'], ['Yeni görev atandı', 'New task assigned'],
  ['Henüz bildirim yok. Bir ajan görev bitirince ya da seni beklediğinde burada görünür.', 'No notifications yet. They appear here when an agent finishes a task or waits for you.'],
  ['çalışıyor', 'working'], ['boşta', 'idle'], ['seni bekliyor', 'waiting for you'], ['uyuyor', 'asleep'], ['başlıyor', 'starting'],
  ['Backlog', 'Backlog'], ['Yapılacak', 'To do'], ['Yapılıyor', 'In progress'], ['İncelemede', 'In review'], ['Bitti', 'Done'], ['Sahip', 'Owner'], ['atanmamış', 'unassigned'], ['— atanmamış —', '— unassigned —'],
  ['Lider', 'Lead'], ['Tasarımcı', 'Designer'], ['Frontend Geliştirici', 'Frontend Developer'], ['Backend Geliştirici', 'Backend Developer'], ['Araştırmacı', 'Researcher'], ['Pazarlama', 'Marketing'], ['İçerik Yazarı', 'Content Writer'], ['SEO Uzmanı', 'SEO Specialist'], ['Geliştirici', 'Developer'],
  ['Kapat', 'Close'], ['Kaydet', 'Save'], ['Vazgeç', 'Cancel'], ['İşe al', 'Hire'], ['Sil', 'Delete'], ['Başlat', 'Start'], ['Durdur', 'Stop'], ['▶ Başlat', '▶ Start'], ['■ Durdur', '■ Stop'], ['Değiştir', 'Change'],
  ['Ad', 'Name'], ['Rol', 'Role'], ['Rol adı', 'Role name'], ['Görev tanımı', 'Duties'], ['Motor', 'Engine'], ['Model', 'Model'], ['İzinler', 'Permissions'], ['Komut yolu', 'Command path'], ['Ek argümanlar', 'Extra arguments'],
  ['Gelişmiş (Codex / Gemini)', 'Advanced (Codex / Gemini)'], ['Lider (hedefleri böler ve dağıtır)', 'Lead (splits goals and hands them out)'], ['Hemen başlat', 'Start right away'],
  ['Kendi git worktree\'sinde çalış (izole dal, diğer ajanlarla çakışmaz)', 'Work in its own git worktree (isolated branch, no clashes with other agents)'],
  ['Dosya düzenler, komutlarda sorar', 'Edits files, asks before commands'], ['Otomatik (auto)', 'Automatic (auto)'], ['Hiç sormaz (riskli)', 'Never asks (risky)'], ['Salt okuma (plan)', 'Read-only (plan)'],
  ['boşsa otomatik', 'automatic if empty'], ['boşsa PATH\'te aranır', 'looked up in PATH if empty'], ['Hafızasını gör', 'View memory'], ['komut yaz…', 'type a command…'], ['Gönder (Enter)', 'Send (Enter)'],
  ['▮ Terminalde aç', '▮ Open in terminal'], ['▮ Terminalini aç', '▮ Open terminal'], ['ⓘ Detay / ayarlar', 'ⓘ Details / settings'], ['✦ Bu ofise dahil et', '✦ Add to this office'],
  ['terminal ›', 'terminal ›'], ['detay ›', 'details ›'], ['Alta böl', 'Split down'], ['Yana böl', 'Split sideways'], ['Büyüt/küçült', 'Maximize/restore'], ['Temizle', 'Clear'],
  ['Terminali diğer alana taşı (ofis alanı ⇄ sağ panel)', 'Move terminal to the other area (office area ⇄ side panel)'], ['Sürükleyip başka bir terminalin kenarına bırak', 'Drag onto the edge of another terminal'],
  ['Bir çalışanın karakterine çift tıkla ya da + shell ile terminal aç.', 'Double-click a worker\'s character or use + shell to open a terminal.'], ['Grup adı', 'Group name'],
  ['Tıkla: aç · çift tıkla: yeniden adlandır · terminal başlığını buraya sürükle: gruba taşı', 'Click: open · double-click: rename · drag a terminal header here: move it to the group'],
  ['Grubu kapat (terminaller yanındaki gruba taşınır)', 'Close group (its terminals move to the neighbouring group)'],
  ['Bu oturumun toplam maliyeti ve token kullanımı', 'Total cost and token use of this session'],
  ['DÜZENLEME: eşyaları sürükle · masaya tıkla → çalışan ata · Delete siler', 'EDIT: drag items · click a desk → assign a worker · Delete removes'],
  ['Masa', 'Desk'], ['Bitki', 'Plant'], ['Kitaplık', 'Bookshelf'], ['Kanepe', 'Sofa'], ['Tahta', 'Board'], ['Kahve', 'Coffee'], ['Kahve makinesi', 'Coffee machine'], ['Sebil', 'Cooler'], ['Su sebili', 'Water cooler'], ['Sunucu', 'Server'], ['Halı', 'Rug'], ['Toplantı masası', 'Meeting table'], ['Masa (toplantı)', 'Table (meeting)'], ['Ekle:', 'Add:'],
  ['TOPLANTI', 'MEETING'], ['KAHVE', 'COFFEE'], ['ATÖLYE', 'WORKSHOP'], ['LOUNGE', 'LOUNGE'], ['DEV WING', 'DEV WING'],
  ['Henüz commit yok.', 'No commits yet.'], ['Worktree\'yi sil', 'Delete worktree'], ['Commit\'le', 'Commit'], ['Worktree, çalışan ilk başladığında açılır.', 'The worktree is created when the worker first starts.'], ['worktree durumu okunuyor…', 'reading worktree status…'],
  ['Henüz değişen dosya yok.', 'No changed files yet.'], ['Canlı izle', 'Live watch'], ['Bir dosya seç; değişikliği burada görünür.', 'Pick a file; its changes show here.'],
  ['Henüz çalışan yok.', 'No workers yet.'], ['Ayrıntı', 'Details'], ['Alt görevler', 'Subtasks'], ['Not ekle (çalışana da iletilir)', 'Add a note (also sent to the worker)'],
  ['Hands-off: biri bitince sıradaki görev otomatik başlar', 'Hands-off: when one task ends the next one starts automatically'],
  ['Sistem tarayıcısında aç', 'Open in system browser'], ['ÇALIŞAN · tıkla → sadece onun notları', 'WORKER · click → only their notes'],
  ['Henüz not yok. Çalışanlar memory_note ile karar ve tercihleri kaydettikçe harita dolar.', 'No notes yet. The map fills as workers record decisions and preferences with memory_note.'],
  ['Ofis kurulumu', 'Office setup'], ['Çalışanların çalışacağı klasör', 'Folder the workers will work in'], ['İletildi', 'Delivered'], ['Anahtar kaydedildi ve entegrasyon açıldı.', 'Key saved and integration enabled.'],
  ['● bağlı · yeni başlayan çalışanlara verilir', '● connected · given to workers that start'], ['(kurulu değil)', '(not installed)'], ['kayıtlı', 'saved'],
  ['Yazılım ekibi', 'Software team'], ['Araştırma ekibi', 'Research team'], ['Ürün ekibi', 'Product team'],
  ['Kullanım limiti doldu / devam etti', 'Usage limit hit / resumed'], ['Kullanım limiti doldu', 'Usage limit reached'], ['Limit sıfırlandı', 'Limit reset'],
  ['Bütçe uyarısı / aşıldı', 'Budget warning / exceeded'], ['Bütçe (USD, her başlatmada; boş = sınırsız)', 'Budget (USD per start; empty = unlimited)'], ['Bütçe doldu, durduruldu', 'Budget reached, stopped'],
  ['Beceriler', 'Skills'],
  ['Önemli bildirimleri sesli oku', 'Read important notifications aloud'],
  ['⬇ İçe aktar', '⬇ Import'], ['PR aç', 'Open PR'], ['Liste yapıştır', 'Paste a list'],
  ['Ayrı pencereye çıkar', 'Open in its own window'],
  ['🎲 Görünümü değiştir', '🎲 Change look'], ['🎨 Tema', '🎨 Theme'],
  ['Kararlar', 'Decisions'], ['Karar istiyor', 'Wants a decision'], ['⚑ Karar', '⚑ Decision'],
  ['Hakkında, yenilikler, güncelleme', 'About, what\'s new, updates'], ['Yenilikler', 'What\'s new'],
];
const DICT = new Map(PAIRS);
const PATTERNS = [
  [/^(\d+) çalışıyor$/, '$1 working'], [/^(\d+) bekliyor$/, '$1 waiting'], [/^(\d+) uyuyor$/, '$1 asleep'], [/^(\d+)\/(\d+) active$/, '$1/$2 active'],
  [/^(\d+) (dk|sa|g)$/, '$1 $2'], [/^(\d+) commit önde$/, '$1 commits ahead'], [/^(.+) önce$/, '$1 ago'],
  [/^(\d+) commitlenmemiş değişiklik$/, '$1 uncommitted changes'], [/^(\d+) not · (\d+) bağ$/, '$1 notes · $2 links'], [/^✓ (\d+) doğrulama$/, '✓ $1 checks'], [/^⚠ (\d+) başarısız$/, '⚠ $1 failed'],
  [/^(.+) · detay$/, '$1 · details'], [/^(.+) · hafıza$/, '$1 · memory'], [/^(.+) ofise katıldı$/, '$1 joined the office'], [/^(.+) işe alındı$/, '$1 was hired'], [/^(\d+) commit birleştirildi$/, '$1 commits merged'],
  [/^(.+)'(?:ya|a|e|ye) komut yaz…$/, 'Type a command for $1…'], [/^(.+) uyanıyor, komut birazdan iletilecek…$/, '$1 is waking up, the command goes in shortly…'],
  [/^(.+) dalına birleştir$/, 'Merge into $1'], [/^(.+) tamamlandı$/, '$1 completed'], [/^Seni bekliyor$/, 'Waiting for you'], [/^Yeni görev \((.+)\)$/, 'New task ($1)'],
  [/^(\d+) doğrulama geçti$/, '$1 checks passed'], [/^(\d+)\/(\d+) doğrulama başarısız$/, '$1/$2 checks failed'], [/^(\d+) dosya$/, '$1 files'],
];

let current = 'tr';
export const getLang = () => current;
export const tt = (tr, en) => (current === 'en' ? en : tr);

function tr2en(s) {
  const core = s.trim();
  if (!core) return s;
  let out = DICT.get(core);
  if (out == null) { const m = core.match(/^([^A-Za-zÇĞİÖŞÜçğıöşü0-9]+)(.+)$/); if (m && DICT.has(m[2])) out = m[1] + DICT.get(m[2]); }
  if (out == null) for (const [re, rep] of PATTERNS) { if (re.test(core)) { out = core.replace(re, rep); break; } }
  return out == null ? s : s.replace(core, out);
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
function walk(node) {
  if (node.nodeType === 3) { const v = tr2en(node.nodeValue); if (v !== node.nodeValue) node.nodeValue = v; return; }
  if (node.nodeType !== 1) return;
  for (const a of ATTRS) if (node.hasAttribute?.(a)) { const v = tr2en(node.getAttribute(a)); if (v !== node.getAttribute(a)) node.setAttribute(a, v); }
  if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.classList?.contains('xterm')) return;
  for (const c of node.childNodes) walk(c);
}

export function initI18n(lang) {
  current = lang === 'en' ? 'en' : 'tr';
  document.documentElement.lang = current;
  if (current !== 'en') return;
  walk(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') walk(m.target);
      else if (m.type === 'attributes') walk(m.target);
      else for (const n of m.addedNodes) walk(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
