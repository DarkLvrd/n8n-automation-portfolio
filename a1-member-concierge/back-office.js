// Front desk rules — the back office every tool call runs through.
// Input: one call from the concierge (action + fields) and the live bookings.
// Output: one item { op, reply, ... } that the Switch routes to the right table.
const NL = String.fromCharCode(10);
const call = $('Tool call from the concierge').first().json;
const profile = typeof call.profile === 'string' ? JSON.parse(call.profile || '{}') : (call.profile || {});
const tz = profile.timezone || 'Europe/London';
const classes = Array.isArray(profile.timetable) ? profile.timetable : JSON.parse(profile.timetable || '[]');
const windowDays = Number(profile.bookingWindowDays || 7);
const lateHours = Number(profile.lateCancelHours || 2);
const rows = $input.all().map(function (i) { return i.json; }).filter(function (r) { return r && r.booking_ref; });
const now = DateTime.now().setZone(tz);
const dayCodes = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const action = String(call.action || '').trim();
const chatId = String(call.chat_id || '').trim();
const memberName = String(call.member_name || 'Member').trim();
const askedClass = String(call.class_id || '').trim().toLowerCase();
const askedDate = String(call.class_date || '').trim().slice(0, 10);
const askedRef = String(call.booking_ref || '').trim().toUpperCase();

function findClass(id) {
  return classes.find(function (c) { return c.id === id; });
}
function startOf(c, isoDate) {
  return DateTime.fromISO(isoDate + 'T' + c.time, { zone: tz });
}
function taken(c, isoDate) {
  return rows.filter(function (r) { return r.class_id === c.id && r.class_date === isoDate && r.status === 'booked'; }).length;
}
function label(c, isoDate) {
  return c.name + ', ' + startOf(c, isoDate).toFormat('cccc d LLLL') + ' at ' + c.time;
}
// Every session from now until the end of the booking window.
function upcoming() {
  const out = [];
  for (let i = 0; i <= windowDays; i++) {
    const day = now.startOf('day').plus({ days: i });
    const code = dayCodes[day.weekday - 1];
    classes.forEach(function (c) {
      if (c.day !== code) return;
      const iso = day.toISODate();
      if (startOf(c, iso) <= now) return;
      out.push({ c: c, date: iso, left: Math.max(0, c.capacity - taken(c, iso)) });
    });
  }
  return out;
}
function newRef(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = '';
  do {
    ref = prefix;
    for (let i = 0; i < 4; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  } while (rows.some(function (r) { return r.booking_ref === ref; }));
  return ref;
}
function mine() {
  return rows.filter(function (r) {
    if (r.chat_id !== chatId || r.status !== 'booked') return false;
    const c = findClass(r.class_id);
    return c ? startOf(c, r.class_date) > now : true;
  });
}
function done(result) {
  return [{ json: Object.assign({ op: 'reply', staffChatId: profile.staffChatId || '' }, result), pairedItem: { item: 0 } }];
}

// ---------- check_availability ----------
if (action === 'check_availability') {
  let list = upcoming();
  if (askedClass) list = list.filter(function (s) { return s.c.id === askedClass || s.c.name.toLowerCase().indexOf(askedClass) > -1; });
  if (askedDate) list = list.filter(function (s) { return s.date === askedDate; });
  if (!list.length) return done({ reply: 'No sessions match that in the next ' + windowDays + ' days. Use only the timetable in your instructions to suggest another option.' });
  const lines = list.map(function (s) {
    return '- ' + label(s.c, s.date) + ' | class_id ' + s.c.id + ' | class_date ' + s.date + ' | ' + (s.left ? s.left + ' of ' + s.c.capacity + ' spots left' : 'FULL');
  });
  return done({ reply: 'Live availability:' + NL + lines.join(NL) });
}

// ---------- my_bookings ----------
if (action === 'my_bookings') {
  const list = mine();
  if (!list.length) return done({ reply: memberName + ' has no upcoming bookings.' });
  return done({
    reply: memberName + ' has ' + list.length + ' upcoming booking(s):' + NL + list.map(function (r) {
      return '- ' + r.class_name + ', ' + DateTime.fromISO(r.class_date).toFormat('cccc d LLLL') + ' at ' + r.class_time + ' (ref ' + r.booking_ref + ')';
    }).join(NL)
  });
}

// ---------- book_class ----------
if (action === 'book_class') {
  const c = findClass(askedClass);
  if (!c) return done({ reply: 'NOT BOOKED. Unknown class_id "' + askedClass + '". Valid ids: ' + classes.map(function (x) { return x.id; }).join(', ') });
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(askedDate)) return done({ reply: 'NOT BOOKED. class_date must look like 2026-11-28.' });
  const d = DateTime.fromISO(askedDate, { zone: tz });
  if (dayCodes[d.weekday - 1] !== c.day) return done({ reply: 'NOT BOOKED. ' + c.name + ' (' + c.id + ') does not run on ' + d.toFormat('cccc d LLLL') + '. It runs on ' + c.day + ' at ' + c.time + '.' });
  if (startOf(c, askedDate) <= now) return done({ reply: 'NOT BOOKED. That session has already started or finished.' });
  if (startOf(c, askedDate) > now.plus({ days: windowDays + 1 })) return done({ reply: 'NOT BOOKED. Bookings open ' + windowDays + ' days ahead. Ask the member to try again closer to the date.' });
  const already = mine().find(function (r) { return r.class_id === c.id && r.class_date === askedDate; });
  if (already) return done({ reply: 'ALREADY BOOKED. ' + memberName + ' already has ' + label(c, askedDate) + ' (ref ' + already.booking_ref + ').' });
  if (taken(c, askedDate) >= c.capacity) {
    const own = mine();
    const others = upcoming().filter(function (s) {
      const alreadyMine = own.some(function (r) { return r.class_id === s.c.id && r.class_date === s.date; });
      return s.left > 0 && !alreadyMine && (s.c.id === c.id || s.date === askedDate);
    }).slice(0, 4);
    return done({
      reply: 'NOT BOOKED. FULL: ' + label(c, askedDate) + ' has all ' + c.capacity + ' spots taken.' +
        (others.length ? NL + 'Open alternatives:' + NL + others.map(function (s) { return '- ' + label(s.c, s.date) + ' | class_id ' + s.c.id + ' | class_date ' + s.date + ' | ' + s.left + ' left'; }).join(NL) : '')
    });
  }
  const ref = newRef('OS-');
  const left = c.capacity - taken(c, askedDate) - 1;
  return done({
    op: 'book',
    row: { booking_ref: ref, chat_id: chatId, member_name: memberName, class_id: c.id, class_name: c.name, class_date: askedDate, class_time: c.time, status: 'booked' },
    reply: 'BOOKED. ' + label(c, askedDate) + ' with ' + c.coach + '. Ref ' + ref + '. ' + left + ' spot(s) left. Free cancellation until ' + lateHours + ' hours before the start.'
  });
}

