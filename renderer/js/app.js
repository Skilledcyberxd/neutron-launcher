/**
 * Neutron Launcher — Glassmorphism UI Controller
 * All window.neutron.* IPC calls preserved exactly — only UI updated.
 */
'use strict';

const state = { currentPage:'home', config:{}, accounts:[], currentAccount:null, installedVersions:[], gameLogs:[], isGameRunning:false };
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Helpers ────────────────────────────────────────────────────────────────
function toast(msg, type='info', dur=3500) {
  const c=$('toast-container'), el=document.createElement('div');
  el.className=`toast ${type}`;
  const ico={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  el.innerHTML=`<span style="font-size:14px;opacity:.8">${ico[type]||'ℹ'}</span><span>${msg}</span>`;
  c.appendChild(el);
  setTimeout(()=>{ el.classList.add('hiding'); setTimeout(()=>el.remove(),220); },dur);
}
function showOverlay(s){ $('download-overlay').style.display=s?'flex':'none'; }
function updateDownloadProgress(p){
  const s=$('dl-stage'); if(s) s.textContent=p.label||p.stage||'…';
  const f=$('dl-progress-fill'); if(f) f.style.width=(p.percent||0)+'%';
  const pc=$('dl-percent'); if(pc) pc.textContent=(p.percent||0)+'%';
  const sp=$('dl-speed'); if(sp&&p.speed) sp.textContent=p.speed+' KB/s';
  const lb=$('dl-label'); if(lb&&p.completed!=null) lb.textContent=`${p.completed} / ${p.total} files`;
}
function fmt(b){ return b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB'; }
function _color(n){ const cs=['#4DC8F0','#a78bfa','#f472b6','#fb923c','#4ade80','#facc15','#60a5fa','#34d399']; let h=0; for(let i=0;i<n.length;i++) h=n.charCodeAt(i)+((h<<5)-h); return cs[Math.abs(h)%cs.length]; }

// ── Titlebar ───────────────────────────────────────────────────────────────
$('btn-minimize').addEventListener('click',()=>window.neutron.window.minimize());
$('btn-maximize').addEventListener('click',()=>window.neutron.window.maximize());
$('btn-close').addEventListener('click',   ()=>window.neutron.window.close());

// ── Sidebar collapse ───────────────────────────────────────────────────────
const sidebar = $('sidebar');
$('sidebar-toggle').addEventListener('click',()=>{
  sidebar.classList.toggle('collapsed');
});

// ── Sidebar section collapse ───────────────────────────────────────────────
$$('.nav-section-header').forEach(hdr=>{
  hdr.addEventListener('click',()=>{
    const id   = hdr.dataset.section;
    const body = $('section-'+id);
    const arr  = hdr.querySelector('.nav-section-arrow');
    if(!body) return;
    body.classList.toggle('closed');
    arr && arr.classList.toggle('open');
  });
});

// ── Navigation ─────────────────────────────────────────────────────────────
function navigate(page){
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  state.currentPage=page;
  const c=$('page-container'), tpl=document.getElementById(`tpl-${page}`);
  if(!tpl) return;
  c.innerHTML='';
  c.appendChild(tpl.content.cloneNode(true));
  ({home:initHome,play:initPlay,installations:initInstallations,mods:initMods,settings:initSettings,accounts:initAccounts,logs:initLogs})[page]?.();
}
$$('.nav-item').forEach(el=>el.addEventListener('click',()=>navigate(el.dataset.page)));

// ── System info ────────────────────────────────────────────────────────────
async function updateSysInfo(){
  try{
    const i=await window.neutron.system.getRamUsage();
    const bar=$('ram-bar'),txt=$('ram-text');
    if(bar){bar.style.width=i.percent+'%'; bar.style.background=i.percent>80?'#ef4444':'var(--accent)';}
    if(txt) txt.textContent=(i.used/1073741824).toFixed(1)+'/'+(i.total/1073741824).toFixed(1)+'G';
  }catch{}
}
setInterval(updateSysInfo,4000); updateSysInfo();

// ── Sidebar account ─────────────────────────────────────────────────────────
async function refreshSidebarAccount(){
  const acc=await window.neutron.auth.getCurrentAccount();
  state.currentAccount=acc;
  const ne=$('player-name'),te=$('player-type'),im=$('player-avatar'),ph=$('avatar-placeholder');
  if(acc){
    if(ne) ne.textContent=acc.username;
    if(te) te.textContent=acc.type==='microsoft'?'Microsoft':'Offline';
    if(acc.type==='microsoft'&&im){
      if(ph) ph.style.display='none'; im.style.display='block';
      im.src=`https://crafatar.com/avatars/${acc.uuid}?size=38&overlay`;
      im.onerror=()=>{ im.style.display='none'; if(ph){ph.style.display='flex';ph.textContent=acc.username.charAt(0).toUpperCase();ph.style.background=_color(acc.username);ph.style.color='#fff';} };
    } else {
      if(im) im.style.display='none';
      if(ph){ph.style.display='flex';ph.textContent=acc.username.charAt(0).toUpperCase();ph.style.background=_color(acc.username);ph.style.color='#fff';ph.style.fontWeight='700';}
    }
  } else {
    if(ne) ne.textContent='Not logged in'; if(te) te.textContent='—';
    if(im) im.style.display='none';
    if(ph){ph.style.display='flex';ph.textContent='?';ph.style.background='';ph.style.color='';}
  }
}

// ── HOME ───────────────────────────────────────────────────────────────────
function initHome(){
  $('btn-play-hero')?.addEventListener('click',()=>navigate('play'));
  $('btn-hero-install')?.addEventListener('click',()=>navigate('installations'));
  loadStats(); loadNews();
}
async function loadStats(){
  try{
    const [cfg,inst,acc]=await Promise.all([window.neutron.config.getAll(),window.neutron.fabric.getInstalledVersions(),window.neutron.auth.getCurrentAccount()]);
    const sv=$('stat-versions'),sa=$('stat-account'),sr=$('stat-ram'),sm=$('stat-mode'),sj=$('stat-java');
    if(sv) sv.textContent=inst.filter(v=>v.installed).length;
    if(sa) sa.textContent=acc?acc.username:'—';
    if(sr) sr.textContent=(cfg.allocatedRam||2)+' GB';
    if(sm) sm.textContent=({'lowend':'Low-End','standard':'Standard','performance':'Perf','extreme':'Extreme'})[cfg.optimizationMode||'performance']||'Perf';
    if(sj) sj.textContent=(!cfg.javaPath||cfg.javaPath==='auto'||cfg.javaPath==='java')?'Bundled':'Custom';
  }catch{}
}
function loadNews(){
  const g=$('news-grid'); if(!g) return;
  const NEWS=[
    {tag:'LATEST',title:'Minecraft Java 1.21.11',date:'Mar 2025',desc:'Critical hotfix — fixes server crashes, painting variant bugs, and chunk loading issues.',color:'#4DC8F0'},
    {tag:'UPDATE',title:'1.21.5 — Spring to Life',date:'Mar 25 2025',desc:'New plant blocks, revamped mob drops, item bundle improvements.',color:'#4ade80'},
    {tag:'FABRIC',title:'Fabric Loader 0.18.4',date:'Mar 2025',desc:'Full support for 1.21.5 and 1.21.11 with faster startup.',color:'#a78bfa'},
    {tag:'NEUTRON',title:'Welcome to Neutron v1.0',date:'Today',desc:'Bundled Java 21, Fabric mods, Microsoft & offline accounts.',color:'#4DC8F0'},
  ];
  g.innerHTML='';
  NEWS.forEach(n=>{
    const card=document.createElement('div');
    card.className='news-card';
    card.style.setProperty('--card-accent',n.color);
    card.innerHTML=`<div class="news-tag" style="color:${n.color};border-color:${n.color}35;background:${n.color}12">${n.tag}</div><div class="news-card-title">${n.title}</div><div class="news-card-desc">${n.desc}</div><div class="news-card-date">${n.date}</div>`;
    g.appendChild(card);
  });
}

// ── PLAY ───────────────────────────────────────────────────────────────────
async function initPlay(){
  const vsel=$('version-select'),btn=$('btn-launch'),ltxt=$('launch-text'),lst=$('launch-status'),orb=$('play-orb-outer');
  const cfg=await window.neutron.config.getAll(); state.config=cfg;
  const inst=await window.neutron.fabric.getInstalledVersions(); state.installedVersions=inst;
  if(vsel){
    vsel.innerHTML='';
    const rdy=inst.filter(v=>v.installed);
    if(!rdy.length){vsel.innerHTML='<option value="">No versions — go to Installations</option>';}
    else{
      const van=rdy.filter(v=>v.type==='vanilla'),fab=rdy.filter(v=>v.type==='fabric');
      if(van.length){const g=document.createElement('optgroup');g.label='✦ Vanilla';van.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.displayName||v.id;if(v.id===cfg.selectedVersion)o.selected=true;g.appendChild(o);});vsel.appendChild(g);}
      if(fab.length){const g=document.createElement('optgroup');g.label='⬡ Fabric';fab.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.displayName||v.id;if(v.id===cfg.selectedVersion)o.selected=true;g.appendChild(o);});vsel.appendChild(g);}
    }
  }
  // Optimization mode grid
  const modeGrid=document.getElementById('opt-mode-grid');
  let currentMode=cfg.optimizationMode||'performance';
  if(modeGrid){
    modeGrid.querySelectorAll('.opt-mode-btn').forEach(btn=>{
      btn.classList.toggle('active',btn.dataset.mode===currentMode);
      btn.addEventListener('click',()=>{
        currentMode=btn.dataset.mode;
        modeGrid.querySelectorAll('.opt-mode-btn').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        window.neutron.config.set('optimizationMode',currentMode);
        const piMode=$('pi-mode');
        if(piMode) piMode.textContent=({'lowend':'Low-End','standard':'Standard','performance':'Performance','extreme':'Extreme'})[currentMode]||currentMode;
      });
    });
  }
  const of=$('opt-fullscreen'),om=$('opt-minimize');
  if(of) of.checked=cfg.fullscreen; if(om) om.checked=cfg.minimizeOnLaunch;
  const acc=state.currentAccount||await window.neutron.auth.getCurrentAccount();
  const pa=$('pi-account'),pr=$('pi-ram'),pj=$('pi-java'),pd=$('pi-dir');
  if(pa) pa.textContent=acc?acc.username:'Not logged in';
  if(pr) pr.textContent=cfg.allocatedRam+' GB';
  const piMode=$('pi-mode');
  if(piMode) piMode.textContent=({'lowend':'Low-End','standard':'Standard','performance':'Performance','extreme':'Extreme'})[cfg.optimizationMode||'performance']||'Performance';
  if(pj) pj.textContent=(!cfg.javaPath||cfg.javaPath==='auto'||cfg.javaPath==='java')?'Bundled Java 21':cfg.javaPath;
  if(pd) pd.textContent=cfg.gameDir||'~/.neutron/minecraft';

  const running=await window.neutron.game.isRunning(); state.isGameRunning=running;
  function setUI(r){
    if(r){btn?.classList.add('running');orb?.classList.add('running');const ic=$('play-btn-icon');if(ic)ic.innerHTML='<rect x="5" y="3" width="4" height="18" fill="currentColor"/><rect x="15" y="3" width="4" height="18" fill="currentColor"/>';if(ltxt)ltxt.textContent='STOP';if(lst)lst.textContent='Game running…';}
    else{btn?.classList.remove('running');orb?.classList.remove('running');const ic=$('play-btn-icon');if(ic)ic.innerHTML='<polygon points="5,2 22,12 5,22" fill="currentColor"/>';if(ltxt)ltxt.textContent='PLAY';if(lst)lst.textContent='';}
  }
  setUI(running);
  btn?.addEventListener('click',async()=>{
    if(state.isGameRunning){await window.neutron.game.stop();state.isGameRunning=false;setUI(false);if(lst)lst.textContent='Game stopped.';return;}
    const a=await window.neutron.auth.getCurrentAccount();
    if(!a){toast('Add an account first','error');navigate('accounts');return;}
    const vid=vsel?.value;
    if(!vid){toast('Install a version first','error');navigate('installations');return;}
    btn.disabled=true; if(lst)lst.textContent='Launching…';
    const r=await window.neutron.game.launch({versionId:vid,ram:parseInt(await window.neutron.config.get('allocatedRam'))||2,javaPath:await window.neutron.config.get('javaPath')||'auto',jvmArgs:await window.neutron.config.get('jvmArgs')||'',optimizationMode:currentMode||'performance',fullscreen:of?.checked||false});
    btn.disabled=false;
    if(r.success){state.isGameRunning=true;setUI(true);toast('Minecraft launched!','success');if(om?.checked)window.neutron.window.minimize();}
    else{if(lst)lst.textContent='Error: '+r.error;toast('Launch failed: '+r.error,'error');}
  });
  vsel?.addEventListener('change',()=>window.neutron.config.set('selectedVersion',vsel.value));
}

