import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const $=id=>document.getElementById(id), db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const fields=[['ugel','UGEL'],['ie','Institución educativa'],['nivel','Nivel'],['area','Área'],['grado','Grado'],['seccion','Sección'],['fecha','Fecha de aplicación','date']];
const items=[...Array.from({length:23},(_,i)=>'C1-'+String(i+1).padStart(2,'0')),...Array.from({length:23},(_,i)=>'C2-'+String(i+1).padStart(2,'0'))];
let catalog=[],students=[],answers={},participation={},activeRecord=null,locked=false,loading=false,profile=null,currentUser=null;
let initVersion=0;
let currentPage=0;
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
// Solo presentación: el ajuste de anchos no modifica respuestas, usuarios ni Supabase.
(function setupErlaColumnWidths(){
 const table=$('sheet'), widthsDefault=[44,145,125,125,170,135,65];
 const key='erla2026_student_column_widths_v2';
 let widths=widthsDefault.slice();
 try{const saved=JSON.parse(localStorage.getItem(key));if(Array.isArray(saved)&&saved.length===7&&saved.every(n=>Number.isFinite(n)&&n>=35&&n<=450))widths=saved;}catch(_e){}
 const colgroup=document.createElement('colgroup');
 for(let i=0;i<52;i++)colgroup.append(document.createElement('col'));
 table.insertBefore(colgroup,table.firstChild);
 function apply(){
   widths.forEach((w,i)=>table.style.setProperty(i<6?'--erla-c'+(i+1):'--erla-answer',w+'px'));
   [...colgroup.children].forEach((col,i)=>{col.style.width=(widths[i<6?i:6])+'px'});
   table.style.width=(widths.slice(0,6).reduce((a,b)=>a+b,0)+46*widths[6])+'px';
 }
 apply();
 head.querySelectorAll('th').forEach((th,i)=>{
   // Las preguntas comparten un ancho común, para no añadir 46 controles innecesarios.
   if(i>6)return;
   th.title=(i===6?'Arrastre para ajustar todas las respuestas':'Arrastre el borde derecho para ajustar el ancho');
   const grip=document.createElement('span');grip.className='erla-col-grip';grip.setAttribute('aria-hidden','true');
   grip.addEventListener('pointerdown',e=>{
     if(e.button!==0)return;
     e.preventDefault();e.stopPropagation();
     const start=e.clientX,initial=widths[i];grip.setPointerCapture(e.pointerId);
     const move=ev=>{widths[i]=Math.max(i===5?100: i===6?52:35,Math.min(450,initial+ev.clientX-start));apply();};
     const finish=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',finish);grip.removeEventListener('pointercancel',finish);try{localStorage.setItem(key,JSON.stringify(widths));}catch(_e){}};
     grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
   });th.append(grip);
 });
 const reset=document.createElement('button');reset.type='button';reset.id='erlaResetWidths';reset.className='secondary';reset.textContent='Restablecer columnas';reset.title='Volver a los anchos compactos';
 reset.addEventListener('click',()=>{widths=widthsDefault.slice();apply();try{localStorage.removeItem(key)}catch(_e){}});
 const toolbar=$('tableScroller');if(toolbar&&toolbar.parentElement)toolbar.parentElement.insertBefore(reset,toolbar);
})();

function completion(){return students.filter(s=>participation[s.id]==='NO'||(participation[s.id]==='SI'&&items.every(it=>answers[s.id+'|'+it]))).length}
function isComplete(s){return participation[s.id]==='NO'||(participation[s.id]==='SI'&&items.every(it=>answers[s.id+'|'+it]))}
// Al registrar, mantener exactamente el estudiante y la pregunta actual.
// No se cambian de página, se reordenan ni se ocultan las filas.
function onStudentEdited(studentId,wasComplete){
 const scroller=$('tableScroller');
 const current=document.activeElement;
 const windowY=window.scrollY;
 const left=scroller?.scrollLeft??0;
 const top=scroller?.scrollTop??0;
 const row=$('student-'+studentId);
 const nowComplete=students.some(s=>String(s.id)===String(studentId)&&isComplete(s));
 if(row){
   row.classList.toggle('registration-complete',nowComplete);
   row.classList.toggle('registration-active',!nowComplete);
 }
 count();
 // Evita los saltos causados por el anclaje de scroll del navegador.
 // Restaurar sin scrollIntoView ni cambios de foco.
 requestAnimationFrame(()=>{
   if(scroller){scroller.scrollLeft=left;scroller.scrollTop=top;}
   if(Math.abs(window.scrollY-windowY)>1)window.scrollTo({top:windowY,left:window.scrollX,behavior:'instant'});
 });
}
function count(){const total=students.length,done=completion();$('counter').textContent=`${total} estudiantes · ${done} completos`;$('answered').textContent=Object.values(answers).filter(Boolean).length+' respuestas ingresadas';const ready=!locked&&!loading&&total>0&&done===total&&!!v('fecha');
 const send=$('send');send.disabled=!ready;send.classList.toggle('ready-to-send',ready);
 send.setAttribute('aria-label',ready?'Enviar registro: todos los estudiantes están completos':'Enviar registro: faltan estudiantes o datos por completar');}