// ---------- cancel_booking ----------
if (action === 'cancel_booking') {
  const list = mine();
  let hit = askedRef ? list.find(function (r) { return r.booking_ref === askedRef; }) : null;
  if (!hit && askedClass) {
    const matches = list.filter(function (r) { return r.class_id === askedClass && (!askedDate || r.class_date === askedDate); });
    if (matches.length === 1) hit = matches[0];
    if (matches.length > 1) return done({ reply: 'NOT CANCELLED. More than one booking matches. Ask which date: ' + matches.map(function (r) { return r.class_date + ' (ref ' + r.booking_ref + ')'; }).join(', ') });
  }
  if (!hit) return done({ reply: 'NOT CANCELLED. No matching upcoming booking for ' + memberName + '. Their bookings: ' + (list.length ? list.map(function (r) { return r.class_name + ' ' + r.class_date + ' ' + r.class_time + ' (ref ' + r.booking_ref + ')'; }).join('; ') : 'none') });
  const c = findClass(hit.class_id);
  const hoursToGo = c ? startOf(c, hit.class_date).diff(now, 'hours').hours : 99;
  const late = hoursToGo < lateHours;
  return done({
    op: 'cancel',
    cancelRef: hit.booking_ref,
    newStatus: late ? 'cancelled-late' : 'cancelled',
    reply: 'CANCELLED. ' + hit.class_name + ', ' + DateTime.fromISO(hit.class_date).toFormat('cccc d LLLL') + ' at ' + hit.class_time + ' (ref ' + hit.booking_ref + '). The spot is free for someone else.' +
      (late ? ' This was inside the ' + lateHours + '-hour window, so it counts as a late cancellation. Do not promise any refund or waiver; staff decide that.' : '')
  });
}

// ---------- hand_to_staff ----------
if (action === 'hand_to_staff') {
  const topic = String(call.topic || 'other').trim().toLowerCase();
  const summary = String(call.summary || '').trim() || '(no summary given)';
  const ref = newRef('T-');
  const urgent = ['injury', 'complaint', 'billing'].indexOf(topic) > -1;
  return done({
    op: 'ticket',
    ticket: { ticket_ref: ref, chat_id: chatId, member_name: memberName, topic: topic, summary: summary, status: 'handed off' },
    staffText: (urgent ? '🔴 ' : '🟡 ') + 'STAFF HANDOFF ' + ref + NL +
      'Member: ' + memberName + NL +
      'Topic: ' + topic + NL +
      'Summary: ' + summary + NL +
      'Reply to them on Telegram chat ' + chatId + '.' + NL +
      '(Ostrand Strength demo. Fictional gym, real automation.)',
    reply: 'HANDED OFF. Ticket ' + ref + ' (' + topic + ') is with the staff team, who reply within ' + (profile.staffReplyTime || 'one working day') + '. Do not promise any outcome.'
  });
}

return done({ reply: 'Unknown action "' + action + '".' });
