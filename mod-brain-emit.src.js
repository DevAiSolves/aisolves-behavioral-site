/* ==========================================================================
   mod-brain-emit — el cerebro emite. Flujo de metadata en vivo + panel de
   lectura que sale del propio cerebro cuando se pide "ver el formato".
   Todo lo que muestra sale de AIS.state: si no hay dato, pone "—".
   ========================================================================== */
(function(){
  var cell = document.querySelector('.car-cell.brain');
  if(!cell) return;
  var stream = cell.querySelector('.brain-stream');
  var emit   = cell.querySelector('.brain-emit');
  if(!emit) return;
  var body   = emit.querySelector('.be-body');
  var fmtEl  = emit.querySelector('.be-fmt');
  var openBt = emit.querySelector('.be-open');
  var closeBt= emit.querySelector('.be-x');

  function A(){ return window.AIS && window.AIS.state ? window.AIS : null; }
  function n1(v){ return (Math.round(v*10)/10).toFixed(1); }
  function dash(v){ return (v===0||v) ? v : '—'; }

  /* ---------- flujo de metadata: el cerebro "leyendo" el comportamiento ---------- */
  var lastEventCount = 0, lastLine = '', LINES = 5;
  function push(txt, kind){
    if(!stream || txt===lastLine) return;
    lastLine = txt;
    var d = document.createElement('div');
    d.className = 'bs-line' + (kind ? ' ' + kind : '');
    d.textContent = txt;
    stream.appendChild(d);
    while(stream.children.length > LINES) stream.removeChild(stream.firstChild);
  }
  function tickStream(){
    var a = A(); if(!a) return;
    var s = a.state;
    // 1) eventos nuevos del core (entrada en etapa, lectura, señales)
    if(s.events && s.events.length > lastEventCount){
      var fresh = s.events.slice(lastEventCount);
      lastEventCount = s.events.length;
      var e = fresh[fresh.length-1];
      if(e) push('→ ' + (e.type||'evento') + ' · ' + (e.label||'') + (e.stage? ' · '+e.stage : ''), 'hit');
      return;
    }
    // 2) telemetría continua
    push(n1(s.seconds) + 's   scroll ' + s.scroll.current + '%   vel ' + Math.abs(s.scroll.velocity) +
         'px/s   cursor ' + s.cursor.speed + 'px/s   ' + (s.current || '—'));
  }

  /* ---------- panel de lectura: sale del cerebro ---------- */
  var C = 226.2;                                  // 2πr con r=36
  function readout(fmt){
    var a = A(); if(!a) return '<div class="be-wait">esperando al core…</div>';
    var s = a.state, sc = s.score || {total:0,band:'—'};
    var reads = 0, st = s.stages || [];
    for(var i=0;i<st.length;i++) reads += (st[i].reads ? st[i].reads.length : 0);
    var vis = st.filter(function(x){ return x.status==='visited'; }).length;
    var at = s.attribution || {};
    var origen = at.platform==='direct' ? 'directo'
               : [at.platform, at.campaign, at.adName].filter(Boolean).join(' · ');
    return ''+
    '<div class="be-top">'+
      '<div class="be-ring">'+
        '<svg width="86" height="86" viewBox="0 0 86 86">'+
          '<circle cx="43" cy="43" r="36" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="6"/>'+
          '<circle cx="43" cy="43" r="36" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"'+
          ' stroke-dasharray="'+C+'" stroke-dashoffset="'+(C - C*(sc.total/100))+'" transform="rotate(-90 43 43)"/>'+
        '</svg>'+
        '<b>'+dash(sc.total)+'<small>/100</small></b>'+
      '</div>'+
      '<div class="be-band">'+
        '<div class="be-k">banda</div><div class="be-v">'+dash(sc.band)+'</div>'+
        '<div class="be-k" style="margin-top:8px">etapa</div><div class="be-v">'+dash(s.current)+'</div>'+
      '</div>'+
    '</div>'+
    '<div class="be-grid">'+
      '<div><i>scroll</i><b>'+s.scroll.current+'%</b></div>'+
      '<div><i>profundidad</i><b>'+s.scroll.depth+'%</b></div>'+
      '<div><i>etapas vistas</i><b>'+vis+'/'+st.length+'</b></div>'+
      '<div><i>lecturas</i><b>'+reads+'</b></div>'+
      '<div><i>confianza</i><b>'+n1(s.trustSeconds)+'s</b></div>'+
      '<div><i>señales</i><b>'+s.signals+'</b></div>'+
    '</div>'+
    '<div class="be-meta"><span>origen</span> '+(origen||'directo')+'</div>'+
    '<div class="be-meta"><span>metadata</span> '+(s.events?s.events.length:0)+' eventos analizados · IP se resuelve en servidor</div>'+
    (fmt ? '<div class="be-fmtline"><span>formato</span> '+fmt.name+' — '+fmt.desc+'</div>' : '');
  }

  var openFmt = null, live = 0;
  function show(fmt){
    openFmt = fmt;
    if(fmtEl) fmtEl.textContent = fmt ? fmt.name.toUpperCase() : 'LEAD SIGNAL';
    body.innerHTML = readout(fmt);
    emit.hidden = false;
    // dejamos un frame para que la transición de entrada se vea
    requestAnimationFrame(function(){ cell.classList.add('is-emitting'); });
    if(window.BRAIN && window.BRAIN.surge) window.BRAIN.surge(1600);   // descarga de neuronas
    push('→ transmitiendo lectura · ' + (fmt ? fmt.name : 'lead signal'), 'hit');
    clearInterval(live);
    live = setInterval(function(){ if(!emit.hidden) body.innerHTML = readout(openFmt); }, 1000);
  }
  function hide(){
    cell.classList.remove('is-emitting');
    clearInterval(live); live = 0;
    setTimeout(function(){ emit.hidden = true; }, 380);
  }
  if(closeBt) closeBt.addEventListener('click', hide);
  if(openBt)  openBt.addEventListener('click', function(){
    if(openFmt && openFmt.id && typeof window.openVariant === 'function') window.openVariant(openFmt.id);
  });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !emit.hidden) hide(); });

  // el carrusel pide "ver este formato en vivo" → lo emite el cerebro
  window.brainEmit = function(id, name, desc){ show({id:id, name:name||'lead signal', desc:desc||''}); };

  setInterval(tickStream, 1100);
  tickStream();
})();
