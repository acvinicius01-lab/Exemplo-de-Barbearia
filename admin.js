import { createApiClient } from './api-client.mjs';
const $ = selector => document.querySelector(selector);
let today = '', pendingAction = null, requestId = 0;
const message = (selector,text = '',error = false) => { $(selector).textContent = text; $(selector).classList.toggle('error',error); };
const node = (tag,className,text) => { const element = document.createElement(tag); element.className = className || ''; if (text !== undefined) element.textContent = text; return element; };
const future = (date,time) => new Date(`${date}T${time}:00-03:00`) > new Date();
const dateLabel = date => new Date(`${date}T12:00:00-03:00`).toLocaleDateString('pt-BR',{timeZone:'America/Fortaleza',day:'2-digit',month:'long',year:'numeric'});

function showLogin() { requestId++; pendingAction = null; $('#dashboard').hidden = true; $('#logout').hidden = true; $('#login-panel').hidden = false; $('#appointments').replaceChildren(); $('#blocks').replaceChildren(); $('#action-dialog').close(); }
function showDashboard() { $('#login-panel').hidden = true; $('#dashboard').hidden = false; $('#logout').hidden = false; }
const api = createApiClient({base:'/api/admin/',onUnauthorized:path => { if (path !== 'login') { showLogin(); message('#login-status','Sua sessão terminou. Entre novamente para continuar.'); } }});
const post = data => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

function ask(title,description,action) { pendingAction = action; $('#action-title').textContent = title; $('#action-description').textContent = description; message('#action-status'); $('#action-dialog').showModal(); }

async function loadSchedule() {
  const date = $('#date').value; if (!date) return;
  const id = ++requestId; const previousTime = $('#block-time').value; message('#panel-status','Carregando agenda…');
  $('#dashboard').setAttribute('aria-busy','true');
  $('#block-submit').disabled = true; $('#block-time').replaceChildren(); $('#appointments').replaceChildren(); $('#blocks').replaceChildren();
  for (const selector of ['#booking-count','#block-count','#free-count']) $(selector).textContent = '—';
  try {
    const data = await api(`schedule?date=${date}`); if (id !== requestId) return;
    today = data.today; $('#schedule-date').textContent = dateLabel(date);
    const booked = new Set(data.bookings.map(booking => booking.time)), blocked = new Set(data.blocks.map(block => block.time));
    const free = data.slots.filter(time => !booked.has(time) && !blocked.has(time) && future(date,time));
    $('#booking-count').textContent = data.bookings.length; $('#block-count').textContent = data.blocks.length; $('#free-count').textContent = free.length;
    for (const booking of data.bookings) {
      const card = node('article','appointment'); const details = node('div');
      details.append(node('h3','',booking.name),node('p','',booking.service));
      const price = booking.price === null ? 'Valor a consultar' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(booking.price);
      details.append(node('p','',`Valor de exemplo: ${price}`));
      const phone = node('a','',booking.phone); phone.href = `tel:+55${booking.phone}`; phone.setAttribute('aria-label',`Ligar para ${booking.name}`); details.append(phone);
      const cancel = node('button','danger-button','Cancelar'); cancel.type = 'button'; cancel.setAttribute('aria-label',`Cancelar reserva de ${booking.name} às ${booking.time}`);
      cancel.onclick = () => ask('Cancelar agendamento?',`${booking.name} · ${booking.service} · ${dateLabel(date)} às ${booking.time}. O horário será liberado.`,() => api(`bookings/${booking.code}`,{method:'DELETE'}));
      card.append(node('strong','',booking.time),details,cancel); $('#appointments').append(card);
    }
    if (!data.bookings.length) $('#appointments').append(node('p','empty-state','Nenhum agendamento neste dia.'));
    for (const time of free) { const option = node('option','',time); option.value = time; $('#block-time').append(option); }
    if (free.includes(previousTime)) $('#block-time').value = previousTime;
    if (!free.length) { const option = node('option','','Sem horários livres'); option.value = ''; $('#block-time').append(option); }
    $('#block-submit').disabled = !free.length;
    for (const block of data.blocks) {
      const row = node('div','blocked-row'), details = node('div'); details.append(node('strong','',block.time),node('p','',block.reason || 'Sem motivo informado'));
      const unblock = node('button','','Liberar'); unblock.type = 'button'; unblock.setAttribute('aria-label',`Liberar horário ${block.time}`);
      unblock.onclick = () => ask('Liberar horário?',`${dateLabel(date)} às ${block.time}. O bloqueio será removido.`,() => api(`blocks/${date}/${block.time}`,{method:'DELETE'}));
      row.append(details,unblock); $('#blocks').append(row);
    }
    if (!data.blocks.length) $('#blocks').append(node('p','field-note','Nenhum horário bloqueado.'));
    message('#panel-status', data.slots.length ? '' : 'A barbearia está fechada neste dia.');
  } catch (error) { if (id === requestId) message('#panel-status',error.message,true); }
  finally { if (id === requestId || $('#dashboard').hidden) $('#dashboard').setAttribute('aria-busy','false'); }
}

