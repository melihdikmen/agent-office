// First-run tour: a spotlight on one part of the window at a time with a short note.
import { tt } from '../i18n.js';

const STEPS = [
  { sel: '#officeWrap', tr: ['Ofis', 'Çalışanların masalarında oturduğu 3B ofis. Bir karaktere tıkla: kartı açılır. Çift tıkla ya da sağ tıkla: terminalini aç. Sürükle: döndür, tekerlek: yakınlaştır.'], en: ['The office', 'Your workers sit at their desks in this 3D office. Click a character for their card; double-click or right-click to open their terminal. Drag to rotate, scroll to zoom.'] },
  { sel: '#addWorker', tr: ['Çalışan ekle', 'Rol, motor (Claude, Codex, Gemini) ve izinleri seçip işe al. İstersen kendi git worktree\'sinde, izole bir dalda çalışsın.'], en: ['Hire workers', 'Pick a role, an engine (Claude, Codex, Gemini) and permissions. Optionally give them their own git worktree for an isolated branch.'] },
  { sel: '.right-tabs', tr: ['Terminal, görevler, raporlar', 'Her çalışan kendi terminalinde çalışır. Görevler panosunda iş ver, Raporlar\'da kanıtlı sonuçları gör, Hub\'da araçları bağla.'], en: ['Terminals, tasks, reports', 'Every worker runs in their own terminal. Hand out work on the Tasks board, read evidence-backed results in Reports, connect tools in the Hub.'] },
  { sel: '#panes', tr: ['Terminaller', 'Başlığı sürükleyerek terminalleri yerleştir, gruplara ayır, ofis alanına taşı. ⇄ düğmesi terminali diğer alana gönderir.'], en: ['Terminals', 'Drag a header to rearrange terminals, split them into groups, or move them into the office area. The ⇄ button sends a terminal to the other area.'] },
  { sel: '#bellBtn', tr: ['Bildirimler', 'Hangi projede hangi ajan işi bitirdi ya da seni bekliyor, burada ve masaüstü bildirimi olarak görürsün.'], en: ['Notifications', 'See which agent finished work in which project, or is waiting for you — here and as desktop notifications.'] },
  { sel: '#tabInfo', tr: ['Yenilikler ve ayarlar', 'Sürüm notları, güncelleme denetimi, dil ve bu turu yeniden başlatma burada.'], en: ['What\'s new and settings', 'Release notes, update check, language and a way to replay this tour live here.'] },
];

export function startTour(onDone) {
  let i = 0;
  const veil = document.createElement('div');
  veil.className = 'tour-veil';
  const hole = document.createElement('div'); hole.className = 'tour-hole';
  const card = document.createElement('div'); card.className = 'tour-card';
  veil.append(hole, card);
  document.body.append(veil);
  const close = (done) => { veil.remove(); window.removeEventListener('resize', place); onDone?.(done); };

  function place() {
    const s = STEPS[i];
    const el = document.querySelector(s.sel);
    const [title, body] = tt(s.tr, s.en);
    const r = el?.getBoundingClientRect();
    if (r && r.width) {
      Object.assign(hole.style, { display: 'block', left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
    } else hole.style.display = 'none';
    card.innerHTML = `<div class="tour-step">${i + 1} / ${STEPS.length}</div><h4>${title}</h4><p>${body}</p>
      <div class="tour-actions"><button class="btn small" data-t="skip">${tt('Atla', 'Skip')}</button><span class="spacer"></span>
      ${i ? `<button class="btn small" data-t="prev">${tt('Geri', 'Back')}</button>` : ''}<button class="btn small primary" data-t="next">${i === STEPS.length - 1 ? tt('Bitir', 'Done') : tt('İleri', 'Next')}</button></div>`;
    const cw = 320, ch = card.offsetHeight || 170;
    let x = r ? r.left + r.width / 2 - cw / 2 : innerWidth / 2 - cw / 2;
    let y = r ? r.bottom + 16 : innerHeight / 2 - ch / 2;
    if (r && y + ch > innerHeight - 12) y = Math.max(12, r.top - ch - 16);
    if (r && r.height > innerHeight * 0.6) { y = r.top + 24; x = r.left + 24; }
    card.style.left = `${Math.max(12, Math.min(innerWidth - cw - 12, x))}px`;
    card.style.top = `${Math.max(12, Math.min(innerHeight - ch - 12, y))}px`;
  }
  card.onclick = (e) => {
    const a = e.target.closest('[data-t]')?.dataset.t;
    if (a === 'skip') close(false);
    if (a === 'prev') { i--; place(); }
    if (a === 'next') { if (i === STEPS.length - 1) close(true); else { i++; place(); } }
  };
  window.addEventListener('resize', place);
  place();
}
