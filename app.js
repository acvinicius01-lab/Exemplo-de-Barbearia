const $ = selector => document.querySelector(selector);
const state = { services: [], service: null, today: '', day: '', month: '', time: null, request: 0, found: null };
const money = value => value === null ? 'A consultar' : new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0}).format(value);
const dateObject = date => new Date(`${date}T12:00:00-03:00`);
const formatDate = (date, options) => dateObject(date).toLocaleDateString('pt-BR', {timeZone:'America/Fortaleza', ...options});
const dateKey = date => date.toISOString().slice(0,10);
const status = (selector, message = '', error = false) => { $(selector).textContent = message; $(selector).classList.toggle('error', error); };

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {...options, signal:controller.signal});
    const payload = await response.json();
    if (!response.ok) { const error = new Error(payload.error || 'Não foi possível concluir.'); error.status = response.status; throw error; }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('O servidor demorou a responder. Consulte sua reserva antes de tentar novamente.');
    if (error instanceof TypeError) throw new Error('Não foi possível conectar. Confira sua conexão e tente novamente.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function selectService(name) {
  state.service = state.services.find(service => service.name === name);
  document.querySelectorAll('.service-choice').forEach(button => {
    const selected = button.dataset.service === name;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateSummary();
}

function renderServices() {
  $('#services').replaceChildren();
  $('#service-choices').replaceChildren();
  state.services.forEach((service, index) => {
    const card = element('article', `service-card${index === 2 ? ' featured' : ''}`);
    const icon = element('span', 'service-icon', ['✂','⌁','✦','♡'][index] || '✂'); icon.setAttribute('aria-hidden','true');
    card.append(icon, element('span','service-number',String(index + 1).padStart(2,'0')), element('h3','',service.name), element('p','',service.description));
    const price = element('div','service-price');
    const link = element('a','','↗'); link.href = '#agenda'; link.setAttribute('aria-label',`Agendar ${service.name}`); link.onclick = () => selectService(service.name);
    price.append(element('strong','',money(service.price)),link); card.append(price); $('#services').append(card);
    const button = element('button','service-choice'); button.type = 'button'; button.dataset.service = service.name;
    button.append(element('span','',service.name),element('small','',money(service.price)));
    button.onclick = () => selectService(service.name); $('#service-choices').append(button);
  });
  selectService(state.services[0].name);
}

function updateSummary() {
  $('#summary-service').textContent = state.service?.name || 'Selecione um serviço';
  $('#summary-price').textContent = state.service ? money(state.service.price) : '—';
  $('#selection').textContent = state.time ? `${formatDate(state.day,{day:'2-digit',month:'long'})} às ${state.time}` : 'Escolha um dia e um horário disponível.';
}

function renderCalendar() {
  const first = dateObject(state.month + '-01');
  const year = first.getUTCFullYear(), month = first.getUTCMonth();
  $('#month-title').textContent = formatDate(state.month + '-01',{month:'long',year:'numeric'});
  $('#prev-month').disabled = state.month <= state.today.slice(0,7);
  $('#next-month').disabled = state.month >= dateKey(new Date(Date.UTC(dateObject(state.today).getUTCFullYear(),dateObject(state.today).getUTCMonth()+6,1))).slice(0,7);
  const calendar = $('#calendar'); calendar.replaceChildren();
  for (const day of ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb']) calendar.append(element('span','weekday',day));
  for (let index = 0; index < first.getUTCDay(); index++) calendar.append(element('span'));
  const days = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  for (let number = 1; number <= days; number++) {
    const date = dateKey(new Date(Date.UTC(year,month,number)));
    const closed = [0,1].includes(dateObject(date).getUTCDay());
    const button = element('button',`date-btn${date === state.day ? ' selected' : ''}${date === state.today ? ' today' : ''}`,number);
    button.type = 'button'; button.disabled = closed || date < state.today;
    button.setAttribute('aria-pressed',String(date === state.day));
    button.setAttribute('aria-label',`${formatDate(date,{day:'numeric',month:'long',year:'numeric'})}${closed ? ', fechado' : date < state.today ? ', passado' : ''}`);
    if (date === state.today) button.setAttribute('aria-current','date');
    button.onclick = () => { state.day = date; state.time = null; renderCalendar(); updateSummary(); loadSlots(); status('#booking-status'); };
    calendar.append(button);
  }
}

async function loadSlots() {
  if (!state.day) return;
  const request = ++state.request;
  $('#day-title').textContent = formatDate(state.day,{weekday:'short',day:'numeric',month:'long'});
  $('#day-summary').textContent = 'Carregando…'; $('#slots').replaceChildren(); $('#slots').setAttribute('aria-busy','true');
  try {
    const payload = await api(`/api/availability?date=${state.day}`);
    if (request !== state.request) return;
    state.today = payload.today;
    if (state.time && !payload.slots.some(slot => slot.time === state.time && slot.available)) state.time = null;
    const count = payload.slots.filter(slot => slot.available).length;
    $('#day-summary').textContent = `${count} ${count === 1 ? 'horário livre' : 'horários livres'}`;
    for (const slot of payload.slots) {
      const button = element('button',`slot${state.time === slot.time ? ' chosen' : ''}`,slot.time);
      button.type = 'button'; button.disabled = !slot.available;
      button.setAttribute('aria-label',`${slot.time}, ${slot.available ? 'disponível' : 'indisponível'}`);
      button.setAttribute('aria-pressed',String(state.time === slot.time));
      button.onclick = () => { state.time = slot.time; document.querySelectorAll('.slot').forEach(node => { const selected = node === button; node.classList.toggle('chosen',selected); node.setAttribute('aria-pressed',String(selected)); }); updateSummary(); status('#booking-status'); };
      $('#slots').append(button);
    }
    if (!count) $('#slots').append(element('p','', 'Nenhum horário livre neste dia. Escolha outra data.'));
    renderCalendar(); updateSummary();
  } catch (error) {
    if (request !== state.request) return;
    state.time = null; updateSummary(); $('#day-summary').textContent = 'Falha ao carregar';
    $('#slots').append(element('p','',error.message));
    const retry = element('button','slot','Tentar novamente'); retry.type = 'button'; retry.onclick = loadSlots; $('#slots').append(retry);
  } finally { if (request === state.request) $('#slots').setAttribute('aria-busy','false'); }
}

function changeMonth(offset) {
  const date = dateObject(state.month + '-01');
  state.month = dateKey(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+offset,1))).slice(0,7);
  renderCalendar();
}

const summary = booking => `Código: ${booking.code}\nCliente: ${booking.name}\nServiço: ${booking.service}\nValor de exemplo: ${money(booking.price)}\nData: ${formatDate(booking.date,{day:'2-digit',month:'2-digit',year:'numeric'})} às ${booking.time}\n\nBarbearia Nelson Cabeleireiro · Reserva de teste`;

$('#prev-month').onclick = () => changeMonth(-1);
$('#next-month').onclick = () => changeMonth(1);
$('#year').textContent = new Date().getFullYear();
$('#menu-toggle').onclick = () => {
  const open = $('#navigation').classList.toggle('open');
  $('#menu-toggle').setAttribute('aria-expanded',String(open));
  $('#menu-toggle').setAttribute('aria-label',open ? 'Fechar menu' : 'Abrir menu');
};
$('#navigation').addEventListener('click',event => { if (event.target.closest('a')) { $('#navigation').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded','false'); $('#menu-toggle').setAttribute('aria-label','Abrir menu'); } });
$('#phone').addEventListener('input',event => {
  const digits = event.target.value.replace(/\D/g,'').slice(0,11);
  event.target.setCustomValidity('');
  event.target.value = digits.length <= 2 ? digits : `(${digits.slice(0,2)}) ${digits.slice(2, digits.length > 10 ? 7 : 6)}${digits.length > 6 ? '-' + digits.slice(digits.length > 10 ? 7 : 6) : ''}`;
});
$('#booking').onsubmit = async event => {
  event.preventDefault();
  if (!state.service || !state.time) { status('#booking-status','Escolha um serviço, um dia e um horário disponível.',true); $('#agenda').scrollIntoView({behavior:'smooth'}); return; }
  const phone = $('#phone').value.replace(/\D/g,'');
  if (!/^\d{10,11}$/.test(phone)) { $('#phone').setCustomValidity('Informe um telefone com DDD e 10 ou 11 dígitos.'); $('#phone').reportValidity(); return; }
  const button = $('#book-button'); button.disabled = true; button.textContent = 'Reservando…'; status('#booking-status');
  try {
    const booking = await api('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#name').value.trim(),phone,service:state.service.name,date:state.day,time:state.time})});
    $('#message').textContent = summary(booking); $('#code').value = booking.code; status('#status'); $('#preview').showModal();
    status('#booking-status','Reserva de teste criada. Guarde seu código.');
    state.time = null; updateSummary(); await loadSlots();
  } catch (error) { status('#booking-status',error.message,true); await loadSlots(); }
  finally { button.disabled = false; button.textContent = 'Confirmar agendamento ↗'; }
};
$('#close').onclick = () => $('#preview').close();
$('#copy').onclick = async () => { try { await navigator.clipboard.writeText($('#message').textContent); status('#status','Confirmação copiada.'); } catch { status('#status','Selecione e copie o texto da confirmação.'); } };
$('#lookup').onsubmit = async event => {
  event.preventDefault(); state.found = null; $('#cancel-booking').hidden = true; $('#reservation-detail').hidden = true;
  const button = event.target.querySelector('[type="submit"]'); button.disabled = true; status('#lookup-status','Consultando…');
  try { const booking = await api(`/api/bookings/${encodeURIComponent($('#code').value.trim())}`); state.found = booking.code; $('#reservation-detail').textContent = summary(booking); $('#reservation-detail').hidden = false; $('#cancel-booking').hidden = false; status('#lookup-status','Reserva encontrada.'); }
  catch (error) { status('#lookup-status',error.message,true); }
  finally { button.disabled = false; }
};
$('#cancel-booking').onclick = () => { if (state.found) { status('#cancel-status'); $('#cancel-dialog').showModal(); } };
$('#keep-booking').onclick = () => $('#cancel-dialog').close();
$('#confirm-cancel').onclick = async () => {
  if (!state.found) return;
  $('#confirm-cancel').disabled = true;
  try { await api(`/api/bookings/${state.found}`,{method:'DELETE'}); state.found = null; $('#reservation-detail').hidden = true; $('#cancel-booking').hidden = true; status('#lookup-status','Reserva cancelada.'); $('#cancel-dialog').close(); await loadSlots(); }
  catch (error) { status('#cancel-status',error.message,true); }
  finally { $('#confirm-cancel').disabled = false; }
};
window.addEventListener('focus',() => loadSlots());

async function initialize() {
  try {
    const config = await api('/api/config');
    state.services = config.services; state.today = config.today; state.day = config.today;
    while ([0,1].includes(dateObject(state.day).getUTCDay())) { const date = dateObject(state.day); date.setUTCDate(date.getUTCDate()+1); state.day = dateKey(date); }
    state.month = state.day.slice(0,7); renderServices(); renderCalendar(); await loadSlots();
  } catch (error) {
    $('#services').replaceChildren(element('p','', 'Não foi possível carregar. Execute npm start e abra http://localhost:3000.'));
    status('#booking-status',error.message,true);
    const retry = element('button','button','Tentar novamente'); retry.onclick = initialize; $('#services').append(retry);
  }
}
initialize();