function draw(){
 const scroller=$('tableScroller');
 const oldX=scroller?.scrollLeft||0,oldY=scroller?.scrollTop||0;
 const table=$('sheet');table.querySelectorAll('tr:not(:first-child)').forEach(x=>x.remove());const q=($('studentSearch')?.value||'').trim().toLocaleLowerCase('es');(()=>{const filtered=students.filter(s=>!q||[s.codigo_estudiante,s.apellido_paterno,s.apellido_materno,s.nombres].join(' ').toLocaleLowerCase('es').includes(q));
 $('pageInfo').textContent=filtered.length?`${filtered.length} estudiantes en la sección`:'No hay estudiantes para mostrar';
 return filtered})().forEach(s=>{const tr=document.createElement('tr');tr.id='student-'+s.id;if(participation[s.id]==='NO')tr.classList.add('not-participating');const n=students.indexOf(s)+1;for(const val of [n,s.codigo_estudiante,s.apellido_paterno,s.apellido_materno,s.nombres]){const td=document.createElement('td');td.textContent=val??'';td.title=String(val??'');tr.append(td)}const tdPart=document.createElement('td'),part=document.createElement('select');part.className='participation';part.dataset.student=s.id;for(const [value,label] of [['','Seleccione'],['SI','Sí participó'],['NO','No participó']])part.add(new Option(label,value));part.value=participation[s.id]||'';part.disabled=locked;part.addEventListener('change',()=>{const wasComplete=isComplete(s);if(part.value==='NO'&&items.some(it=>answers[s.id+'|'+it])&&!confirm('Este estudiante tiene respuestas registradas. ¿Confirmar que NO participó? Se borrarán sus respuestas.')){part.value=participation[s.id]||'';return}participation[s.id]=part.value;if(part.value==='NO')for(const it of items)delete answers[s.id+'|'+it];hideObservations();
 tr.classList.toggle('not-participating',part.value==='NO');
 for(const answerSelect of tr.querySelectorAll('select[data-key]')){
   const key=answerSelect.dataset.key;
   answerSelect.disabled=locked||part.value!=='SI';
   if(part.value==='NO'){answerSelect.replaceChildren(new Option('–',''));answerSelect.value='';}
   else {answerSelect.replaceChildren(...['','A','B','C','D','99'].map(opt=>new Option(opt||'–',opt)));answerSelect.value=answers[key]||'';}
 }
 onStudentEdited(s.id,wasComplete);
 });tdPart.append(part);tr.append(tdPart);for(const item of items){const td=document.createElement('td'),sel=document.createElement('select'),key=s.id+'|'+item;sel.dataset.key=key;for(const opt of ['','A','B','C','D','99'])sel.add(new Option(opt||'–',opt));sel.value=participation[s.id]==='NO'?'':(answers[key]||'');sel.disabled=locked||participation[s.id]!=='SI';if(participation[s.id]==='NO'){sel.replaceChildren(new Option('–',''));sel.value=''}sel.addEventListener('change',()=>{const wasComplete=isComplete(s);answers[key]=sel.value;hideObservations();onStudentEdited(s.id,wasComplete)});td.append(sel);tr.append(td)}table.append(tr)});if($('save'))$('save').disabled=locked||loading;
 fitTenStudentRows();if(scroller){scroller.scrollLeft=oldX;scroller.scrollTop=oldY;updateHorizontalSlider();}
 count();
 
}
// Ajusta el alto real al encabezado y como máximo diez filas,
// sin ocultar ni paginar estudiantes. El resto se recorre con la barra vertical.
function fitTenStudentRows(){
 const scroller=$('tableScroller'),table=$('sheet');if(!scroller||!table)return;
 const head=table.querySelector('tr');const rows=[...table.querySelectorAll('tr')].slice(1,11);
 if(!head)return;
 const needed=Math.ceil(head.getBoundingClientRect().height+rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+2);
 const limit=Math.max(180,Math.floor(window.innerHeight*(window.matchMedia('(max-width:700px)').matches?.55:.58)));
 const target=Math.min(needed,limit);
 scroller.style.setProperty('height',`${target}px`,'important');
 scroller.style.setProperty('max-height',`${target}px`,'important');
}
window.addEventListener('resize',fitTenStudentRows);
function showSectionState(state){const el=$('sectionState');if(!el)return;if(!state||state.estado==='LIBRE'){el.className='hide';el.textContent='';return}const sent=state.estado==='ENVIADO',occupied=state.estado==='OCUPADA';el.className=sent?'sent':'draft';const parts=[sent?'✓ SECCIÓN REGISTRADA · SOLO LECTURA':occupied?'🔒 SECCIÓN EN REGISTRO POR OTRO ESPECIALISTA':'BORRADOR RECUPERADO',state.registrador?'Registrado por: '+state.registrador:'',state.fecha_aplicacion?'Fecha de aplicación: '+state.fecha_aplicacion:'',sent?'Las respuestas están bloqueadas. Solicite reapertura para corregirlas.':occupied?'No puede editar ni enviar esta sección.':'Puede continuar y guardar los cambios.'];el.textContent=parts.filter(Boolean).join('  ·  ')}
function restoreRecord(state){activeRecord=state.id||null;if(state.fecha_aplicacion)$('fecha').value=state.fecha_aplicacion;for(const r of state.respuestas||[])answers[r.estudiante_id+'|'+r.item]=r.respuesta;for(const p of state.participacion||[])participation[p.estudiante_id]=p.participo?'SI':'NO'}
function hideObservations(){$('observations').classList.add('hide');$('observations').replaceChildren();document.querySelectorAll('.cell-error,.row-error').forEach(el=>el.classList.remove('cell-error','row-error'))}
function validateFinal(){hideObservations();const issues=[];for(const [id,label] of fields){if(!v(id))issues.push({message:'Complete '+label+'.',field:id})}if(!students.length)issues.push({message:'Seleccione una sección con estudiantes.'});for(const s of students){const name=[s.apellido_paterno,s.apellido_materno,s.nombres].filter(Boolean).join(' ');if(!participation[s.id])issues.push({message:`${name}: indique si participó.`,student:s.id});else if(participation[s.id]==='SI'){const missing=items.filter(it=>!answers[s.id+'|'+it]);if(missing.length)issues.push({message:`${name}: faltan ${missing.length} ítems (${missing.slice(0,5).join(', ')}${missing.length>5?', …':''}).`,student:s.id,item:missing[0]})}}if(issues.length){const panel=$('observations');panel.classList.remove('hide');const strong=document.createElement('strong');strong.textContent=`No se puede enviar: ${issues.length} observación(es).`;panel.append(strong);const ul=document.createElement('ul');for(const issue of issues.slice(0,50)){const li=document.createElement('li'),link=document.createElement('a');link.href='#';link.textContent=issue.message;link.onclick=e=>{e.preventDefault();if(issue.student){$('studentSearch').value='';
 draw();const tr=$('student-'+issue.student);tr?.classList.add('row-error');const el=issue.item?tr?.querySelector(`[data-key="${issue.student}|${issue.item}"]`):tr?.querySelector('[data-student]');el?.classList.add('cell-error');el?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});el?.focus()}else{$(issue.field)?.scrollIntoView({behavior:'smooth',block:'center'});$(issue.field)?.focus()}};li.append(link);ul.append(li)}panel.append(ul);panel.scrollIntoView({behavior:'smooth',block:'nearest'});setStatus('Corrija las observaciones marcadas antes de enviar.');return false}return true}