// ── INSTALLATIONS ──────────────────────────────────────────────────────────
async function initInstallations(){
  const listEl=$('install-list'),modal=$('add-version-modal'),newSel=$('new-version-select');
  async function refresh(){
    const inst=await window.neutron.fabric.getInstalledVersions(); state.installedVersions=inst;
    if(!listEl) return;
    const rdy=inst.filter(v=>v.installed);
    if(!rdy.length){listEl.innerHTML='<div class="empty-state">No versions installed. Click "Add Version".</div>';return;}
    listEl.innerHTML='';
    [...rdy.filter(v=>v.type==='vanilla'),...rdy.filter(v=>v.type==='fabric')].forEach(v=>{
      const isV=v.type==='vanilla',bc=isV?'#60a5fa':'#4DC8F0',bb=isV?'rgba(96,165,250,.15)':'rgba(77,200,240,.15)';
      const row=document.createElement('div'); row.className='version-row';
      row.innerHTML=`<div class="ver-dot installed"></div><div class="ver-info"><div class="ver-name">${v.displayName||v.id}</div><div class="ver-meta"><span class="ver-type-badge" style="background:${bb};color:${bc}">${v.type}</span><span class="ver-meta-txt">✓ Installed</span></div></div><div class="ver-actions"><button class="btn-danger" data-action="del" data-id="${v.id}" style="padding:6px 12px;font-size:12px">Delete</button></div>`;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll('[data-action="del"]').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm(`Delete ${b.dataset.id}?`)) return;
      const r=await window.neutron.fabric.deleteVersion(b.dataset.id);
      if(r.success){toast('Deleted','success');refresh();}else toast('Failed: '+r.error,'error');
    }));
  }
  await refresh();
  $('btn-add-version')?.addEventListener('click',async()=>{
    if(newSel){newSel.innerHTML='<option>Loading…</option>';const r=await window.neutron.fabric.getVersions();newSel.innerHTML='';
      if(r.success&&r.data.length){
        const van=r.data.filter(v=>v.type==='vanilla'),fab=r.data.filter(v=>v.type==='fabric');
        if(van.length){const g=document.createElement('optgroup');g.label='✦ Vanilla';van.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.displayName||v.id;if(!v.available){o.disabled=true;o.textContent+=' (not released)';}g.appendChild(o);});newSel.appendChild(g);}
        if(fab.length){const g=document.createElement('optgroup');g.label='⬡ Fabric';fab.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.displayName||v.id;if(!v.available){o.disabled=true;o.textContent+=' (not released)';}g.appendChild(o);});newSel.appendChild(g);}
      } else newSel.innerHTML='<option>Failed to load</option>';
    }
    if(modal) modal.style.display='flex';
  });
  $('btn-add-cancel')?.addEventListener('click',()=>{if(modal)modal.style.display='none';});
  $('btn-add-confirm')?.addEventListener('click',async()=>{
    const vid=newSel?.value; if(!vid) return;
    if(modal) modal.style.display='none';
    showOverlay(true); if($('dl-stage')) $('dl-stage').textContent=`Installing ${vid}…`;
    const unsub=window.neutron.on('download:progress',p=>updateDownloadProgress(p));
    const r=await window.neutron.fabric.installVersion(vid);
    if(unsub) unsub(); showOverlay(false);
    if(r.success){toast(`${vid} installed!`,'success');refresh();}else toast('Failed: '+r.error,'error');
  });
}

