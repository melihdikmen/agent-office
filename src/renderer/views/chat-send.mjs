// Send flow for the chat box, DOM-free so it can be tested: the box empties the moment
// the message is taken, a second send is ignored while one is in flight, and the text
// comes back if the send fails (unless the owner has already typed something new).
export async function sendDraft(ctx) {
  if (ctx.sending) return false;
  const text = ctx.get().trim();
  if (!text) return false;
  ctx.sending = true;
  ctx.set('');
  let err = null;
  try { const r = await ctx.send(text); if (r?.error) err = r.error; } catch (e) { err = e?.message || String(e); }
  ctx.sending = false;
  if (err) {
    if (!ctx.get()) ctx.set(text);
    ctx.toast(err, 'err');
    return false;
  }
  return true;
}