async function loadSection(){const serial=++requestSerial;students=[];answers={};participation={};activeRecord=null;locked=false;hideObservations();showSectionState(null);draw();if(!v('seccion')||!v('area')){setStatus('Seleccione área y sección.');return}const entry=subset(group)[0];if(!entry)return;setStatus('Verificando sección y cargando nómina...');
const [statusResult,studentResult]=await Promise.all([db.rpc('piloto_estado',{p_institucion_id:entry.id,p_area:v('area')}),db.from('estudiantes').select('id,codigo_estudiante,apellido_paterno,apellido_materno,nombres').eq('institucion_id',entry.id).order('apellido_paterno').order('apellido_materno')]);
if(serial!==requestSerial)return;
if(statusResult.error||studentResult.error){setStatus('No se pudo consultar Supabase: '+(statusResult.error||studentResult.error).message);return}
students=studentResult.data||[];const state=statusResult.data||{};
if(state.estado==='ENVIADO'){
 locked=true;
 if(document.body.classList.contains('erla-admin-active') && !(state.respuestas||[]).length){
  try{const view=await umCall('section_read',{institucion_id:entry.id,area:v('area')});if(serial!==requestSerial)return;if(view.encontrado)restoreRecord(view);else restoreRecord(state);}catch(e){restoreRecord(state);setStatus('No se pudieron recuperar respuestas administrativas: '+e.message);}
 }else restoreRecord(state);
 showSectionState(state);draw();setStatus(`Sección enviada · ${Object.keys(answers).length} respuestas visibles · Solo lectura.`);return;
}
if(state.estado==='OCUPADA'){
 locked=true;
 if(document.body.classList.contains('erla-admin-active')){
  setStatus('Consultando respuestas guardadas de esta sección (solo lectura)...');
  try{
   const view=await umCall('section_read',{institucion_id:entry.id,area:v('area')});
   if(serial!==requestSerial)return;
   if(view.encontrado){restoreRecord(view);showSectionState({...view,estado:'OCUPADA'});
    const savedStudents=new Set((view.respuestas||[]).map(x=>String(x.estudiante_id)));
    setStatus(`SOLO LECTURA · ${savedStudents.size} estudiantes con respuestas · ${(view.respuestas||[]).length} respuestas guardadas · Estado: ${view.estado||'SIN ENVIAR'}. ${view.aviso||''}`);
   }else{showSectionState(state);setStatus('No se encontró registro para esta sección. No se han inventado respuestas.');}
  }catch(e){showSectionState(state);setStatus('No se pudieron consultar las respuestas: '+e.message+' · Verifique que actualizó la Edge Function.');}
 }else{showSectionState(state);setStatus('Esta sección está asignada a otro especialista. No tiene permiso para modificar ni consultar respuestas ajenas.');}
 draw();return;
}
if(state.estado==='EN REGISTRO'){restoreRecord(state);showSectionState(state);setStatus('Se recuperó su avance guardado. Puede continuar.');}
else{$('fecha').value=new Date().toLocaleDateString('en-CA');setStatus('Nómina cargada. Complete sus datos y registre las respuestas.');}
draw();}
function participationRows(){return students.filter(s=>participation[s.id]).map(s=>({estudiante_id:s.id,participo:participation[s.id]==='SI'}))}
function rows(){return students.flatMap(s=>items.map(item=>({estudiante_id:s.id,item,respuesta:answers[s.id+'|'+item]})).filter(x=>x.respuesta))}
function validate(){if(!students.length)throw Error('Seleccione una sección con estudiantes.');for(const k of ['ugel','ie','nivel','area','grado','seccion','fecha'])if(!v(k))throw Error('Complete '+k+'.');if(!profile?.nombre||!profile?.correo)throw Error('Primero complete su perfil de especialista.');}
async function persist(final){if(loading)return;try{validate();if(final&&!validateFinal())return;loading=true;if($('save'))$('save').disabled=true;if($('send'))$('send').disabled=true;setStatus('Guardando en Supabase...');const entry=subset(group)[0];const payload={p_id:activeRecord,p_institucion_id:entry.id,p_area:v('area'),p_registrador:profileValue('nombre'),p_correo:profileValue('correo'),p_celular:profileValue('celular'),p_cargo:profileValue('cargo'),p_fecha_aplicacion:v('fecha'),p_enviar:final,p_respuestas:rows(),p_participacion:participationRows()};const {data,error}=await db.rpc('guardar_piloto',payload);if(error)throw error;activeRecord=data;locked=final;showSectionState({estado:final?'ENVIADO':'EN REGISTRO',registrador:profileValue('nombre'),fecha_aplicacion:v('fecha')});draw();setStatus(final?'¡Registro enviado correctamente! ID: '+data+'. Para corregirlo, solicite una reapertura.':'Avance guardado correctamente en Supabase. ID: '+data);if(final){alert('¡Registro enviado correctamente! Se guardaron las respuestas y la sección quedó cerrada.');await refreshMine();await misSeccionesCargar();}}catch(e){setStatus('No se guardó: '+e.message)}finally{loading=false;if(!locked)draw()}}
function updateHorizontalSlider(){
 const el=$('tableScroller'),slider=$('horizontalRange');if(!el||!slider)return;
 const max=Math.max(0,el.scrollWidth-el.clientWidth);
 slider.disabled=max===0;slider.value=max?String(Math.round(el.scrollLeft/max*100)):'0';
 $('horizontalHint').textContent=max?'Deslice para ver las preguntas →':'Todas las columnas visibles';
 const floating=$('floatingHorizontal'),floatingRange=$('floatingRange');
 if(floating&&floatingRange){floatingRange.disabled=max===0;floatingRange.value=slider.value;floating.classList.toggle('visible',max>0&&!$('app').classList.contains('hide'));}
}
$('tableScroller')?.addEventListener('scroll',updateHorizontalSlider,{passive:true});
$('floatingRange')?.addEventListener('input',e=>{const el=$('tableScroller');el.scrollLeft=(el.scrollWidth-el.clientWidth)*Number(e.target.value)/100;});
$('horizontalRange')?.addEventListener('input',e=>{
 const el=$('tableScroller');el.scrollLeft=(el.scrollWidth-el.clientWidth)*Number(e.target.value)/100;
});
// Calcular páginas automáticamente a partir del alto visible de la tabla.
// Mantener la fila actual al redimensionar y evitar cambios durante la edición.
// Los botones desplazan una fila dentro de la lista continua.
// No modifican respuestas, no reconstruyen la tabla y no cambian de página.
let selectedStudentIndex=-1;
function visibleStudentRows(){return Array.from($('sheet')?.querySelectorAll('tr[id^="student-"]')||[])}
function goToStudent(direction){
 const scroller=$('tableScroller'),rows=visibleStudentRows();if(!scroller||!rows.length)return;
 const current=rows.findIndex(r=>r.offsetTop+r.offsetHeight/2>scroller.scrollTop+2);
 const base=Math.max(0,current);
 selectedStudentIndex=Math.max(0,Math.min(rows.length-1,base+direction));
 const row=rows[selectedStudentIndex];
 const x=scroller.scrollLeft;
 // Se desplaza solamente el contenedor vertical de estudiantes.
 const target=row.getBoundingClientRect().top-scroller.getBoundingClientRect().top+scroller.scrollTop-42;
 scroller.scrollTop=Math.max(0,target);scroller.scrollLeft=x;
}
$('previousStudent')?.addEventListener('click',()=>goToStudent(-1));
$('nextStudent')?.addEventListener('click',()=>goToStudent(1));
$('tableScroller')?.addEventListener('click',e=>{const row=e.target.closest('tr[id^="student-"]');if(row)selectedStudentIndex=visibleStudentRows().indexOf(row)});
$('tableScroller')?.addEventListener('scroll',()=>{selectedStudentIndex=-1},{passive:true});
$('studentSearch')?.addEventListener('input',()=>{selectedStudentIndex=-1;currentPage=0;draw()});
window.addEventListener('resize',updateHorizontalSlider);