// ── MODS ───────────────────────────────────────────────────────────────────
async function initMods(){
  const list=$('mods-list'), dz=$('mods-drop-zone');
  const noticeEl = $('mods-notice');

  // Auto-migrate old version subfolders silently
  try {
    const m = await window.neutron.mods.migrate();
    if (m.success && (m.moved > 0 || m.removed.length > 0)) {
      const msg = `Cleaned up: moved ${m.moved} mod(s) from old version subfolder${m.removed.length>1?'s':''} to mods/ — they will now load correctly.`;
      if (noticeEl) { noticeEl.textContent = msg; noticeEl.style.display = 'block'; }
      toast(msg, 'success', 6000);
    }
  } catch(e) { /* silent */ }

  async function refresh(){
    const mods = await window.neutron.mods.getList();
    if(!list) return;
    if(!mods.length){
      list.innerHTML='<div class="empty-state">No mods installed.<br>Drop .jar files in the area above or click Open Folder.</div>';
      return;
    }
    list.innerHTML='';
    mods.forEach(m=>{
      const row=document.createElement('div'); row.className='mod-row';
      row.innerHTML=`
        <label class="toggle">
          <input type="checkbox" class="mod-toggle" data-path="${m.path}" ${m.enabled?'checked':''}>
          <span class="slider"></span>
        </label>
        <span class="mod-name${m.enabled?'':' dim'}">${m.name}</span>
        <span class="mod-size">${fmt(m.size)}</span>
        <div style="display:flex;gap:6px">
          <button class="btn-danger" data-action="del" data-path="${m.path}" style="padding:5px 10px;font-size:12px">✕</button>
        </div>`;
      list.appendChild(row);
    });
    list.querySelectorAll('.mod-toggle').forEach(cb=>cb.addEventListener('change',async()=>{
      const r=await window.neutron.mods.toggle(cb.dataset.path,cb.checked);
      if(!r.success){toast('Failed to toggle mod','error');cb.checked=!cb.checked;}else refresh();
    }));
    list.querySelectorAll('[data-action="del"]').forEach(b=>b.addEventListener('click',async()=>{
      if(!confirm('Delete this mod?')) return;
      await window.neutron.mods.delete(b.dataset.path);
      toast('Mod deleted','success'); refresh();
    }));
  }

  await refresh();

  $('btn-open-mods-folder')?.addEventListener('click', () => window.neutron.mods.openFolder());

  if(dz){
    dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('drag-over');});
    dz.addEventListener('dragleave', ()=>dz.classList.remove('drag-over'));
    dz.addEventListener('drop', async e=>{
      e.preventDefault(); dz.classList.remove('drag-over');
      const files=Array.from(e.dataTransfer.files).filter(f=>f.name.endsWith('.jar'));
      if(!files.length){toast('Only .jar files supported','warning');return;}
      toast(`${files.length} mod(s) added. Open Folder to manage.`,'info');
      refresh();
    });
  }
}
// ── SETTINGS ───────────────────────────────────────────────────────────────
async function initSettings(){
  const cfg=await window.neutron.config.getAll(); state.config=cfg;
  const rs=$('ram-slider'),rv=$('ram-val');
  if(rs){rs.value=cfg.allocatedRam;if(rv)rv.textContent=cfg.allocatedRam;rs.addEventListener('input',()=>{if(rv)rv.textContent=rs.value;});}
  const ji=$('jvm-args'); if(ji) ji.value=cfg.jvmArgs||'';
  const gd=$('game-dir'); if(gd) gd.value=cfg.gameDir||'';
  $('btn-browse-dir')?.addEventListener('click',async()=>{const p=await window.neutron.dialog.selectGameDir();if(p&&gd)gd.value=p;});
  const ls=$('lang-select'); if(ls) ls.value=cfg.language||'en';
  const jp=$('java-path'); const dp=(!cfg.javaPath||cfg.javaPath==='java'||cfg.javaPath==='auto')?'':cfg.javaPath; if(jp) jp.value=dp;
  $('btn-browse-java')?.addEventListener('click',async()=>{const p=await window.neutron.dialog.selectJava();if(p&&jp)jp.value=p;});
  const au=$('opt-auto-update'),cl=$('opt-close-on-launch'),kl=$('opt-keep-logs');
  if(au) au.checked=cfg.autoUpdate; if(cl) cl.checked=cfg.closeOnLaunch; if(kl) kl.checked=cfg.keepLogs;
  // Theme grid (theme-btn)
  $$('.theme-btn').forEach(p=>{
    if(p.dataset.theme===cfg.theme) p.classList.add('active');
    p.addEventListener('click',()=>{$$('.theme-btn').forEach(x=>x.classList.remove('active'));p.classList.add('active');document.body.className='theme-'+p.dataset.theme;window.neutron.config.set('theme',p.dataset.theme);});
  });
  $$('.swatch').forEach(sw=>{
    if(sw.dataset.color===cfg.accentColor) sw.classList.add('active');
    sw.addEventListener('click',()=>{$$('.swatch').forEach(s=>s.classList.remove('active'));sw.classList.add('active');document.documentElement.style.setProperty('--accent',sw.dataset.color);window.neutron.config.set('accentColor',sw.dataset.color);});
  });
  async function refreshJava(){
    const ri=$('java-status-icon'),rt=$('java-status-title'),rs2=$('java-status-sub'),bdl=$('btn-download-java'),bre=$('btn-rebundle-java'),bde=$('btn-delete-java');
    const s=await window.neutron.java.getStatus();
    if(s.installed&&s.version){if(ri)ri.textContent='✅';if(rt)rt.textContent=`Java ${s.version} (bundled)`;if(rs2)rs2.textContent=`Ready · ${s.path||'bundled'}`;if(bdl)bdl.style.display='none';if(bre)bre.style.display='inline-flex';if(bde)bde.style.display='inline-flex';}
    else{if(ri)ri.textContent='⚠️';if(rt)rt.textContent='Java 21 not downloaded';if(rs2)rs2.textContent='Required to play Minecraft';if(bdl)bdl.style.display='inline-flex';if(bre)bre.style.display='none';if(bde)bde.style.display='none';}
  }
  await refreshJava();
  const doJava=async()=>{
    const bdl=$('btn-download-java'),bre=$('btn-rebundle-java');
    if(bdl){bdl.disabled=true;bdl.textContent='Downloading…';} if(bre) bre.disabled=true;
    toast('Downloading Java 21…','info',8000);
    const pr=$('java-dl-progress'); if(pr) pr.style.display='block';
    const r=await window.neutron.java.download();
    if(bdl){bdl.disabled=false;bdl.textContent='Download Java 21';} if(bre) bre.disabled=false;
    if(r.success){toast('Java 21 ready!','success');await refreshJava();}else{toast('Failed: '+r.error,'error');if(pr)pr.style.display='none';}
  };
  $('btn-download-java')?.addEventListener('click',doJava);
  $('btn-rebundle-java')?.addEventListener('click',doJava);
  $('btn-delete-java')?.addEventListener('click',async()=>{if(!confirm('Remove bundled Java?'))return;await window.neutron.java.delete();toast('Removed','info');await refreshJava();});
  $('btn-save-settings')?.addEventListener('click',async()=>{
    await window.neutron.config.set('allocatedRam',parseInt(rs?.value||2));
    await window.neutron.config.set('jvmArgs',ji?.value||'');
    await window.neutron.config.set('gameDir',gd?.value||'');
    await window.neutron.config.set('language',ls?.value||'en');
    await window.neutron.config.set('autoUpdate',au?.checked||false);
    await window.neutron.config.set('closeOnLaunch',cl?.checked||false);
    await window.neutron.config.set('keepLogs',kl?.checked!==false);
    await window.neutron.config.set('javaPath',(jp?.value||'').trim()||'auto');
    toast('Settings saved!','success');
  });
  $('btn-reset-settings')?.addEventListener('click',async()=>{if(!confirm('Reset all settings?'))return;await window.neutron.config.reset();toast('Reset','info');initSettings();});
  $('btn-check-update')?.addEventListener('click',async()=>{
    toast('Checking for updates…','info');
    const r=await window.neutron.update.check();
    if(r.available) showUpdateModal(r);
    else toast('You are up to date! (v'+(await window.neutron.update.getVersion())+')','success');
  });
}