$('#login').onsubmit = async event => { event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; message('#login-status','Entrando…'); try { await api('login',post({password:$('#password').value})); $('#password').value = ''; const session = await api('session'); today = session.today; $('#date').value = today; showDashboard(); message('#login-status'); await loadSchedule(); } catch (error) { message('#login-status',error.message,true); } finally { button.disabled = false; } };
$('#logout').onclick = async () => { try { await api('logout',{method:'POST'}); requestId++; showLogin(); message('#login-status','Você saiu do painel.'); } catch (error) { message('#panel-status',error.message,true); } };
$('#date-filter').onsubmit = event => { event.preventDefault(); loadSchedule(); };
$('#date').onchange = loadSchedule;
function changeDay(offset) { if (!$('#date').value) return; const date = new Date(`${$('#date').value}T12:00:00Z`); date.setUTCDate(date.getUTCDate()+offset); $('#date').value = date.toISOString().slice(0,10); loadSchedule(); }
$('#previous-day').onclick = () => changeDay(-1); $('#next-day').onclick = () => changeDay(1);
$('#today').onclick = () => { $('#date').value = today; loadSchedule(); };
$('#block-form').onsubmit = event => { event.preventDefault(); if (!$('#block-time').value) return; const date = $('#date').value, time = $('#block-time').value, reason = $('#reason').value.trim(); ask('Bloquear horário?',`${dateLabel(date)} às ${time}. Este intervalo não aceitará reservas.`,() => api('blocks',post({date,time,reason}))); };
$('#dismiss-action').onclick = () => $('#action-dialog').close();
$('#confirm-action').onclick = async () => { if (!pendingAction) return; const action = pendingAction; $('#confirm-action').disabled = true; $('#dismiss-action').disabled = true; message('#action-status','Salvando…'); try { await action(); pendingAction = null; $('#action-dialog').close(); $('#reason').value = ''; await loadSchedule(); } catch (error) { message('#action-status',error.message,true); } finally { $('#confirm-action').disabled = false; $('#dismiss-action').disabled = false; } };
$('#action-dialog').addEventListener('cancel',event => { if ($('#confirm-action').disabled) event.preventDefault(); });
const refreshSchedule = () => { if (!$('#dashboard').hidden && !$('#action-dialog').open) loadSchedule(); };
window.addEventListener('focus',refreshSchedule);
document.addEventListener('visibilitychange',() => { if (!document.hidden) refreshSchedule(); });
(async () => { try { const session = await api('session'); today = session.today; $('#date').value = today; showDashboard(); await loadSchedule(); } catch (error) { showLogin(); if (error.status !== 401) message('#login-status',error.message,true); } })();