window.addEventListener('scroll',()=>{const t=$('tableScroller'),f=$('floatingHorizontal');if(!t||!f)return;const r=t.getBoundingClientRect();f.style.visibility=(r.bottom>70&&r.top<window.innerHeight-55)?'visible':'hidden';},{passive:true});
if($('save'))$('save').onclick=()=>persist(false);if($('send'))$('send').onclick=()=>{if(!validateFinal())return;if(confirm('¿Enviar registro definitivo? Todos los estudiantes están completos y después necesitará una reapertura para corregirlo.'))persist(true)};
if($('csv'))$('csv').onclick=()=>{if(!students.length)return alert('Seleccione una sección con estudiantes.');if(!window.XLSX)return alert('No se cargó el componente Excel. Revise su conexión a internet.');const data=students.map((s,i)=>{const row={'N.º':i+1,'Código de estudiante':String(s.codigo_estudiante||''),'Apellido paterno':s.apellido_paterno||'','Apellido materno':s.apellido_materno||'','Nombres':s.nombres||'','Participó':participation[s.id]==='SI'?'Sí':participation[s.id]==='NO'?'No':'Pendiente'};for(const it of items)row[it]=participation[s.id]==='NO'?'-':answers[s.id+'|'+it]||'-';return row});const book=XLSX.utils.book_new(),sheet=XLSX.utils.json_to_sheet(data);sheet['!cols']=[{wch:6},{wch:23},{wch:22},{wch:22},{wch:28},{wch:15},...items.map(()=>({wch:9}))];XLSX.utils.book_append_sheet(book,sheet,'Respuestas');XLSX.writeFile(book,`Piloto_DRELM_${v('ugel')||'UGEL'}_${v('area')||'Area'}_${v('fecha')||'fecha'}.xlsx`)};
async function init(){
 const version=++initVersion;
 const {data:{session},error:sessionError}=await db.auth.getSession();

 if(sessionError)throw sessionError;
 currentUser=session?.user||null;
 profile=null;
 adminHideModules(); specialistHideModules();

 if(!session && $('authStatus'))$('authStatus').textContent='Ingrese con su correo y contraseña. Sus datos personales solo se solicitan la primera vez.';
 $('authPanel').classList.toggle('hide',!!session);$('sessionBar').classList.toggle('hide',!session);$('sessionEmail').textContent=session?.user?.email||'';if(!session)$('editProfile').classList.add('hide');
 if(session){$('sessionStatus').textContent='Cargando perfil y permisos...';$('sessionStatus').classList.remove('hide')}else{$('sessionStatus').textContent=''}
 if(!session){specialistHideModules();$('app').classList.add('hide');$('profilePanel').classList.add('hide');$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');adminHideModules();adminHideModules();return}
 // La tabla de autorizados se valida en Supabase, no por un listado expuesto al navegador.
 const {data:autorizado,error:autError}=await db.rpc('piloto_es_autorizado');

 if(autError||autorizado!==true){
  $('sessionStatus').textContent=autError?'Error al validar autorización: '+autError.message:'Su correo no está autorizado.';
  $('app').classList.add('hide');$('profilePanel').classList.add('hide');$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');adminHideModules();
  $('authPanel').classList.remove('hide');$('sessionBar').classList.remove('hide');$('editProfile').classList.add('hide');$('authStatus').textContent=autError?'No se pudo validar la autorización: '+autError.message:'Su correo institucional no está autorizado para acceder al aplicativo.';
  return;
 }
 // Precarga segura: la RPC solo devuelve la fila del usuario autenticado.
 const {data:maestro,error:maestroError}=await db.rpc('erla_mi_ficha_maestra');
 if(maestroError){
  $('sessionStatus').textContent='No se pudo cargar la ficha maestra: '+maestroError.message+' (ejecute el SQL adjunto).';
  $('app').classList.add('hide');$('profilePanel').classList.add('hide');return;
 }
 const ficha=maestro && typeof maestro==='object' ? maestro : null;
 const {data:pr,error:pe}=await db.from('piloto_especialistas').select('nombre,correo,celular,cargo').eq('usuario_id',session.user.id).maybeSingle();

 if(pe){$('app').classList.add('hide');$('profilePanel').classList.add('hide');$('sessionStatus').textContent='Error al consultar su perfil: '+pe.message;return}
 // Nunca asociar automáticamente un perfil de otro usuario por coincidencia de correo.
 // El usuario autenticado solo recupera su perfil mediante su usuario_id.
 // Conservar datos ya guardados; completar solo los que falten desde la ficha maestra.
 const base=pr || {};
 const datos={
  nombre:base.nombre||ficha?.nombre||'',
  correo:session.user.email||'',
  celular:base.celular||ficha?.celular||'',
  cargo:base.cargo||ficha?.cargo||''
 };
 // El alta automática usa la misma tabla y clave de usuario ya existentes.
 // Si faltan datos, se muestra el formulario precargado en vez de crear un perfil incompleto.
 const completo=datos.nombre.trim().length>=5 && /^\d{9}$/.test(datos.celular.trim()) && !!datos.cargo.trim();
 if(!pr && ficha && completo){
  const {error:guardarError}=await db.from('piloto_especialistas').upsert({
   usuario_id:session.user.id,...datos
  },{onConflict:'usuario_id'});
  if(guardarError){
   $('sessionStatus').textContent='No se pudo guardar el perfil precargado: '+guardarError.message;
   $('app').classList.add('hide');$('profilePanel').classList.add('hide');return;
  }
 }
 profile=(pr||(!ficha||!completo?null:datos));
 $('authPanel').classList.add('hide');
 $('sessionBar').classList.remove('hide');
 $('pCorreo').value=session.user.email||'';
 for(const [k,id] of [['nombre','pNombre'],['celular','pCelular'],['cargo','pCargo']])$(id).value=profile?.[k]||datos[k]||'';
 $('profilePanel').classList.toggle('hide',!!profile);$('app').classList.toggle('hide',!profile);
 $('editProfile').classList.toggle('hide',!profile);
 $('sessionStatus').textContent=profile?'Perfil cargado. Consultando instituciones...':'Complete sus datos personales para continuar.';
 if(!profile)$('profileStatus').textContent=ficha?'Se precargaron los datos disponibles. Complete los campos faltantes y guarde.':'No hay ficha maestra vinculada. Complete sus datos para continuar.';
 if(!profile){$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');return;}
 $('specialistBadge').textContent='Especialista: '+profile.nombre;
 const {data,error}=await db.from('instituciones').select('id,ugel,cod_mod,nombre_ie,nivel,grado,seccion').order('ugel').limit(1000);

 if(error){$('app').classList.remove('hide');$('sessionStatus').textContent='No se pudieron cargar las instituciones: '+error.message;setStatus('No se pudieron cargar las instituciones: '+error.message);return}
 catalog=(data||[]).map(x=>({...x,ie:x.nombre_ie}));options('ugel',catalog.map(x=>x.ugel));setStatus(catalog.length?'Seleccione UGEL e institución educativa.':'No se encontraron instituciones disponibles para su cuenta.');$('sessionStatus').textContent='';try{await setupRoles()}catch(e){console.error('Error en solicitudes o administración:',e);$('sessionStatus').textContent='Las evaluaciones están disponibles; no se pudo cargar el panel adicional: '+e.message}
}
if($('saveProfile'))$('saveProfile').onclick=async()=>{
 const nombre=v('pNombre').trim(),celular=v('pCelular').trim(),cargo=v('pCargo').trim();
 if(nombre.length<5||!/^\d{9}$/.test(celular)||!cargo)return $('profileStatus').textContent='Complete nombres y apellidos, celular de 9 dígitos y cargo.';
 $('saveProfile').disabled=true;$('profileStatus').textContent='Guardando datos del especialista...';
 try{const {error}=await db.from('piloto_especialistas').upsert({usuario_id:currentUser.id,nombre,correo:currentUser.email,celular,cargo},{onConflict:'usuario_id'});if(error)throw error;await init()}
 catch(e){$('profileStatus').textContent='No se guardó: '+e.message}finally{$('saveProfile').disabled=false}
};
if($('editProfile'))$('editProfile').onclick=()=>{$('app').classList.add('hide');$('profilePanel').classList.remove('hide')};
// Con sesión vigente, init() recupera el perfil existente sin pedir datos.
// Sin sesión, Supabase solicita las credenciales de la cuenta autorizada.
if($('loginForm'))$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const email=v('loginEmail').trim().toLowerCase(),password=v('loginPassword');
 if(!email||!password){$('authStatus').textContent='Ingrese su correo y contraseña.';return}
 const btn=$('loginButton');btn.disabled=true;$('authStatus').textContent='Validando credenciales...';
 try{
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error)throw error;
  // El inicio de sesión no otorga permisos por sí solo: init comprueba la autorización.
  if(!data?.user)throw Error('No se pudo establecer la sesión.');
  $('loginPassword').value='';
  await init();
 }catch(err){
  const message=/invalid login credentials/i.test(err.message)?'Correo o contraseña incorrectos. Compruebe las credenciales configuradas en Supabase.':err.message;
  $('authStatus').textContent='No se pudo ingresar: '+message;
 }finally{btn.disabled=false}
});
if($('logout'))$('logout').onclick=async()=>{await db.auth.signOut();location.reload()};
db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session){
 // Supabase puede emitir SIGNED_IN al volver a enfocar una pestaña ya autenticada.
 // No reiniciar: se perderían la sección seleccionada y las respuestas aún no guardadas.
 if(currentUser?.id===session.user.id && profile) return;
 setTimeout(()=>init().catch(e=>{console.error(e);$('sessionStatus').textContent='No se pudo cargar el aplicativo: '+e.message}),0)}else if(event==='SIGNED_OUT'){adminHideModules();specialistHideModules();++initVersion;currentUser=null;profile=null;catalog=[];students=[];answers={};activeRecord=null;locked=false;$('app').classList.add('hide');$('requestPanel').classList.add('hide');$('adminPanel').classList.add('hide');$('authPanel').classList.remove('hide');$('sessionBar').classList.add('hide')}});
init().catch(e=>{console.error('Error al iniciar:',e);if($('sessionStatus'))$('sessionStatus').textContent='No se pudo cargar el aplicativo: '+e.message;if($('authStatus'))$('authStatus').textContent='No se pudo iniciar el aplicativo: '+e.message;});