// ── ACCOUNTS ───────────────────────────────────────────────────────────────
async function initAccounts(){
  const list=$('accounts-list');
  async function refresh(){
    const accs=await window.neutron.auth.getAccounts(); state.accounts=accs;
    if(!list) return;
    if(!accs.length){list.innerHTML='<div class="empty-state">No accounts yet.</div>';return;}
    list.innerHTML='';
    accs.forEach(acc=>{
      const card=document.createElement('div'); card.className=`account-card${acc.isCurrent?' active-account':''}`;
      const av=acc.type==='microsoft'?`<img src="https://crafatar.com/avatars/${acc.uuid}?size=44&overlay" onerror="this.style.display='none'" style="width:100%;height:100%;object-fit:cover" alt=""/>`:
        `<span style="color:#fff;font-weight:800;font-size:16px;background:${_color(acc.username)};width:100%;height:100%;display:flex;align-items:center;justify-content:center">${acc.username.charAt(0).toUpperCase()}</span>`;
      card.innerHTML=`<div class="ac-avatar">${av}</div><div class="ac-info"><div class="ac-name">${acc.username}</div><div class="ac-badges"><span class="ac-badge ${acc.type}">${acc.type==='microsoft'?'⊞ Microsoft':'⊡ Offline'}</span>${acc.isCurrent?'<span class="ac-badge active">Active</span>':''}</div></div><div class="ac-actions">${!acc.isCurrent?`<button class="btn-secondary" data-action="sw" data-uuid="${acc.uuid}" style="padding:6px 12px;font-size:12px">Use</button>`:''}<button class="btn-danger" data-action="rm" data-uuid="${acc.uuid}" style="padding:6px 12px;font-size:12px">Remove</button></div>`;
      list.appendChild(card);
    });
    list.querySelectorAll('[data-action="sw"]').forEach(b=>b.addEventListener('click',async()=>{await window.neutron.auth.switchAccount(b.dataset.uuid);toast('Account switched','success');await refreshSidebarAccount();refresh();}));
    list.querySelectorAll('[data-action="rm"]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Remove account?'))return;await window.neutron.auth.removeAccount(b.dataset.uuid);toast('Removed','info');await refreshSidebarAccount();refresh();}));
  }
  $('btn-ms-login')?.addEventListener('click',async()=>{
    const b=$('btn-ms-login'); b.disabled=true; b.textContent='Opening…';
    const r=await window.neutron.auth.loginMicrosoft();
    b.disabled=false; b.innerHTML='<svg viewBox="0 0 21 21" width="15"><path d="M1 1h9v9H1zM11 1h9v9h-9zM1 11h9v9H1zM11 11h9v9h-9z" fill="currentColor"/></svg> Sign in with Microsoft';
    if(r.success){toast(`Logged in as ${r.data.username}`,'success');await refreshSidebarAccount();refresh();}else toast('Login failed: '+r.error,'error');
  });
  $('btn-offline-login')?.addEventListener('click',async()=>{
    const un=$('offline-username')?.value?.trim(); if(!un){toast('Enter a username','warning');return;}
    const r=await window.neutron.auth.loginOffline(un);
    if(r.success){toast(`Added: ${un}`,'success');if($('offline-username'))$('offline-username').value='';await refreshSidebarAccount();refresh();}else toast('Error: '+r.error,'error');
  });
  $('offline-username')?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btn-offline-login')?.click();});
  await refresh();
}

