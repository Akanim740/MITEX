// api() and isLoggedIn() come from auth.js, which loads first. api() attaches
// the Bearer token and refreshes the session on 401 -- re-declaring it here
// would shadow that and send every request unauthenticated.
let currentUser = null;
let currentProject = null;
const PREFILL_KEY = "mitex_builder_prefill";

function restorePrefill() {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.title) document.getElementById("pTitle").value = d.title;
    if (d.kind) document.getElementById("pKind").value = d.kind;
    if (d.brief) document.getElementById("pBrief").value = d.brief;
    sessionStorage.removeItem(PREFILL_KEY);
  } catch {}
}

async function init() {
  restorePrefill();
  document.getElementById("promptPanel").style.display = "grid";
  currentUser = JSON.parse(localStorage.getItem("mitex_user") || "null");
  const loggedIn = Boolean(currentUser && isLoggedIn());
  document.getElementById("loginHint").style.display = loggedIn ? "none" : "block";
  document.getElementById("createBtn").addEventListener("click", createProject);
  document.getElementById("newBtn").addEventListener("click", () => {
    document.getElementById("promptPanel").style.display = "grid";
    document.getElementById("projectPanel").style.display = "none";
  });
  document.getElementById("backBtn").addEventListener("click", () => {
    loadProjects();
    document.getElementById("projectPanel").style.display = "none";
    document.getElementById("projectsPanel").style.display = "grid";
  });
  document.getElementById("buildBtn").addEventListener("click", buildProject);
  if (loggedIn) await loadProjects();
}

async function createProject() {
  const title = document.getElementById("pTitle").value.trim();
  const kind = document.getElementById("pKind").value;
  const brief = document.getElementById("pBrief").value.trim();
  if (!title) return alert("Enter a title");
  // Anyone can type a brief, but generating a site needs an account. Save the
  // brief and return here after sign-in instead of making them retype it.
  if (!currentUser || !isLoggedIn()) {
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ title, kind, brief }));
    } catch {}
    location.href = "/login.html?next=/ai-builder.html";
    return;
  }
  try {
    const res = await api("/api/ai/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, kind, brief }) });
    currentProject = res.project;
    document.getElementById("promptPanel").style.display = "none";
    showProject(currentProject);
  } catch (e) { alert(e.message); }
}
async function loadProjects() {
  const res = await api('/api/ai/projects');
  const list = document.getElementById('projectsList');
  list.innerHTML='';
  if (!res.projects.length) { list.innerHTML='<p class="muted">No projects yet.</p>'; document.getElementById('projectsPanel').style.display='grid'; return; }
  for (const p of res.projects) {
    const div=document.createElement('div'); div.className='file';
    div.innerHTML='<div style="display:flex;justify-content:space-between"><strong>'+escapeHtml(p.title)+'</strong><span class="badge">'+p.status+'</span></div><button class="btn secondary" data-id="'+p.id+'">Open</button>';
    div.querySelector('button').addEventListener('click', ()=>openProject(p.id));
    list.appendChild(div);
  }
  document.getElementById('projectsPanel').style.display='grid';
}
async function openProject(id){ const res=await api('/api/ai/projects/'+encodeURIComponent(id)); showProject(res.project,res.files); }
function showProject(p,files=[]){
  currentProject=p;
  document.getElementById('projectsPanel').style.display='none';
  document.getElementById('promptPanel').style.display='none';
  document.getElementById('projectPanel').style.display='grid';
  document.getElementById('projTitle').textContent=p.title;
  document.getElementById('projBrief').textContent=p.brief||'';
  document.getElementById('projStatus').textContent=p.status;
  document.getElementById('projModel').textContent=p.model||'—';
  document.getElementById('projTokens').textContent=(p.input_tokens||0)+'/'+(p.output_tokens||0);
  const actions=document.getElementById('actions'); actions.innerHTML='';
  const add=(l,fn)=>{const b=document.createElement('button');b.className='btn secondary';b.textContent=l;b.onclick=fn;actions.appendChild(b);};
  if(p.status==='rejected'||p.status==='failed') add('Retry', async()=>{await api('/api/ai/projects/'+p.id+'/retry',{method:'POST'});await openProject(p.id);});
  if(p.status==='approved') add('Request Payment', async()=>{const a=prompt('Amount (NGN)','5000'); if(!a)return; try{const r=await api('/api/ai/projects/'+p.id+'/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount:Number(a)})}); alert(r.order.reference); await openProject(p.id);}catch(e){alert(e.message);}});
  if(p.status==='released') add('Download ZIP', ()=>{window.location='/api/ai/projects/'+p.id+'/download';});
  const isStaff=(currentUser&&(currentUser.role==='admin'||currentUser.role==='editor'||currentUser.role==='staff'));
  if(isStaff){ if(p.status==='review'){ add('Approve',async()=>{await api('/api/ai/projects/'+p.id+'/approve',{method:'POST'});await openProject(p.id);}); add('Reject',async()=>{await api('/api/ai/projects/'+p.id+'/reject',{method:'POST'});await openProject(p.id);}); } if(p.status==='paid'){ add('Release Download',async()=>{await api('/api/ai/projects/'+p.id+'/release',{method:'POST'});await openProject(p.id);}); } }
  document.getElementById('buildPanel').style.display=(p.status==='draft'||p.status==='building'||p.status==='rejected'||p.status==='failed')?'grid':'none';
  document.getElementById('filesPanel').style.display=files.length?'grid':'none';
  const fl=document.getElementById('filesList'); fl.innerHTML='';
  for(const f of files){ const d=document.createElement('div'); d.className='file'; d.innerHTML='<strong>'+escapeHtml(f.path)+'</strong><span class="muted"> '+f.bytes+' bytes</span>'; fl.appendChild(d); }
  document.getElementById('notesPanel').style.display=(p.summary||p.notes)?'grid':'none';
  document.getElementById('sumText').textContent=p.summary||'';
  document.getElementById('notesText').textContent=p.notes||'';
}
async function buildProject(){
  if(!currentProject)return;
  const brief=document.getElementById('buildBrief').value.trim();
  const btn=document.getElementById('buildBtn');
  btn.disabled=true; btn.textContent='Building...';
  try{ await api('/api/ai/projects/'+currentProject.id+'/build',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({brief:brief||undefined})}); await openProject(currentProject.id); }catch(e){alert(e.message);} finally{btn.disabled=false;btn.textContent='Build with MITEX AI';}
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();