// Listado unificado: utiliza exclusivamente las RPC de registros propios ya existentes.
let misSecciones=[];
function misSeccionesDibujar(){
 const host=$('misSeccionesFilas');if(!host)return;host.replaceChildren();
 const q=($('misSeccionesBuscar')?.value||'').trim().toLocaleLowerCase('es');
 const filtro=$('misSeccionesEstado')?.value||'';
 const visibles=misSecciones.filter(r=>(!filtro||r.estado===filtro)&&[r.nombre_ie,r.grado,r.seccion,r.area].some(x=>String(x??'').toLocaleLowerCase('es').includes(q)));
 $('misSeccionesEstadoTexto').textContent=`${visibles.length} sección(es) · ${misSecciones.filter(r=>r.estado==='ENVIADO').length} enviadas · ${misSecciones.filter(r=>r.estado==='BORRADOR').length} borradores`;
 if(!visibles.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='No hay secciones para los filtros seleccionados.';tr.append(td);host.append(tr);return}
 for(const r of visibles){const tr=document.createElement('tr');for(const value of [r.nombre_ie,r.grado,r.seccion,r.area,r.estado==='ENVIADO'?'Enviada':'Borrador',r.fecha_envio?new Date(r.fecha_envio).toLocaleDateString('es-PE'):'—']){const td=document.createElement('td');td.textContent=String(value??'');tr.append(td)}
 const td=document.createElement('td'),btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent='Ver sección';btn.onclick=async()=>{
  const match=catalog.find(x=>String(x.nombre_ie)===String(r.nombre_ie)&&String(x.grado)===String(r.grado)&&String(x.seccion)===String(r.seccion));
  if(!match){alert('No se encontró esta sección en el padrón cargado. Consulte al administrador.');return}
  for(const key of group){const value=String(match[key]??'');if(![...$(key).options].some(o=>o.value===value)){if(key==='ugel')options(key,catalog.map(x=>x.ugel));else options(key,subset(group.slice(0,group.indexOf(key))).map(x=>x[key]));}$(key).value=value;}
  $('area').value=String(r.area??'');document.getElementById('app')?.scrollIntoView({behavior:'smooth',block:'start'});await loadSection();
 };td.append(btn);tr.append(td);host.append(tr)}
}
async function misSeccionesCargar(){const status=$('misSeccionesEstadoTexto');if(!status)return;status.textContent='Consultando sus secciones...';
 const [enviados,borradores]=await Promise.all([db.rpc('piloto_mis_enviados'),db.rpc('piloto_mis_borradores')]);
 if(enviados.error||borradores.error){status.textContent='No se pudo cargar el listado: '+(enviados.error||borradores.error).message;return}
 misSecciones=[...(enviados.data||[]).map(x=>({...x,estado:'ENVIADO'})),...(borradores.data||[]).map(x=>({...x,estado:'BORRADOR'}))];misSeccionesDibujar();
}
$('misSeccionesActualizar')?.addEventListener('click',misSeccionesCargar);
$('misSeccionesBuscar')?.addEventListener('input',misSeccionesDibujar);
$('misSeccionesEstado')?.addEventListener('change',misSeccionesDibujar);
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
let specialistsRows=[];
const segNorm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function segFiltered(){
 const q=segNorm($('segBuscar')?.value),iged=$('segIged')?.value||'',estado=$('segEstado')?.value||'',orden=$('segOrden')?.value||'az';
 const arr=specialistsRows.filter(r=>{
  const txt=segNorm([r.nombre,r.correo,r.dni,r.cargo,r.iged].join(' '));
  if(q&&!txt.includes(q))return false;
  if(iged&&r.iged!==iged)return false;
  if(estado==='con'&&Number(r.registros)===0)return false;
  if(estado==='sin'&&Number(r.registros)>0)return false;
  if(estado==='borradores'&&Number(r.borradores)===0)return false;
  if(estado==='enviados'&&Number(r.enviados)===0)return false;
  return true;
 });
 arr.sort((a,b)=>orden==='registros'?Number(b.registros)-Number(a.registros):orden==='reciente'?(new Date(b.ultima_actividad||0)-new Date(a.ultima_actividad||0)):orden==='za'?String(b.nombre||'').localeCompare(String(a.nombre||''),'es'):String(a.nombre||'').localeCompare(String(b.nombre||''),'es'));
 return arr;
}
function renderSpecialists(){
 const host=$('specialistsSummary'),status=$('specialistsStatus'),rows=segFiltered();host.replaceChildren();
 const table=document.createElement('table');table.className='um-table';table.style.cssText='width:100%;border-collapse:collapse;font-size:13px;min-width:1050px';
 const headers=['Especialista','DNI','Correo','IGED','Cargo','Habilitado','Perfil','Registros','Enviados','Borradores','Última actividad'];
 const tr=table.createTHead().insertRow();for(const h of headers){const th=document.createElement('th');th.textContent=h;th.style.cssText='padding:9px;border-bottom:2px solid #ccd8e5;text-align:left';tr.append(th)}
 const body=table.createTBody();for(const r of rows){const tr=body.insertRow();const values=[r.nombre,r.dni,r.correo,r.iged,r.cargo,r.habilitado?'Sí':'No',r.tiene_perfil?'Sí':'No',r.registros,r.enviados,r.borradores,r.ultima_actividad?new Date(r.ultima_actividad).toLocaleString('es-PE'):'Sin registros'];for(const v of values){const td=tr.insertCell();td.textContent=String(v??'');td.style.cssText='padding:9px;border-bottom:1px solid #e3eaf1'}}
 host.append(table);const active=rows.filter(x=>Number(x.registros)>0).length;
 status.textContent=`Mostrando ${rows.length} de ${specialistsRows.length} especialistas · ${active} con registros · ${rows.length-active} sin registros`;
}
async function refreshSpecialists(){
 const status=$('specialistsStatus');status.textContent='Consultando registros...';
 const {data,error}=await db.rpc('piloto_admin_especialistas_resumen');
 if(error){status.textContent='No se pudo cargar: '+error.message+' · Ejecute 09_REPORTE_ESPECIALISTAS_ADMIN.sql en Supabase.';return;}
 specialistsRows=data||[];renderSpecialists();
}
for(const id of ['segBuscar','segIged','segEstado','segOrden']){if($(id))$(id).addEventListener(id==='segBuscar'?'input':'change',renderSpecialists)}
if($('refreshSpecialists'))$('refreshSpecialists').onclick=refreshSpecialists;
if($('exportSpecialists'))$('exportSpecialists').onclick=()=>{
 const filtered=segFiltered();if(!filtered.length){alert('No hay especialistas para exportar.');return;}
 if(typeof XLSX==='undefined'){alert('No se cargó la biblioteca de Excel.');return;}
 const rows=filtered.map(r=>({'Especialista':r.nombre,'DNI':r.dni,'Correo':r.correo,'IGED':r.iged,'Cargo':r.cargo,'Habilitado':r.habilitado?'Sí':'No','Perfil registrado':r.tiene_perfil?'Sí':'No','Registros':r.registros,'Enviados':r.enviados,'Borradores':r.borradores,'Última actividad':r.ultima_actividad?new Date(r.ultima_actividad).toLocaleString('es-PE'):''}));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Especialistas');XLSX.writeFile(wb,'ERLA_2026_Seguimiento_Filtrado.xlsx');
};
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
 const {data,error}=await db.rpc('piloto_es_admin');
 const isAdmin=!error&&data===true;
 $('adminPanel').classList.add('hide');
 if(isAdmin){specialistHideModules();document.body.classList.add('erla-admin-active');adminGo('adminHome');}
 else {adminHideModules();specialistGo('app');}
 if(!isAdmin)await Promise.all([refreshMine(),refreshReleaseRequests(),misSeccionesCargar()]);
 if(isAdmin){for(const fn of [refreshAdmin,refreshAdminReleases,refreshSpecialists,umRefresh]){try{await fn()}catch(e){console.warn('Módulo administrativo no disponible:',e)}}}
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