// ── LOGS ───────────────────────────────────────────────────────────────────
function initLogs(){
  const v=$('log-viewer');
  function render(lines){
    if(!v) return;
    if(!lines.length){v.innerHTML='<div class="log-empty">No game log yet.</div>';return;}
    v.innerHTML='';
    lines.forEach(l=>{const el=document.createElement('div');el.className='log-line'+(l.includes('[ERR]')||l.toLowerCase().includes('error')?' err':'')+(l.toLowerCase().includes('warn')?' warn':'')+(l.toLowerCase().includes('[info]')?' info':'');el.textContent=l;v.appendChild(el);});
    v.scrollTop=v.scrollHeight;
  }
  render(state.gameLogs);
  $('btn-clear-logs')?.addEventListener('click',()=>{state.gameLogs=[];render([]);});
  $('btn-export-logs')?.addEventListener('click',async()=>{const r=await window.neutron.dialog.exportLogs();if(r?.success)toast('Exported to '+r.path,'success');else toast('Cancelled','info');});
  $('btn-launcher-logs')?.addEventListener('click',async()=>{const logs=await window.neutron.logs.getLauncherLogs();if(v){v.innerHTML='';(logs||'').split('\n').filter(l=>l.trim()).forEach(l=>{const el=document.createElement('div');el.className='log-line';el.textContent=l;v.appendChild(el);});v.scrollTop=v.scrollHeight;}toast('Launcher logs','info');});
}

