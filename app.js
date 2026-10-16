import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const $=id=>document.getElementById(id), db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const fields=[['ugel','UGEL'],['ie','Institución educativa'],['nivel','Nivel'],['area','Área'],['grado','Grado'],['seccion','Sección'],['fecha','Fecha de aplicación','date']];
const items=[...Array.from({length:23},(_,i)=>'C1-'+String(i+1).padStart(2,'0')),...Array.from({length:23},(_,i)=>'C2-'+String(i+1).padStart(2,'0'))];
let catalog=[],students=[],answers={},participation={},activeRecord=null,locked=false,loading=false,profile=null,currentUser=null;
const v=id=>$(id).value, setStatus=t=>{const el=$('status');if(el)el.textContent=t;};
const profileValue=k=>profile?.[k]||'';
for(const [id,label,type] of fields){let d=document.createElement('div'),l=document.createElement('label');l.textContent=label;l.htmlFor=id;let el=document.createElement(type?'input':'select');el.id=id;if(type)el.type=type;d.append(l,el);$('meta').append(d)}
$('fecha').value=new Date().toLocaleDateString('en-CA');
const ordenGrado = valor => {const t=String(valor).trim().toUpperCase();const orden={PRIMERO:1,'1':1,'1°':1,'1º':1,SEGUNDO:2,'2':2,'2°':2,'2º':2,TERCERO:3,'3':3,CUARTO:4,'4':4,'4°':4,'4º':4,QUINTO:5,'5':5,'5°':5,'5º':5,SEXTO:6,'6':6,'6°':6,'6º':6};return orden[t] ?? 999};
function options(id,values,keep=false){const el=$(id),old=keep?el.value:'';el.replaceChildren(new Option('Seleccione',''));[...new Set(values)].filter(Boolean).sort((a,b)=>id==='grado' ? ordenGrado(a)-ordenGrado(b) || a.localeCompare(b,'es') : a.localeCompare(b,'es',{numeric:true})).forEach(s=>el.add(new Option(s,s)));if(keep&&[...el.options].some(o=>o.value===old))el.value=old}
options('area',['Comunicación','Matemática']);
const group=['ugel','ie','nivel','grado','seccion'];
function subset(keys){return catalog.filter(s=>keys.every(k=>String(s[k])===v(k)))}
function cascade(key){const i=group.indexOf(key);for(let j=i+1;j<group.length;j++){const parent=group.slice(0,j);const values=parent.every(k=>v(k))?subset(parent).map(x=>x[group[j]]):[];options(group[j],values)}loadSection()}
for(const k of group)$(k).addEventListener('change',()=>cascade(k));
$('area').addEventListener('change',loadSection);
let requestSerial=0;
const head=document.createElement('tr');for(const title of ['N.º','Código de estudiante','Apellido paterno','Apellido materno','Nombres','¿Participó?',...items]){const th=document.createElement('th');th.textContent=title;head.append(th)}$('sheet').append(head);
function completion(){return students.filter(s=>participation[s.id]==='NO'||(participation[s.id]==='SI'&&items.every(it=>answers[s.id+'|'+it]))).length}
function count(){const total=students.length,done=completion();$('counter').textContent=`${total} estudiantes · ${done} completos`;$('answered').textContent=Object.values(answers).filter(Boolean).length+' respuestas ingresadas';$('send').disabled=locked||loading||!total||done!==total||!v('fecha')}
function draw(){const table=$('sheet');table.querySelectorAll('tr:not(:first-child)').forEach(x=>x.remove());const q=($('studentSearch')?.value||'').trim().toLocaleLowerCase('es');students.filter(s=>!q||[s.codigo_estudiante,s.apellido_paterno,s.apellido_materno,s.nombres].join(' ').toLocaleLowerCase('es').includes(q)).forEach(s=>{const tr=document.createElement('tr');tr.id='student-'+s.id;if(participation[s.id]==='NO')tr.classList.add('not-participating');const n=students.indexOf(s)+1;for(const val of [n,s.codigo_estudiante,s.apellido_paterno,s.apellido_materno,s.nombres]){const td=document.createElement('td');td.textContent=val??'';tr.append(td)}const tdPart=document.createElement('td'),part=document.createElement('select');part.className='participation';part.dataset.student=s.id;for(const [value,label] of [['','Seleccione'],['SI','Sí participó'],['NO','No participó']])part.add(new Option(label,value));part.value=participation[s.id]||'';part.disabled=locked;part.addEventListener('change',()=>{if(part.value==='NO'&&items.some(it=>answers[s.id+'|'+it])&&!confirm('Este estudiante tiene respuestas registradas. ¿Confirmar que NO participó? Se borrarán sus respuestas.')){part.value=participation[s.id]||'';return}participation[s.id]=part.value;if(part.value==='NO')for(const it of items)delete answers[s.id+'|'+it];hideObservations();draw()});tdPart.append(part);tr.append(tdPart);for(const item of items){const td=document.createElement('td'),sel=document.createElement('select'),key=s.id+'|'+item;sel.dataset.key=key;for(const opt of ['','A','B','C','D','99'])sel.add(new Option(opt||'–',opt));sel.value=participation[s.id]==='NO'?'':(answers[key]||'');sel.disabled=locked||participation[s.id]!=='SI';if(participation[s.id]==='NO'){sel.replaceChildren(new Option('–',''));sel.value=''}sel.addEventListener('change',()=>{answers[key]=sel.value;hideObservations();count()});td.append(sel);tr.append(td)}table.append(tr)});if($('save'))$('save').disabled=locked||loading;count()}
function showSectionState(state){const el=$('sectionState');if(!el)return;if(!state||state.estado==='LIBRE'){el.className='hide';el.textContent='';return}const sent=state.estado==='ENVIADO',occupied=state.estado==='OCUPADA';el.className=sent?'sent':'draft';const parts=[sent?'✓ SECCIÓN REGISTRADA · SOLO LECTURA':occupied?'🔒 SECCIÓN EN REGISTRO POR OTRO ESPECIALISTA':'BORRADOR RECUPERADO',state.registrador?'Registrado por: '+state.registrador:'',state.fecha_aplicacion?'Fecha de aplicación: '+state.fecha_aplicacion:'',sent?'Las respuestas están bloqueadas. Solicite reapertura para corregirlas.':occupied?'No puede editar ni enviar esta sección.':'Puede continuar y guardar los cambios.'];el.textContent=parts.filter(Boolean).join('  ·  ')}
function restoreRecord(state){activeRecord=state.id||null;if(state.fecha_aplicacion)$('fecha').value=state.fecha_aplicacion;for(const r of state.respuestas||[])answers[r.estudiante_id+'|'+r.item]=r.respuesta;for(const p of state.participacion||[])participation[p.estudiante_id]=p.participo?'SI':'NO'}
function hideObservations(){$('observations').classList.add('hide');$('observations').replaceChildren();document.querySelectorAll('.cell-error,.row-error').forEach(el=>el.classList.remove('cell-error','row-error'))}
function validateFinal(){hideObservations();const issues=[];for(const [id,label] of fields){if(!v(id))issues.push({message:'Complete '+label+'.',field:id})}if(!students.length)issues.push({message:'Seleccione una sección con estudiantes.'});for(const s of students){const name=[s.apellido_paterno,s.apellido_materno,s.nombres].filter(Boolean).join(' ');if(!participation[s.id])issues.push({message:`${name}: indique si participó.`,student:s.id});else if(participation[s.id]==='SI'){const missing=items.filter(it=>!answers[s.id+'|'+it]);if(missing.length)issues.push({message:`${name}: faltan ${missing.length} ítems (${missing.slice(0,5).join(', ')}${missing.length>5?', …':''}).`,student:s.id,item:missing[0]})}}if(issues.length){const panel=$('observations');panel.classList.remove('hide');const strong=document.createElement('strong');strong.textContent=`No se puede enviar: ${issues.length} observación(es).`;panel.append(strong);const ul=document.createElement('ul');for(const issue of issues.slice(0,50)){const li=document.createElement('li'),link=document.createElement('a');link.href='#';link.textContent=issue.message;link.onclick=e=>{e.preventDefault();if(issue.student){$('studentSearch').value='';draw();const tr=$('student-'+issue.student);tr?.classList.add('row-error');const el=issue.item?tr?.querySelector(`[data-key="${issue.student}|${issue.item}"]`):tr?.querySelector('[data-student]');el?.classList.add('cell-error');el?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});el?.focus()}else{$(issue.field)?.scrollIntoView({behavior:'smooth',block:'center'});$(issue.field)?.focus()}};li.append(link);ul.append(li)}panel.append(ul);panel.scrollIntoView({behavior:'smooth',block:'nearest'});setStatus('Corrija las observaciones marcadas antes de enviar.');return false}return true}
async function loadSection(){const serial=++requestSerial;students=[];answers={};participation={};activeRecord=null;locked=false;hideObservations();showSectionState(null);draw();if(!v('seccion')||!v('area')){setStatus('Seleccione área y sección.');return}const entry=subset(group)[0];if(!entry)return;setStatus('Verificando sección y cargando nómina...');
const [statusResult,studentResult]=await Promise.all([db.rpc('piloto_estado',{p_institucion_id:entry.id,p_area:v('area')}),db.from('estudiantes').select('id,codigo_estudiante,apellido_paterno,apellido_materno,nombres').eq('institucion_id',entry.id).order('apellido_paterno').order('apellido_materno')]);
if(serial!==requestSerial)return;
if(statusResult.error||studentResult.error){setStatus('No se pudo consultar Supabase: '+(statusResult.error||studentResult.error).message);return}
students=studentResult.data||[];const state=statusResult.data||{};
if(state.estado==='ENVIADO'){restoreRecord(state);locked=true;showSectionState(state);draw();setStatus('Sección registrada. Respuestas recuperadas para consulta; no se permite editar.');return}
if(state.estado==='OCUPADA'){locked=true;showSectionState(state);draw();setStatus('Esta sección y área tienen un borrador de otro especialista. No puede modificarla.');return}
if(state.estado==='EN REGISTRO'){restoreRecord(state);showSectionState(state);setStatus('Se recuperó su avance guardado. Puede continuar.');}
else{$('fecha').value=new Date().toLocaleDateString('en-CA');setStatus('Nómina cargada. Complete sus datos y registre las respuestas.');}
draw();}
function participationRows(){return students.filter(s=>participation[s.id]).map(s=>({estudiante_id:s.id,participo:participation[s.id]==='SI'}))}
function rows(){return students.flatMap(s=>items.map(item=>({estudiante_id:s.id,item,respuesta:answers[s.id+'|'+item]})).filter(x=>x.respuesta))}
function validate(){if(!students.length)throw Error('Seleccione una sección con estudiantes.');for(const k of ['ugel','ie','nivel','area','grado','seccion','fecha'])if(!v(k))throw Error('Complete '+k+'.');if(!profile?.nombre||!profile?.dni||!profile?.correo)throw Error('Primero complete su perfil de especialista.');}
async function persist(final){if(loading)return;try{validate();if(final&&!validateFinal())return;loading=true;if($('save'))$('save').disabled=true;if($('send'))$('send').disabled=true;setStatus('Guardando en Supabase...');const entry=subset(group)[0];const payload={p_id:activeRecord,p_institucion_id:entry.id,p_area:v('area'),p_registrador:profileValue('nombre'),p_correo:profileValue('correo'),p_celular:profileValue('celular'),p_cargo:profileValue('cargo'),p_fecha_aplicacion:v('fecha'),p_enviar:final,p_respuestas:rows(),p_participacion:participationRows()};const {data,error}=await db.rpc('guardar_piloto',payload);if(error)throw error;activeRecord=data;locked=final;showSectionState({estado:final?'ENVIADO':'EN REGISTRO',registrador:profileValue('nombre'),fecha_aplicacion:v('fecha')});draw();setStatus(final?'¡Registro enviado correctamente! ID: '+data+'. Para corregirlo, solicite una reapertura.':'Avance guardado correctamente en Supabase. ID: '+data);if(final){alert('¡Registro enviado correctamente! Se guardaron las respuestas y la sección quedó cerrada.');await refreshMine();}}catch(e){setStatus('No se guardó: '+e.message)}finally{loading=false;if(!locked)draw()}}
$('studentSearch')?.addEventListener('input',draw);
if($('save'))$('save').onclick=()=>persist(false);if($('send'))$('send').onclick=()=>{if(!validateFinal())return;if(confirm('¿Enviar registro definitivo? Todos los estudiantes están completos y después necesitará una reapertura para corregirlo.'))persist(true)};
if($('csv'))$('csv').onclick=()=>{if(!students.length)return alert('Seleccione una sección con estudiantes.');if(!window.XLSX)return alert('No se cargó el componente Excel. Revise su conexión a internet.');const data=students.map((s,i)=>{const row={'N.º':i+1,'Código de estudiante':String(s.codigo_estudiante||''),'Apellido paterno':s.apellido_paterno||'','Apellido materno':s.apellido_materno||'','Nombres':s.nombres||'','Participó':participation[s.id]==='SI'?'Sí':participation[s.id]==='NO'?'No':'Pendiente'};for(const it of items)row[it]=participation[s.id]==='NO'?'-':answers[s.id+'|'+it]||'-';return row});const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(data);sheet['!cols']=[{wch:6},{wch:23},{wch:22},{wch:22},{wch:28},{wch:15},...items.map(()=>({wch:9}))];XLSX.utils.book_append_sheet(book,sheet,'Respuestas');XLSX.writeFile(book,`Piloto_DRELM_${v('ugel')||'UGEL'}_${v('area')||'Area'}_${v('fecha')||'fecha'}.xlsx`)};
async function init(){
 const {data:{session}}=await db.auth.getSession();currentUser=session?.user||null;
 $('authPanel').classList.toggle('hide',!!session);$('sessionBar').classList.toggle('hide',!session);$('sessionEmail').textContent=session?.user?.email||'';
 if(!session){$('app').classList.add('hide');$('profilePanel').classList.add('hide');$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');return}
 const {data:pr,error:pe}=await db.from('piloto_especialistas').select('dni,nombre,correo,celular,cargo').eq('usuario_id',session.user.id).maybeSingle();
 if(pe){$('app').classList.add('hide');$('profilePanel').classList.add('hide');$('authStatus').textContent='Falta configurar la tabla de perfiles: '+pe.message;return}
 profile=pr;
 if(!profile&&getDraft()){
  try{await savePendingProfile();const result=await db.from('piloto_especialistas').select('dni,nombre,correo,celular,cargo').eq('usuario_id',session.user.id).maybeSingle();if(result.error)throw result.error;profile=result.data}
  catch(err){$('authStatus').textContent='No se pudo validar o guardar el perfil: '+err.message}
 }
 $('pCorreo').value=session.user.email||'';
 for(const [k,id] of [['dni','pDni'],['nombre','pNombre'],['celular','pCelular'],['cargo','pCargo']])$(id).value=profile?.[k]||'';
 $('profilePanel').classList.toggle('hide',!!profile);$('app').classList.toggle('hide',!profile);
 if(!profile){$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');return;}
 $('specialistBadge').textContent='Especialista: '+profile.nombre+' · DNI '+profile.dni;
 const {data,error}=await db.from('instituciones').select('id,ugel,cod_mod,nombre_ie,nivel,grado,seccion').order('ugel').limit(1000);
 if(error){$('app').classList.add('hide');$('authPanel').classList.remove('hide');$('sessionBar').classList.add('hide');$('authStatus').textContent='Acceso no habilitado: '+error.message;return}
 catalog=(data||[]).map(x=>({...x,ie:x.nombre_ie}));options('ugel',catalog.map(x=>x.ugel));setStatus('Seleccione UGEL e institución educativa.');await setupRoles();
}
if($('saveProfile'))$('saveProfile').onclick=async()=>{
 const dni=v('pDni').trim(),nombre=v('pNombre').trim(),celular=v('pCelular').trim(),cargo=v('pCargo').trim();
 if(!/^\d{8}$/.test(dni))return $('profileStatus').textContent='Ingrese un DNI de 8 dígitos.';
 if(nombre.length<5||!/^\d{9}$/.test(celular)||!cargo)return $('profileStatus').textContent='Complete nombres y apellidos, celular de 9 dígitos y cargo.';
 $('saveProfile').disabled=true;$('profileStatus').textContent='Guardando datos del especialista...';
 try{const {error}=await db.from('piloto_especialistas').upsert({usuario_id:currentUser.id,dni,nombre,correo:currentUser.email,celular,cargo},{onConflict:'usuario_id'});if(error)throw error;await init()}
 catch(e){$('profileStatus').textContent='No se guardó: '+e.message}finally{$('saveProfile').disabled=false}
};
if($('editProfile'))$('editProfile').onclick=()=>{$('app').classList.add('hide');$('profilePanel').classList.remove('hide')};
// El correo autorizado se verifica por la política/RPC de Supabase al autenticar.
const DRAFT_KEY='piloto_perfil_pendiente_v1';
function getDraft(){try{return JSON.parse(localStorage.getItem(DRAFT_KEY)||'null')}catch{return null}}
function applyDraft(){const p=getDraft();if(!p)return;for(const [k,id] of [['dni','aDni'],['nombre','aNombre'],['correo','loginEmail'],['celular','aCelular'],['cargo','aCargo']])if($(id))$(id).value=p[k]||''}
applyDraft();
async function savePendingProfile(){
 const p=getDraft();if(!p||!currentUser)return;
 if(p.correo.toLowerCase()!==String(currentUser.email||'').toLowerCase())return;
 const {error}=await db.from('piloto_especialistas').upsert({
  usuario_id:currentUser.id,dni:p.dni,nombre:p.nombre,correo:currentUser.email,celular:p.celular,cargo:p.cargo
 },{onConflict:'usuario_id'});
 if(error)throw error;
 localStorage.removeItem(DRAFT_KEY);
}
if($('loginForm'))$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const p={dni:v('aDni').trim(),nombre:v('aNombre').trim(),correo:v('loginEmail').trim().toLowerCase(),celular:v('aCelular').trim(),cargo:v('aCargo').trim()};
 if(!/^\\d{8}$/.test(p.dni)||p.nombre.length<5||!/^\\d{9}$/.test(p.celular)||!p.cargo)return $('authStatus').textContent='Complete DNI, nombre, celular y cargo correctamente.';
 const btn=$('loginButton');btn.disabled=true;$('authStatus').textContent='Enviando enlace de verificación...';
 try{
  localStorage.setItem(DRAFT_KEY,JSON.stringify(p));
  const {error}=await db.auth.signInWithOtp({email:p.correo,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:false}});
  if(error)throw error;
  $('authStatus').textContent='Revise su correo institucional y abra el enlace de acceso. No necesita contraseña ni código. Si no está autorizado, el sistema no mostrará la nómina.';
 }catch(err){$('authStatus').textContent='No se pudo validar el correo: '+err.message}
 finally{btn.disabled=false}
});
if($('logout'))$('logout').onclick=async()=>{await db.auth.signOut();location.reload()};
db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session){setTimeout(()=>init(),0)}else if(event==='SIGNED_OUT'){catalog=[];students=[];answers={};activeRecord=null;locked=false;$('app').classList.add('hide');$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');$('authPanel').classList.remove('hide');$('sessionBar').classList.add('hide')}});
init().catch(e=>{console.error('Error al iniciar:',e);if($('authStatus'))$('authStatus').textContent='No se pudo iniciar el aplicativo: '+e.message;});

// Administracion y solicitudes: las RPC comprueban los permisos en Supabase.
async function refreshMine(){
 const host=$('mySent');host.replaceChildren();
 const {data,error}=await db.rpc('piloto_mis_enviados');
 if(error){$('requestStatus').textContent='No se pudo consultar: '+error.message;return}
 if(!data?.length){host.textContent='Aún no tienes registros enviados.';return}
 for(const r of data){
  const line=document.createElement('div');line.style.cssText='border-bottom:1px solid #dce5ed;padding:10px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  const title=document.createElement('span');title.textContent=`${r.nombre_ie} · ${r.grado} ${r.seccion} · ${r.area} · ${new Date(r.fecha_envio).toLocaleDateString('es-PE')}`;
  const btn=document.createElement('button');btn.className='secondary';btn.textContent='Solicitar reapertura';
  btn.onclick=async()=>{
   const motivo=prompt('Explique el error que necesita corregir (mínimo 10 caracteres):');if(motivo===null)return;
   if(motivo.trim().length<10)return alert('El motivo debe tener al menos 10 caracteres.');
   btn.disabled=true;const {error}=await db.rpc('piloto_solicitar_reapertura',{p_registro_id:r.id,p_motivo:motivo.trim()});
   $('requestStatus').textContent=error?'No se pudo solicitar: '+error.message:'Solicitud enviada al administrador.';
   if(error)btn.disabled=false;
  };
  line.append(title,btn);host.append(line);
 }
}
if($('refreshMine'))$('refreshMine').onclick=refreshMine;
async function refreshAdmin(){
 const {data,error}=await db.rpc('piloto_admin_resumen');
 if(error){$('adminStatus').textContent='Error: '+error.message;return}
 $('adminStats').replaceChildren();
 for(const [key,label] of [['enviados','Enviados'],['borradores','Borradores'],['pendientes','Solicitudes pendientes']]){
  const span=document.createElement('span');span.textContent=`${label}: ${data[key]}`;$('adminStats').append(span);
 }
 const host=$('adminRequests');host.replaceChildren();
 if(!data.solicitudes?.length){host.textContent='No hay solicitudes pendientes.';return}
 for(const r of data.solicitudes){
  const line=document.createElement('div');line.style.cssText='border-bottom:1px solid #dce5ed;padding:12px 0';
  const title=document.createElement('p');title.textContent=`${r.ugel} · ${r.nombre_ie} · ${r.nivel} ${r.grado} ${r.seccion} · ${r.area} · ${r.registrador}`;
  const motivo=document.createElement('p');motivo.textContent='Motivo: '+r.motivo;
  const approve=document.createElement('button');approve.textContent='Aprobar reapertura';
  const reject=document.createElement('button');reject.textContent='Rechazar';reject.className='danger';reject.style.marginLeft='8px';
  async function resolve(ok){
   if(!confirm(ok?'¿Aprobar reapertura? El registro volverá a borrador.':'¿Rechazar esta solicitud?'))return;
   const comentario=prompt('Comentario del administrador (opcional):','');if(comentario===null)return;
   approve.disabled=reject.disabled=true;
   const {error}=await db.rpc('piloto_admin_resolver',{p_solicitud_id:r.id,p_aprobar:ok,p_comentario:comentario});
   $('adminStatus').textContent=error?'No se pudo resolver: '+error.message:(ok?'Reapertura aprobada.':'Solicitud rechazada.');
   await refreshAdmin();
  }
  approve.onclick=()=>resolve(true);reject.onclick=()=>resolve(false);
  line.append(title,motivo,approve,reject);host.append(line);
 }
}
if($('refreshAdmin'))$('refreshAdmin').onclick=refreshAdmin;
if(false && $('wipeTests'))$('wipeTests').onclick=async()=>{
 const phrase=prompt('ATENCIÓN: se eliminarán TODOS los registros y respuestas, incluso los enviados. Para confirmar, escriba exactamente BORRAR PRUEBAS');
 if(phrase!=='BORRAR PRUEBAS')return;
 if(!confirm('Última confirmación: ¿eliminar todos los registros y respuestas? Esta acción no se puede deshacer.'))return;
 $('wipeTests').disabled=true;
 const {data,error}=await db.rpc('piloto_admin_limpiar_pruebas',{p_confirmacion:phrase});
 $('adminStatus').textContent=error?'No se pudo limpiar: '+error.message:`Limpieza completada: ${data.registros} registros y ${data.respuestas} respuestas.`;
 $('wipeTests').disabled=false;if(!error){await refreshAdmin();await refreshMine();await loadSection()}
};
async function setupRoles(){
 $('requestPanel').classList.remove('hide');await refreshMine();await refreshReleaseRequests();
 const {data,error}=await db.rpc('piloto_es_admin');
 const isAdmin=!error&&data===true;
 $('adminPanel').classList.toggle('hide',!isAdmin);
 if(isAdmin){await refreshAdmin();await refreshAdminReleases();}
}

// Solicitud de liberación de borradores propios y resolución administrativa.
async function refreshReleaseRequests(){
 const mine=$('myDrafts');if(!mine)return;mine.replaceChildren();
 const {data,error}=await db.rpc('piloto_mis_borradores');
 if(error){mine.textContent='No se pudieron consultar borradores: '+error.message;return}
 if(!data?.length){mine.textContent='No tiene borradores activos.';return}
 for(const r of data){
  const row=document.createElement('div');row.className='request-row';
  const txt=document.createElement('span');txt.textContent=`${r.nombre_ie} · ${r.grado} ${r.seccion} · ${r.area}`;
  const btn=document.createElement('button');btn.className='secondary';btn.textContent='Solicitar liberación';
  btn.onclick=async()=>{const motivo=prompt('Indique por qué esta sección no le corresponde (mínimo 10 caracteres):');if(motivo===null)return;if(motivo.trim().length<10)return alert('Explique el motivo con al menos 10 caracteres.');btn.disabled=true;const {error}=await db.rpc('piloto_solicitar_liberacion',{p_registro_id:r.id,p_motivo:motivo.trim()});alert(error?'No se pudo solicitar: '+error.message:'Solicitud de liberación enviada al administrador.');if(error)btn.disabled=false;};
  row.append(txt,btn);mine.append(row);
 }
}
async function refreshAdminReleases(){
 const host=$('adminReleases');if(!host)return;host.replaceChildren();
 const {data,error}=await db.rpc('piloto_admin_liberaciones');
 if(error){host.textContent='Error al consultar liberaciones: '+error.message;return}
 if(!data?.length){host.textContent='No hay solicitudes de liberación pendientes.';return}
 for(const r of data){const line=document.createElement('div');line.className='request-row';const text=document.createElement('span');text.textContent=`${r.nombre_ie} · ${r.grado} ${r.seccion} · ${r.area} · ${r.registrador} — ${r.motivo}`;
 const yes=document.createElement('button');yes.textContent='Aprobar liberación';const no=document.createElement('button');no.className='secondary';no.textContent='Rechazar';
 const resolve=async ok=>{if(!confirm(ok?'¿Liberar el borrador? Se eliminarán sus respuestas y participación, pero NO la nómina.':'¿Rechazar la solicitud?'))return;yes.disabled=no.disabled=true;const {error}=await db.rpc('piloto_admin_resolver_liberacion',{p_solicitud_id:r.id,p_aprobar:ok});alert(error?'No se pudo resolver: '+error.message:ok?'Sección liberada.':'Solicitud rechazada.');await refreshAdminReleases();await refreshAdmin();await loadSection();};
 yes.onclick=()=>resolve(true);no.onclick=()=>resolve(false);line.append(text,yes,no);host.append(line);
 }
}
if($('refreshDrafts'))$('refreshDrafts').onclick=refreshReleaseRequests;
if($('refreshReleases'))$('refreshReleases').onclick=refreshAdminReleases;