// Gestión administrativa de usuarios: solo visible si piloto_es_admin() autoriza.
let umUsers=[];
const umStatus=t=>{$('umStatus').textContent=t};
async function umCall(action,payload={}){
 const {data:{session}}=await db.auth.getSession();
 if(!session)throw new Error('La sesión expiró. Ingrese nuevamente.');
 const {data,error}=await db.functions.invoke('erla-admin-users',{body:{action,...payload}});
 if(error){let detail='';try{const context=error.context;if(context?.json){const body=await context.json();detail=body?.error||body?.detail||'';}}catch{}throw new Error(detail||error.message||'No se pudo conectar con el servicio');}
 if(data?.error)throw new Error(data.error);
 return data;
}
function umClear(){ $('umForm').reset();$('umId').value='';$('umActive').checked=true;$('umFormTitle').textContent='Nuevo especialista';$('umSave').textContent='Crear especialista y generar clave';umStatus('');}
function umRender(){
 const q=$('umSearch').value.trim().toLocaleLowerCase('es');
 const rows=umUsers.filter(u=>[u.name,u.email,u.dni,u.iged].some(x=>String(x||'').toLocaleLowerCase('es').includes(q)));
 $('umRows').replaceChildren();$('umCount').textContent=rows.length+' de '+umUsers.length+' usuarios';
 for(const u of rows){
  const tr=document.createElement('tr');
  for(const value of [u.name||'Sin nombre',u.email,u.dni||'—',u.iged||'—',u.active?'Habilitado':'Deshabilitado']){const td=tr.insertCell();td.textContent=value||'—';tr.append(td)}
  const td=tr.insertCell(),btn=document.createElement('button');btn.type='button';btn.className='secondary';btn.textContent='Editar';btn.onclick=()=>{
   $('umId').value=u.id;$('umName').value=u.name||'';$('umDni').value=u.dni||'';$('umEmail').value=u.email||'';$('umIged').value=u.iged||'DRELM';$('umCelular').value=u.celular||'';$('umCargo').value=u.cargo||'';$('umActive').checked=u.active;
   $('umFormTitle').textContent='Editar especialista';$('umSave').textContent='Guardar cambios';$('umForm').scrollIntoView({behavior:'smooth',block:'center'});
  };
  td.append(btn);
  const reset=document.createElement('button');
  reset.type='button';reset.className='secondary';reset.textContent='Restablecer clave';
  reset.style.marginLeft='6px';
  reset.onclick=async()=>{
    reset.disabled=true;umStatus('Generando nueva contraseña...');
    try{
      const result=await umCall('reset_password',{id:u.id});
      if(!result.temporary_password)throw Error('El servidor no devolvió la contraseña.');
      const old=document.getElementById('umCredentialPanel');if(old)old.remove();
      const panel=document.createElement('section');panel.id='umCredentialPanel';panel.className='um-credential-panel';
      const title=document.createElement('h3');title.textContent='✓ Nueva clave generada';panel.append(title);
      const note=document.createElement('p');note.textContent='Copia los datos y entrégalos únicamente al titular. Esta clave se muestra una sola vez.';panel.append(note);
      for(const [label,value] of [['Usuario / correo',result.email||u.email],['Nueva contraseña',result.temporary_password]]){
        const wrap=document.createElement('div');wrap.className='um-credential-row';
        const caption=document.createElement('label');caption.textContent=label;
        const line=document.createElement('div');line.className='um-credential-line';
        const input=document.createElement('input');input.type='text';input.readOnly=true;input.value=value;input.setAttribute('aria-label',label);
        const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='Copiar';
        copy.onclick=async()=>{try{await navigator.clipboard.writeText(value);copy.textContent='Copiado ✓';}catch{input.focus();input.select();umStatus('Seleccionado. Presiona Ctrl+C para copiar.');}};
        line.append(input,copy);wrap.append(caption,line);panel.append(wrap);
      }
      const close=document.createElement('button');close.type='button';close.className='secondary';close.textContent='Ocultar contraseña';close.onclick=()=>panel.remove();panel.append(close);
      $('umStatus').after(panel);panel.scrollIntoView({behavior:'smooth',block:'nearest'});
      umStatus('Clave restablecida para '+(result.email||u.email)+'.');
    }catch(err){umStatus('No se restableció: '+err.message);}finally{reset.disabled=false;}
  };
  td.append(reset);
  const remove=document.createElement('button');
  remove.type='button';remove.className='secondary';remove.textContent='Eliminar';
  remove.style.marginLeft='6px';remove.style.color='#b42318';
  remove.onclick=async()=>{
    const typed=prompt('ELIMINAR USUARIO\nEsta acción es irreversible. Si tiene evaluaciones, el sistema impedirá eliminarlo.\n\nEscriba el correo exacto para confirmar:\n'+u.email);
    if(typed===null)return;
    if(typed.trim().toLowerCase()!==String(u.email||'').trim().toLowerCase()){
      umStatus('Eliminación cancelada: el correo no coincide.');return;
    }
    if(!confirm('¿CONFIRMA la eliminación de '+u.email+'? No se puede deshacer.'))return;
    remove.disabled=true;umStatus('Verificando registros y eliminando usuario...');
    try{
      const result=await umCall('delete_user',{id:u.id,confirm_email:u.email});
      umStatus('Usuario eliminado: '+result.email);await umRefresh();
      umStatus('Usuario eliminado: '+result.email);await refreshSpecialists();
    }catch(err){umStatus('No se eliminó: '+err.message);}
    finally{remove.disabled=false;}
  };
  td.append(remove);$('umRows').append(tr);
 }
}
async function umRefresh(){umStatus('Cargando usuarios...');try{const result=await umCall('list');umUsers=result.users||[];umRender();umStatus('Usuarios actualizados.')}catch(e){umStatus('Error: '+e.message)}}
$('umRefresh').onclick=umRefresh;$('umSearch').oninput=umRender;$('umCancel').onclick=umClear;
$('umForm').onsubmit=async e=>{e.preventDefault();const btn=$('umSave'),id=$('umId').value;
 const payload={id,name:$('umName').value.trim(),dni:$('umDni').value.trim(),email:$('umEmail').value.trim().toLowerCase(),iged:$('umIged').value,celular:$('umCelular').value.trim(),cargo:$('umCargo').value.trim(),active:$('umActive').checked};
 if(!/^\d{8}$/.test(payload.dni))return umStatus('El DNI debe tener 8 dígitos.');if(payload.celular&&!/^\d{9}$/.test(payload.celular))return umStatus('El celular debe tener 9 dígitos.');
 if(!confirm(id?'¿Guardar las modificaciones de este usuario?':'¿Crear usuario y generar una clave inicial de 8 caracteres?'))return;
 btn.disabled=true;umStatus('Guardando...');try{const result=await umCall(id?'update':'create',{user:payload});umClear();await umRefresh();if(!id&&result.temporary_password){umStatus('Usuario creado. Clave inicial (copie y entregue en privado): '+result.temporary_password);alert('Usuario creado. CLAVE INICIAL (se muestra una sola vez): '+result.temporary_password+'\nCorreo: '+payload.email+'\nEntregue estos datos de forma privada.');}else{umStatus(id?'Usuario actualizado.':'Usuario creado.');}await refreshSpecialists();}catch(err){umStatus('No se guardó: '+err.message)}finally{btn.disabled=false}
};