// ── Game events ─────────────────────────────────────────────────────────────
window.neutron.on('java:progress',p=>{
  const f=document.getElementById('java-dl-fill'),lb=document.getElementById('java-dl-label');
  const pc=document.getElementById('java-dl-pct'),pr=document.getElementById('java-dl-progress');
  if(pr) pr.style.display='block'; if(f) f.style.width=(p.percent||0)+'%';
  if(lb) lb.textContent=p.label||'Downloading Java 21…'; if(pc) pc.textContent=(p.percent||0)+'%';
  if(p.stage==='java-done'&&pr) setTimeout(()=>{pr.style.display='none';},2000);
});
window.neutron.on('game:log',line=>{
  state.gameLogs.push(line); if(state.gameLogs.length>5000) state.gameLogs.shift();
  if(state.currentPage==='logs'){const v=$('log-viewer');if(v){const el=document.createElement('div');el.className='log-line';el.textContent=line;v.appendChild(el);v.scrollTop=v.scrollHeight;}}
});
window.neutron.on('game:exit',code=>{
  state.isGameRunning=false;
  const btn=$('btn-launch'),lt=$('launch-text'),ls=$('launch-status'),orb=$('play-orb-outer');
  if(btn){btn.classList.remove('running');btn.disabled=false;} if(orb) orb.classList.remove('running');
  const ic=$('play-btn-icon'); if(ic) ic.innerHTML='<polygon points="5,2 22,12 5,22" fill="currentColor"/>';
  if(lt) lt.textContent='PLAY';
  if(ls) ls.textContent=code===0?'Game closed normally.':`Game exited (code ${code})`;
  toast(`Game exited (code ${code})`,code===0?'info':'warning');
});
window.neutron.on('game:crash',code=>toast(`⚠ Minecraft crashed! (code ${code})`, 'error', 6000));
window.neutron.on('download:progress',p=>{if($('download-overlay')?.style.display!=='none')updateDownloadProgress(p);});


