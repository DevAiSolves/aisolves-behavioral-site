/* ==========================================================================
   mod-brain — cerebro de neuronas en 3D (sustituye a los engranajes)
   Blanco sobre negro, destellos eléctricos, 360° arrastrable.
   Las neuronas se encienden por zonas según el scroll, y cada zona
   corresponde a un servicio. Sin datos inventados: la zona activa se
   deriva del scroll real de la página.
   ========================================================================== */
(function(){
  var cell = document.querySelector('.car-cell.brain');
  var canvas = document.getElementById('brainCanvas');
  if(!cell || !canvas) return;

  var SERVICES = [
    { k:'META PIXEL + CAPI',      d:'Eventos por servidor, deduplicados con event_id.' },
    { k:'LEAD SCORING CONDUCTUAL',d:'Cada visita puntuada de 0 a 100 en cuatro ejes.' },
    { k:'SEO · SEM · AIO · GEO',  d:'Intención capturada en buscador y en respuesta generativa.' },
    { k:'WHATSAPP BUSINESS API',  d:'La conversación abierta en el minuto que importa.' },
    { k:'RETARGETING CONDUCTUAL', d:'Audiencias por comportamiento, no por demografía.' },
    { k:'CONTENIDO Y VIRALIDAD',  d:'Activos construidos sobre las objeciones reales.' }
  ];
  var N = SERVICES.length;

  var elName = cell.querySelector('.brain-name');
  var elDesc = cell.querySelector('.brain-desc');
  var elIdx  = cell.querySelector('.brain-idx');
  var elNote = cell.querySelector('.note');
  var elDots = cell.querySelector('.brain-dots');
  if(elDots) elDots.innerHTML = SERVICES.map(function(_,i){ return '<i data-i="'+i+'"></i>'; }).join('');

  /* ---------- forma del cerebro: nube de puntos procedural ---------- */
  // Ruido en direcciones diagonales: los senos alineados a los ejes producen
  // bultos simétricos en ±X/±Y/±Z y arruinan la silueta orgánica.
  function fold(x,y,z){
    var u = x*0.62 + y*0.48 + z*0.62,
        v = -x*0.55 + y*0.70 + z*0.45,
        w = x*0.45 - y*0.55 + z*0.70;
    return 0.038*Math.sin(u*9.5) + 0.030*Math.sin(v*12.0) + 0.022*Math.sin(w*15.5)
         + 0.014*Math.sin((u+v)*22.0);
  }

  function buildBrain(n){
    var pos = [], i;
    // hemisferios
    for(i=0;i<n;i++){
      var t = (i+0.5)/n;
      var y0 = 1 - t*2, r0 = Math.sqrt(Math.max(0,1-y0*y0)), th = i*2.399963229;
      var x = Math.cos(th)*r0, z = Math.sin(th)*r0, y = y0;
      // proporciones: más largo de delante a atrás, más estrecho de lado a lado
      x *= 0.86; y *= 0.60; z *= 1.00;
      // base aplanada y lóbulo frontal algo más bajo
      if(y < -0.18) y = -0.18 + (y+0.18)*0.55;
      z += 0.06*Math.sin(y*2.2);
      // circunvoluciones
      var f = fold(x,y,z), L = Math.sqrt(x*x+y*y+z*z) || 1;
      x += x/L*f; y += y/L*f; z += z/L*f;
      // fisura longitudinal: se separan los dos hemisferios
      var s = x >= 0 ? 1 : -1;
      x = s*(Math.abs(x)*0.90 + 0.052);
      pos.push(x,y,z);
    }
    // cerebelo: racimo inferior trasero, pliegues más finos
    var nc = Math.round(n*0.16);
    for(i=0;i<nc;i++){
      var t2=(i+0.5)/nc, y2=1-t2*2, r2=Math.sqrt(Math.max(0,1-y2*y2)), th2=i*2.399963229;
      var cx=Math.cos(th2)*r2*0.42, cy=y2*0.26, cz=Math.sin(th2)*r2*0.34;
      cy += -0.52; cz += -0.62;
      cx += 0.020*Math.sin(cy*46); cy += 0.016*Math.sin(cz*52);
      pos.push(cx,cy,cz);
    }
    // tronco encefálico
    var nb = Math.round(n*0.05);
    for(i=0;i<nb;i++){
      var a = Math.random()*Math.PI*2, rr = 0.085*Math.sqrt(Math.random()), hh = -0.30 - Math.random()*0.68;
      pos.push(Math.cos(a)*rr, hh, Math.sin(a)*rr - 0.14 + hh*0.10);
    }
    return new Float32Array(pos);
  }

  /* ---------- zonas: cada servicio ocupa una región del cerebro ---------- */
  var ANCHORS = [
    [ 0.62, 0.30, 0.72],   // frontal derecho
    [-0.62, 0.30, 0.72],   // frontal izquierdo
    [ 0.00, 0.88, 0.05],   // parietal superior
    [ 0.80,-0.18,-0.10],   // temporal derecho
    [-0.80,-0.18,-0.10],   // temporal izquierdo
    [ 0.00,-0.10,-0.95]    // occipital
  ];
  function zoneOf(x,y,z){
    var best=0, bd=Infinity;
    for(var i=0;i<ANCHORS.length;i++){
      var a=ANCHORS[i], dx=x-a[0], dy=y-a[1], dz=z-a[2], d=dx*dx+dy*dy+dz*dz;
      if(d<bd){bd=d;best=i;}
    }
    return best;
  }

  /* ---------- sin WebGL: degradado honesto en canvas 2D ---------- */
  function fallback2D(){
    var ctx = canvas.getContext('2d'); if(!ctx) return;
    var raw = buildBrain(2600), dpr = Math.min(devicePixelRatio||1, 2), t = 0, run = true, raf = 0;
    function size(){ var r=canvas.getBoundingClientRect(); canvas.width=r.width*dpr; canvas.height=r.height*dpr; ctx.setTransform(dpr,0,0,dpr,0,0); }
    function frame(){
      if(!run) return;
      var r=canvas.getBoundingClientRect(), w=r.width, h=r.height;
      t += 0.004;
      ctx.clearRect(0,0,w,h);
      var cx=w/2, cy=h/2, R=Math.min(w,h)*0.40, ca=Math.cos(t), sa=Math.sin(t), act=activeZone();
      for(var i=0;i<raw.length;i+=3){
        var x=raw[i], y=raw[i+1], z=raw[i+2];
        var X=x*ca - z*sa, Z=x*sa + z*ca;
        var on = zoneOf(x,y,z)===act;
        var depth=(Z+1)/2;
        ctx.fillStyle = on ? 'rgba(255,255,255,'+(0.45+depth*0.55).toFixed(2)+')'
                           : 'rgba(150,160,180,'+(0.06+depth*0.20).toFixed(2)+')';
        ctx.fillRect(cx+X*R, cy - y*R, 1, 1);
      }
      raf = requestAnimationFrame(frame);
    }
    size(); addEventListener('resize', size, {passive:true});
    new IntersectionObserver(function(es){ es.forEach(function(e){
      if(e.isIntersecting && !document.hidden){ if(!run){run=true;raf=requestAnimationFrame(frame);} }
      else { run=false; cancelAnimationFrame(raf); }
    }); },{threshold:0.05}).observe(canvas);
    document.addEventListener('visibilitychange',function(){ if(document.hidden){run=false;cancelAnimationFrame(raf);} else {run=true;raf=requestAnimationFrame(frame);} });
    raf = requestAnimationFrame(frame);
    if(elNote) elNote.textContent = 'canvas 2D · WebGL no disponible';
  }

  /* ---------- zona activa según el scroll real ---------- */
  var zoneF = 0;                                   // índice continuo, para mezclar
  var manualZone = -1, manualUntil = 0;            // selección por puntos, con caducidad
  // El progreso se mide sobre el paso de la PROPIA celda por el viewport, no
  // sobre el scroll global: el bucle se pausa cuando el cerebro no se ve, así
  // que ligarlo a la página entera dejaba la zona congelada.
  function scrollProgress(){
    var r = cell.getBoundingClientRect();
    var span = Math.max(1, innerHeight + r.height);
    return Math.min(1, Math.max(0, (innerHeight - r.top) / span));
  }
  function activeZone(){ return Math.min(N-1, Math.floor(zoneF+0.5)); }

  var lastZone = -1;
  function paintUI(z){
    if(z===lastZone) return; lastZone=z;
    var s = SERVICES[z];
    if(elName) elName.textContent = s.k;
    if(elDesc) elDesc.textContent = s.d;
    if(elIdx)  elIdx.textContent  = String(z+1).padStart(2,'0')+' / '+String(N).padStart(2,'0');
    if(elDots) [].forEach.call(elDots.children,function(d,i){ d.className = i===z ? 'on' : ''; });
  }

  // Three.js lo carga otro módulo de forma asíncrona: sin esperarlo, este
  // script arrancaría siempre en el respaldo 2D aunque WebGL esté disponible.
  (function waitTHREE(tries){
    if(typeof THREE !== 'undefined' && THREE.WebGLRenderer){ initGL(); return; }
    if(tries > 200){ fallback2D(); return; }            // ~10 s y nos rendimos
    setTimeout(function(){ waitTHREE(tries+1); }, 50);
  })(0);
  paintUI(0);

  /* ---------- WebGL ---------- */
  function initGL(){
  var raw = buildBrain(7200);
  var count = raw.length/3;
  var zones = new Uint8Array(count);
  for(var i=0;i<count;i++) zones[i] = zoneOf(raw[i*3], raw[i*3+1], raw[i*3+2]);

  var renderer, scene, camera, points, sparks, sparkGeo;
  try{
    renderer = new THREE.WebGLRenderer({canvas:canvas, alpha:true, antialias:false});
  }catch(e){ fallback2D(); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio||1, 2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.02, 2.70);

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(raw, 3));
  var cols = new Float32Array(count*3), sizes = new Float32Array(count);
  geo.setAttribute('color', new THREE.BufferAttribute(cols,3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes,1));

  // sprite radial: el punto brilla en el centro y se apaga en el borde
  function glowTex(){
    var c=document.createElement('canvas'); c.width=c.height=64;
    var g=c.getContext('2d'), rg=g.createRadialGradient(32,32,0,32,32,32);
    rg.addColorStop(0,'rgba(255,255,255,1)'); rg.addColorStop(0.35,'rgba(255,255,255,0.55)');
    rg.addColorStop(1,'rgba(255,255,255,0)');
    g.fillStyle=rg; g.fillRect(0,0,64,64);
    var t=new THREE.CanvasTexture(c); t.needsUpdate=true; return t;
  }
  var mat = new THREE.ShaderMaterial({
    uniforms:{ uTex:{value:glowTex()}, uScale:{value:7*Math.min(devicePixelRatio||1,2)} },
    vertexShader:[
      // ShaderMaterial no declara los uniforms por nosotros: hay que ponerlos aquí
      'uniform float uScale;',
      'attribute float aSize; varying vec3 vC; varying float vA;',
      'void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);',
      // sombreado por profundidad: d crece al alejarse de la cámara (≈2.2 cerca, ≈4.4 lejos)
      '  float d = -mv.z;',
      '  vA = mix(0.20, 1.0, 1.0 - smoothstep(1.7, 3.8, d));',
      '  gl_PointSize = aSize * (uScale / d);',
      '  gl_Position = projectionMatrix*mv; }'
    ].join('\n'),
    fragmentShader:[
      'uniform sampler2D uTex; varying vec3 vC; varying float vA;',
      'void main(){ vec4 t=texture2D(uTex, gl_PointCoord);',
      '  gl_FragColor = vec4(vC, t.a*vA); if(gl_FragColor.a<0.01) discard; }'
    ].join('\n'),
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, vertexColors:true
  });
  points = new THREE.Points(geo, mat);
  scene.add(points);

  // destellos eléctricos: segmentos entre neuronas cercanas de la zona activa
  var MAXS = 90;
  sparkGeo = new THREE.BufferGeometry();
  var sPos = new Float32Array(MAXS*6), sCol = new Float32Array(MAXS*6);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sPos,3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sCol,3));
  sparks = new THREE.LineSegments(sparkGeo, new THREE.LineBasicMaterial({
    transparent:true, opacity:0.85, blending:THREE.AdditiveBlending, depthWrite:false, vertexColors:true
  }));
  scene.add(sparks);

  var zoneIdx = [];                                  // índices de neurona por zona
  for(var z=0; z<N; z++) zoneIdx.push([]);
  for(i=0;i<count;i++) zoneIdx[zones[i]].push(i);

  var life = new Float32Array(MAXS), pair = new Int32Array(MAXS*2);
  function reseed(k, az){
    var list = zoneIdx[az]; if(!list || list.length<2) return;
    var a = list[(Math.random()*list.length)|0], b = -1, tries=0;
    var ax=raw[a*3], ay=raw[a*3+1], azz=raw[a*3+2];
    while(tries++<24){
      var c = list[(Math.random()*list.length)|0];
      if(c===a) continue;
      var dx=raw[c*3]-ax, dy=raw[c*3+1]-ay, dz=raw[c*3+2]-azz;
      if(dx*dx+dy*dy+dz*dz < 0.10){ b=c; break; }
    }
    if(b<0) return;
    pair[k*2]=a; pair[k*2+1]=b; life[k]=1;
  }

  var rotY = 0, rotX = 0.06, autoRot = true, dragging=false, lastX=0, lastY=0, velY=0;
  canvas.addEventListener('pointerdown',function(e){ dragging=true; autoRot=false; lastX=e.clientX; lastY=e.clientY; canvas.setPointerCapture&&canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove',function(e){ if(!dragging) return; var dx=e.clientX-lastX, dy=e.clientY-lastY; lastX=e.clientX; lastY=e.clientY; rotY+=dx*0.006; velY=dx*0.006; rotX=Math.max(-0.6,Math.min(0.6, rotX+dy*0.004)); });
  function endDrag(){ if(!dragging) return; dragging=false; setTimeout(function(){ autoRot=true; }, 1400); }
  canvas.addEventListener('pointerup',endDrag); canvas.addEventListener('pointercancel',endDrag); canvas.addEventListener('pointerleave',endDrag);

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var running=false, raf=0, t=0;

  function resize(){
    var r = canvas.getBoundingClientRect();
    if(!r.width || !r.height) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width/r.height; camera.updateProjectionMatrix();
  }

  function frame(){
    if(!running) return;
    t += 0.016;

    // zona activa desde el scroll real de la página
    var target;
    if(manualZone >= 0 && performance.now() < manualUntil) target = manualZone;
    else { manualZone = -1; target = scrollProgress()*(N-0.001); }
    zoneF += (target - zoneF)*0.10;
    var az = activeZone();
    paintUI(az);

    // color y tamaño por neurona: la zona activa se enciende, el resto queda tenue
    var col = geo.attributes.color.array, siz = geo.attributes.aSize.array;
    for(var i2=0;i2<count;i2++){
      var on = zones[i2]===az;
      var flick = on ? (0.72 + 0.28*Math.sin(t*7 + i2*0.35)) : 0;
      var base = on ? 1.0 : 0.21;
      var v = on ? 0.50 + 0.50*flick : base;
      col[i2*3]=v; col[i2*3+1]=v; col[i2*3+2]=v;
      siz[i2] = on ? 1.9 + 1.0*flick : 1.1;
    }
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;

    // destellos
    var sp = sparkGeo.attributes.position.array, sc = sparkGeo.attributes.color.array, live=0;
    for(var k=0;k<MAXS;k++){
      if(life[k] <= 0){ if(Math.random() < 0.30) reseed(k, az); }
      if(life[k] > 0){
        life[k] -= reduced ? 0.10 : 0.035;
        var a2=pair[k*2], b2=pair[k*2+1], o=Math.max(0, life[k]);
        sp[k*6]=raw[a2*3]; sp[k*6+1]=raw[a2*3+1]; sp[k*6+2]=raw[a2*3+2];
        sp[k*6+3]=raw[b2*3]; sp[k*6+4]=raw[b2*3+1]; sp[k*6+5]=raw[b2*3+2];
        sc[k*6]=sc[k*6+1]=sc[k*6+2]=o; sc[k*6+3]=sc[k*6+4]=sc[k*6+5]=o*0.35;
        live++;
      } else {
        sp[k*6]=sp[k*6+1]=sp[k*6+2]=sp[k*6+3]=sp[k*6+4]=sp[k*6+5]=0;
        sc[k*6]=sc[k*6+1]=sc[k*6+2]=sc[k*6+3]=sc[k*6+4]=sc[k*6+5]=0;
      }
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    if(autoRot && !reduced) rotY += 0.0028 + velY*0.15;
    velY *= 0.92;
    points.rotation.y = sparks.rotation.y = rotY;
    points.rotation.x = sparks.rotation.x = rotX;

    if(elNote) elNote.textContent = 'transform: rotateY(' + (((rotY*180/Math.PI)%360)|0) + 'deg) · neuronas activas ' + zoneIdx[az].length;

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function start(){ if(running) return; running=true; resize(); raf=requestAnimationFrame(frame); }
  function stop(){ running=false; cancelAnimationFrame(raf); }

  addEventListener('resize', function(){ if(running) resize(); }, {passive:true});
  document.addEventListener('visibilitychange', function(){ if(document.hidden) stop(); else if(visible) start(); });
  var visible=false;
  new IntersectionObserver(function(es){ es.forEach(function(e){
    visible = e.isIntersecting;
    if(visible && !document.hidden) start(); else stop();
  }); },{threshold:0.04}).observe(canvas);

  if(elDots) elDots.addEventListener('click', function(e){
    var i3 = e.target && e.target.getAttribute && e.target.getAttribute('data-i');
    if(i3==null) return;
    manualZone = Number(i3); manualUntil = performance.now() + 7000;   // luego vuelve a mandar el scroll
  });

  resize();
  }   /* fin initGL */
})();