// Consolidador administrativo: lectura exclusivamente a través de Edge Function protegida.
const conItems=[...Array.from({length:23},(_,i)=>`C1-${String(i+1).padStart(2,'0')}`),...Array.from({length:23},(_,i)=>`C2-${String(i+1).padStart(2,'0')}`)];
let conRows=[],conCols=[],conPage=0;
const conStatus=t=>{$('conEstado').textContent=t};
const conPlain=v=>v===null||v===undefined?'':String(v);
function conFiltered(){
 const val=id=>$(id)?.value||'';
 const esp=val('conEspecialista'),ugel=val('conUgel'),grado=val('conGrado'),seccion=val('conSeccion'),ie=val('conIE'),estado=val('conEstadoFiltro');
 const q=val('conBuscar').trim().toLocaleLowerCase('es');
 return conRows.filter(r=>(!esp||r.correo_especialista===esp)&&(!ugel||r.ugel===ugel)&&(!grado||String(r.grado||'')===grado)&&(!seccion||String(r.seccion||'')===seccion)&&(!ie||String(r.cod_mod||r.nombre_ie||'')===ie)&&(!estado||String(r.estado||'')===estado)&&(!q||[r.nombre_especialista,r.correo_especialista,r.dni_especialista,r.registrador,r.nombre_completo,r.dni,r.codigo_estudiante,r.nombre_ie,r.cod_mod,r.grado,r.seccion,r.ugel,r.area].some(v=>conPlain(v).toLocaleLowerCase('es').includes(q))));
}
function conIndicadores(){
 const host=$('conIndicadores');if(!host)return;host.replaceChildren();const rows=conFiltered();
 const sent=rows.filter(r=>String(r.estado||'').toUpperCase()==='ENVIADO').length;
 const values=[['Filas filtradas',rows.length],['Enviadas',sent],['Sin enviar',rows.length-sent],['Especialistas',new Set(rows.map(r=>r.correo_especialista).filter(Boolean)).size]];
 for(const [name,value] of values){const card=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=name;strong.textContent=value.toLocaleString('es-PE');card.append(small,strong);host.append(card)}
}