// ══════════════════════════════════════════════════════════
// UPDATE MODAL
// ══════════════════════════════════════════════════════════
function showUpdateModal(info) {
  const modal     = document.getElementById('update-modal');
  const title     = document.getElementById('upd-title');
  const subtitle  = document.getElementById('upd-subtitle');
  const badge     = document.getElementById('upd-badge');
  const clList    = document.getElementById('upd-changelog-list');
  const btnNow    = document.getElementById('btn-update-now');
  const btnSkip   = document.getElementById('btn-update-skip');
  const progWrap  = document.getElementById('upd-progress-wrap');
  const progBar   = document.getElementById('upd-prog-bar');
  const progLabel = document.getElementById('upd-prog-label');
  const progPct   = document.getElementById('upd-prog-pct');
  const errEl     = document.getElementById('upd-error');

  if (!modal) return;

  // Fill content
  if (info.required) {
    badge.innerHTML = '<span style="width:5px;height:5px;border-radius:50%;background:#ef4444;box-shadow:0 0 6px #ef4444;display:inline-block"></span> Update Required';
    badge.style.color      = '#ef4444';
    badge.style.background = 'rgba(239,68,68,.12)';
    badge.style.border     = '1px solid rgba(239,68,68,.25)';
    title.textContent      = 'Update Required';
    subtitle.textContent   = `Version ${info.version} is required to continue using Neutron Launcher.`;
    if (btnSkip) btnSkip.style.display = 'none';
  } else {
    title.textContent    = `Version ${info.version} Available`;
    subtitle.textContent = `You are on v${info.current}. Update to get the latest features and fixes.`;
  }

  // Changelog
  if (clList && info.changelog && info.changelog.length) {
    clList.innerHTML = info.changelog.map(line =>
      `<li style="font-size:13px;color:rgba(180,200,240,.8);display:flex;align-items:flex-start;gap:8px">
        <span style="color:#4DC8F0;margin-top:2px;flex-shrink:0">•</span>${line}
      </li>`
    ).join('');
  }

  modal.style.display = 'flex';
  errEl.style.display = 'none';

  // Skip — save skipped version so popup won't show again for this version
  btnSkip?.addEventListener('click', async () => {
    if (info.version) await window.neutron.update.skip(info.version);
    modal.style.display = 'none';
    toast('Update skipped. You can update anytime from Settings → Check for Updates.', 'info', 5000);
  });

  // Update Now
  btnNow?.addEventListener('click', async () => {
    btnNow.disabled   = true;
    btnNow.textContent = 'Preparing…';
    if (btnSkip) btnSkip.disabled = true;
    progWrap.style.display = 'block';
    errEl.style.display    = 'none';

    // Listen for progress
    const unsub = window.neutron.on('update:progress', (p) => {
      if (p.percent != null) {
        progBar.style.width  = p.percent + '%';
        progPct.textContent  = p.percent + '%';
      }
      if (p.status) {
        progLabel.textContent = p.status;
        btnNow.textContent    = p.status;
      }
    });

    const result = await window.neutron.update.download();
    if (unsub) unsub();

    if (!result.success) {
      errEl.textContent  = 'Update failed: ' + result.error;
      errEl.style.display = 'block';
      btnNow.disabled    = false;
      btnNow.textContent = 'Retry Update';
      if (btnSkip) btnSkip.disabled = false;
    }
    // On success, launcher restarts automatically
  });
}

// Listen for update:available event from main process
window.neutron.on('update:available', (info) => {
  showUpdateModal(info);
});


// ── Init ────────────────────────────────────────────────────────────────────
async function init(){
  const theme=await window.neutron.config.get('theme')||'dark';
  const accent=await window.neutron.config.get('accentColor');
  document.body.className=`theme-${theme}`;
  if(accent) document.documentElement.style.setProperty('--accent',accent);
  await refreshSidebarAccount();
  try{ const js=await window.neutron.java.getStatus(); if(!js.installed) setTimeout(()=>toast('⚠ Java 21 not found. Go to Settings → Bundled Java.','warning',8000),1500); }catch{}
  navigate('home');
}
init();