function conOptions(id,vals){const el=$(id),old=el.value;el.length=1;for(const v of [...new Set(vals.filter(Boolean))].sort())el.add(new Option(v,v));if([...el.options].some(o=>o.value===old))el.value=old}
function conDraw(){const rows=conFiltered(),pages=Math.max(1,Math.ceil(rows.length/25));conPage=Math.max(0,Math.min(conPage,pages-1));const thead=$('conTabla').querySelector('thead'),tbody=$('conTabla').querySelector('tbody');thead.replaceChildren();tbody.replaceChildren();const tr=document.createElement('tr');for(const col of [...['nombre_especialista','correo_especialista','nombre_ie','grado','seccion','area','estado'],...conCols.filter(x=>!['nombre_especialista','correo_especialista','nombre_ie','grado','seccion','area','estado'].includes(x))]){const th=document.createElement('th');th.textContent=col;tr.append(th)}thead.append(tr);for(const row of rows.slice(conPage*25,(conPage+1)*25)){const tr=document.createElement('tr');for(const col of [...['nombre_especialista','correo_especialista','nombre_ie','grado','seccion','area','estado'],...conCols.filter(x=>!['nombre_especialista','correo_especialista','nombre_ie','grado','seccion','area','estado'].includes(x))]){const td=document.createElement('td');td.textContent=conPlain(row[col]);tr.append(td)}tbody.append(tr)}$('conPagina').textContent=`Página ${conPage+1} de ${pages} · ${rows.length} filas`;conIndicadores();}
async function conLoad(){conStatus('Consultando registros y respuestas...');$('conCargar').disabled=true;try{conRows=[];conCols=[];for(let page=0;page<10000;page++){const result=await umCall('consolidado',{page});conRows.push(...(result.rows||[]));if(!conCols.length)conCols=result.columns||[];conStatus(`Consultando registros y respuestas... ${conRows.length} filas`);if(!result.has_more)break;if(page===9999)throw Error('Se alcanzó el límite de páginas.');}conOptions('conEspecialista',conRows.map(r=>r.correo_especialista));conOptions('conUgel',conRows.map(r=>r.ugel));for(const [id,key] of [['conGrado','grado'],['conSeccion','seccion'],['conIE','cod_mod'],['conEstadoFiltro','estado']])conOptions(id,conRows.map(r=>key==='cod_mod'?(r.cod_mod||r.nombre_ie):r[key]));conPage=0;conDraw();conStatus(`${conRows.length} filas consultadas. Cada fila corresponde a un estudiante y evaluación; incluye los campos existentes y sus 46 respuestas.`)}catch(e){conStatus('No se pudo consultar: '+e.message)}finally{$('conCargar').disabled=false}}
function conExport(total){if(!conRows.length)return alert('Primero pulse Consultar consolidado.');if(!window.XLSX)return alert('No se pudo cargar la biblioteca Excel.');const rows=total?conRows:conFiltered();if(!rows.length)return alert('No hay filas con esos filtros.');const ws=XLSX.utils.json_to_sheet(rows.map(r=>Object.fromEntries(conCols.map(k=>[k,r[k]??'']))),{header:conCols});ws['!cols']=conCols.map(c=>({wch:c.length>20?25:15}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Consolidado');XLSX.writeFile(wb,total?'ERLA_2026_CONSOLIDADO_GENERAL.xlsx':'ERLA_2026_CONSOLIDADO_FILTRADO.xlsx')}
$('conCargar').onclick=conLoad;$('conEspecialista').onchange=()=>{conPage=0;conDraw()};$('conUgel').onchange=()=>{conPage=0;conDraw()};$('conBuscar').oninput=()=>{conPage=0;conDraw()};for(const id of ['conGrado','conSeccion','conIE','conEstadoFiltro'])$(id).onchange=()=>{conPage=0;conDraw()};$('conAnterior').onclick=()=>{conPage--;conDraw()};$('conSiguiente').onclick=()=>{conPage++;conDraw()};$('conExcel').onclick=()=>conExport(false);$('conExcelTotal').onclick=()=>conExport(true);

// Navegación independiente del administrador: reutiliza todos los formularios y consultas existentes.
const adminModuleIds=['adminHome','usersPanel','consolidadoModule','metasPanel','trackingPanel','adminPanel','app','requestPanel'];
function adminHideModules(){document.body.classList.remove('erla-admin-active');for(const id of ['adminHome','usersPanel','consolidadoModule','metasPanel','trackingPanel','adminPanel'])document.getElementById(id)?.classList.add('hide');document.getElementById('adminNav')?.classList.add('hide')}
function adminGo(id){if(!adminModuleIds.includes(id))return;if($('adminNav').classList.contains('hide') && !document.body.classList.contains('erla-admin-active'))return;document.body.classList.add('erla-admin-active');for(const key of adminModuleIds){document.getElementById(key)?.classList.toggle('hide',key!==id)}document.querySelectorAll('[data-admin-go]').forEach(b=>b.classList.toggle('active',b.dataset.adminGo===id));document.getElementById('adminNav')?.classList.remove('hide');window.scrollTo({top:0,behavior:'smooth'})}
document.querySelectorAll('[data-admin-go]').forEach(b=>b.addEventListener('click',()=>adminGo(b.dataset.adminGo)));

// Navegación exclusiva del especialista: nunca mostrar módulos administrativos.
function specialistHideModules(){
  document.getElementById('specialistNav')?.classList.add('hide');
}
function specialistGo(id){
  if(!['app','requestPanel'].includes(id))return;
  adminHideModules();
  const nav=document.getElementById('specialistNav');
  nav?.classList.remove('hide');
  for(const section of ['app','requestPanel'])document.getElementById(section)?.classList.toggle('hide',section!==id);
  document.querySelectorAll('[data-specialist-go]').forEach(btn=>btn.classList.toggle('active',btn.dataset.specialistGo===id));
  window.scrollTo({top:0,behavior:'smooth'});
}
document.querySelectorAll('[data-specialist-go]').forEach(btn=>btn.addEventListener('click',()=>specialistGo(btn.dataset.specialistGo)));


// Resumen de metas ERLA: se consulta con autorización administrativa en Edge Function.
let metasData=null;
const metasText=(id,value)=>{const el=$(id);if(el)el.textContent=value;};
function metasChart(id,rows,label){
 const host=$(id);if(!host)return;host.replaceChildren();
 if(!rows.length){host.textContent='No hay datos para los filtros seleccionados.';return;}
 for(const r of rows.slice(0,30)){
  const pct=r.total?Math.min(100,Math.max(0,100*r.enviadas/r.total)):0;
  const line=document.createElement('div');line.className='erla-bar-row';
  const name=document.createElement('span');name.className='erla-bar-name';name.textContent=r.name;name.title=r.name;
  const track=document.createElement('div');track.className='erla-bar-track';track.setAttribute('role','progressbar');track.setAttribute('aria-label',r.name);track.setAttribute('aria-valuenow',String(pct.toFixed(1)));track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
  const fill=document.createElement('div');fill.className='erla-bar-fill';fill.style.width=pct+'%';track.append(fill);
  const value=document.createElement('span');value.textContent=pct.toFixed(1)+' %';value.title=`${r.enviadas} de ${r.total} secciones/áreas enviadas`;
  line.append(name,track,value);host.append(line);
  const detail=document.createElement('small');detail.textContent=`${r.enviadas} de ${r.total} secciones/áreas enviadas · ${label}`;host.append(detail);
 }
 if(rows.length>30){const more=document.createElement('small');more.textContent=`Mostrando los primeros 30 de ${rows.length}. Utilice los filtros para precisar.`;host.append(more);}
}
function metasGroup(rows,key){
 const groups=new Map();for(const r of rows){const name=String(key(r)||'Sin dato');if(!groups.has(name))groups.set(name,{name,meta:0,registrados:0,enviadas:0,total:0});const v=groups.get(name);v.meta+=Number(r.meta)||0;v.registrados+=Number(r.registrados)||0;v.enviadas+=r.enviado?1:0;v.total++;}
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{numeric:true}));
}
function metasRender(){
 if(!metasData)return;
 const all=metasData.secciones||[];
 const ugel=$('metasUgel').value,area=$('metasArea').value,grado=$('metasGrado').value,ie=$('metasIE').value;
 const sections=all.filter(r=>(!ugel||r.ugel===ugel)&&(!area||r.area===area)&&(!grado||r.grado===grado)&&(!ie||r.cod_mod+'|'+r.nombre_ie===ie));
 const total=sections.reduce((a,x)=>a+(Number(x.meta)||0),0),evaluated=sections.reduce((a,x)=>a+(Number(x.registrados)||0),0),sent=sections.filter(x=>x.enviado).length;
 metasText('metasTotal',total.toLocaleString('es-PE'));metasText('metasRegistrados',sent.toLocaleString('es-PE'));
 metasText('metasPendientes',(sections.length-sent).toLocaleString('es-PE'));metasText('metasPorcentaje',sections.length?(100*sent/sections.length).toFixed(1)+' %':'0 %');
 metasText('metasEnviadas',`${sent} de ${sections.length} secciones/áreas enviadas. ${evaluated} registros estudiante-área con respuestas guardadas (no necesariamente enviados).`);
 const groups=metasGroup(sections,r=>r.ugel);
 metasChart('metasGraficoUgel',groups,'envíos confirmados');metasChart('metasGraficoArea',metasGroup(sections,r=>r.area),'envíos confirmados');
 metasChart('metasGraficoGrado',metasGroup(sections,r=>r.grado),'envíos confirmados');metasChart('metasGraficoIE',metasGroup(sections,r=>r.nombre_ie+' · '+r.cod_mod),'envíos confirmados');
 const makeRows=(id,rows,mapper)=>{const body=$(id);body.replaceChildren();for(const row of rows){const tr=body.insertRow();for(const value of mapper(row)){const td=tr.insertCell();td.textContent=String(value);}}if(!rows.length){const tr=body.insertRow();const td=tr.insertCell();td.colSpan=id==='metasUgelRows'?6:9;td.textContent='Sin datos';}};
 makeRows('metasUgelRows',groups,r=>[r.name,r.meta,r.registrados,Math.max(0,r.meta-r.registrados),r.meta?(100*r.registrados/r.meta).toFixed(1)+' %':'0 %',r.enviadas+' / '+r.total]);
 const q=$('metasBuscar').value.trim().toLocaleLowerCase('es');
 const filtered=sections.filter(r=>[r.ugel,r.nombre_ie,r.cod_mod,r.nivel,r.grado,r.seccion,r.area].some(x=>String(x||'').toLocaleLowerCase('es').includes(q)));
 makeRows('metasSeccionRows',filtered,r=>[r.ugel,r.nombre_ie,r.grado,r.seccion,r.area,r.meta,r.registrados,r.meta?(100*r.registrados/r.meta).toFixed(1)+' %':'0 %',r.enviado?'ENVIADO':r.registrados?'EN REGISTRO':'PENDIENTE']);
 metasText('metasEstado',filtered.length+' secciones/áreas mostradas. El avance principal corresponde a envíos confirmados, no a borradores.');
}
async function metasLoad(){const btn=$('metasActualizar');btn.disabled=true;metasText('metasEstado','Consultando nóminas y respuestas...');try{
 const data=await umCall('metas');metasData=data;
 const sel=$('metasUgel');const selected=sel.value;sel.replaceChildren();const opt=document.createElement('option');opt.value='';opt.textContent='Todas las UGEL';sel.append(opt);
 for(const name of [...new Set((data.secciones||[]).map(x=>x.ugel))].sort()){const o=document.createElement('option');o.value=name;o.textContent=name;sel.append(o);}sel.value=selected;
 const opts=[['metasArea','area','Todas las áreas'],['metasGrado','grado','Todos los grados']];
 for(const [id,key,label] of opts){const el=$(id),before=el.value;el.replaceChildren();el.add(new Option(label,''));for(const name of [...new Set((data.secciones||[]).map(r=>String(r[key]||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es',{numeric:true})))el.add(new Option(name,name));el.value=before;}
 const ieEl=$('metasIE'),oldIE=ieEl.value;ieEl.replaceChildren();ieEl.add(new Option('Todas las instituciones',''));
 for(const [value,label] of [...new Map((data.secciones||[]).map(r=>[r.cod_mod+'|'+r.nombre_ie,r.nombre_ie+' · '+r.cod_mod])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'es')))ieEl.add(new Option(label,value));ieEl.value=oldIE;
 metasRender();
 }catch(e){metasText('metasEstado','Error: '+e.message);}finally{btn.disabled=false;}}
$('metasActualizar').onclick=metasLoad;
for(const id of ['metasUgel','metasArea','metasGrado','metasIE'])$(id).onchange=metasRender;$('metasBuscar').oninput=metasRender;
$('metasExcel').onclick=()=>{if(!metasData){metasText('metasEstado','Primero consulta las metas.');return;}const rows=(metasData.secciones||[]).filter(r=>(!$('metasUgel').value||r.ugel===$('metasUgel').value)&&(!$('metasArea').value||r.area===$('metasArea').value)&&(!$('metasGrado').value||r.grado===$('metasGrado').value)&&(!$('metasIE').value||r.cod_mod+'|'+r.nombre_ie===$('metasIE').value)&&[r.ugel,r.nombre_ie,r.cod_mod,r.nivel,r.grado,r.seccion,r.area].some(x=>String(x||'').toLocaleLowerCase('es').includes($('metasBuscar').value.trim().toLocaleLowerCase('es')))).map(r=>({'UGEL':r.ugel,'Código modular':r.cod_mod,'Institución educativa':r.nombre_ie,'Nivel':r.nivel,'Grado':r.grado,'Sección':r.seccion,'Área':r.area,'Meta estudiantes':r.meta,'Registrados':r.registrados,'Pendientes':Math.max(0,r.meta-r.registrados),'Avance %':r.meta?+(100*r.registrados/r.meta).toFixed(1):0,'Estado':r.enviado?'ENVIADO':r.registrados?'EN REGISTRO':'PENDIENTE'}));if(!rows.length)return;const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Metas por sección');XLSX.writeFile(wb,'ERLA_2026_METAS_SECCIONES.xlsx');};
