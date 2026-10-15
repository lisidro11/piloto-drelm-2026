import {SUPABASE_URL,SUPABASE_ANON_KEY} from './config.js';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
const $=id=>document.getElementById(id), db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
const fields=[['ugel','UGEL'],['ie','Institución educativa'],['nivel','Nivel'],['area','Área'],['grado','Grado'],['seccion','Sección'],['fecha','Fecha de aplicación','date']];
const items=[...Array.from({length:23},(_,i)=>'C1-'+String(i+1).padStart(2,'0')),...Array.from({length:23},(_,i)=>'C2-'+String(i+1).padStart(2,'0'))];
let catalog=[],students=[],answers={},activeRecord=null,locked=false,loading=false,profile=null,currentUser=null;
const v=id=>$(id).value, setStatus=t=>$('status').textContent=t;
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
const head=document.createElement('tr');for(const title of ['N.º','Código de estudiante','Apellido paterno','Apellido materno','Nombres',...items]){const th=document.createElement('th');th.textContent=title;head.append(th)}$('sheet').append(head);
function count(){$('counter').textContent=students.length+' estudiantes en la sección';$('answered').textContent=Object.values(answers).filter(Boolean).length+' respuestas ingresadas'}
function draw(){const table=$('sheet');table.querySelectorAll('tr:not(:first-child)').forEach(x=>x.remove());students.forEach((s,i)=>{const tr=document.createElement('tr');for(const val of [i+1,s.codigo_estudiante,s.apellido_paterno,s.apellido_materno,s.nombres]){let td=document.createElement('td');td.textContent=val??'';tr.append(td)}for(const item of items){const td=document.createElement('td'),sel=document.createElement('select'),key=s.id+'|'+item;sel.dataset.key=key;for(const opt of ['','A','B','C','D','99'])sel.add(new Option(opt||'—',opt));sel.value=answers[key]||'';sel.disabled=locked;sel.addEventListener('change',()=>{answers[key]=sel.value;count()});td.append(sel);tr.append(td)}table.append(tr)});$('save').disabled=locked;$('send').disabled=locked;count()}
async function loadSection(){const serial=++requestSerial;students=[];answers={};activeRecord=null;locked=false;draw();if(!v('seccion')||!v('area')){setStatus('Seleccione área y sección.');return}const entry=subset(group)[0];if(!entry)return;setStatus('Verificando sección y cargando nómina...');
const [statusResult,studentResult]=await Promise.all([db.rpc('piloto_estado',{p_institucion_id:entry.id,p_area:v('area')}),db.from('estudiantes').select('id,codigo_estudiante,apellido_paterno,apellido_materno,nombres').eq('institucion_id',entry.id).order('apellido_paterno').order('apellido_materno')]);
if(serial!==requestSerial)return;
if(statusResult.error||studentResult.error){setStatus('No se pudo consultar Supabase: '+(statusResult.error||studentResult.error).message);return}
students=studentResult.data||[];const state=statusResult.data||{};
if(state.estado==='ENVIADO'){locked=true;draw();setStatus('Esta sección ya tiene un registro enviado para '+v('area')+'. No se permite registrar nuevamente.');return}
if(state.estado==='EN REGISTRO'){activeRecord=state.id;$('fecha').value=state.fecha_aplicacion||'';for(const r of state.respuestas||[])answers[r.estudiante_id+'|'+r.item]=r.respuesta;setStatus('Se recuperó su avance guardado. Puede continuar.');}
else{$('fecha').value=new Date().toLocaleDateString('en-CA');setStatus('Nómina cargada. Complete sus datos y registre las respuestas.');}
draw();}
function rows(){return students.flatMap(s=>items.map(item=>({estudiante_id:s.id,item,respuesta:answers[s.id+'|'+item]})).filter(x=>x.respuesta))}
function validate(){if(!students.length)throw Error('Seleccione una sección con estudiantes.');for(const k of ['ugel','ie','nivel','area','grado','seccion','fecha'])if(!v(k))throw Error('Complete '+k+'.');if(!profile?.nombre||!profile?.dni||!profile?.correo)throw Error('Primero complete su perfil de especialista.');}
async function persist(final){if(loading)return;try{validate();if(final&&rows().length!==students.length*items.length)throw Error('Faltan respuestas. Use 99 para no respondió.');loading=true;$('save').disabled=$('send').disabled=true;setStatus('Guardando en Supabase...');const entry=subset(group)[0];const payload={p_id:activeRecord,p_institucion_id:entry.id,p_area:v('area'),p_registrador:profileValue('nombre'),p_correo:profileValue('correo'),p_celular:profileValue('celular'),p_cargo:profileValue('cargo'),p_fecha_aplicacion:v('fecha'),p_enviar:final,p_respuestas:rows()};const {data,error}=await db.rpc('guardar_piloto',payload);if(error)throw error;activeRecord=data;locked=final;draw();setStatus(final?'Registro enviado correctamente. ID: '+data:'Avance guardado en Supabase. ID: '+data);}catch(e){setStatus('No se guardó: '+e.message)}finally{loading=false;if(!locked)$('save').disabled=$('send').disabled=false}}
$('save').onclick=()=>persist(false);$('send').onclick=()=>{if(confirm('¿Enviar registro final? Ya no podrá modificarlo.'))persist(true)};
function csv(rows,name){if(!rows.length){alert('No hay respuestas para exportar');return}const keys=Object.keys(rows[0]),q=x=>'"'+String(x??'').replaceAll('"','""')+'"';const txt='\ufeff'+[keys.map(q).join(';'),...rows.map(r=>keys.map(k=>q(r[k])).join(';'))].join('\r\n');const url=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('csv').onclick=()=>csv(rows().map(x=>({registro:activeRecord||'',codigo_estudiante:students.find(s=>s.id===x.estudiante_id)?.codigo_estudiante,item:x.item,respuesta:x.respuesta})),'respuestas_piloto_drelm.csv');
$('clear').onclick=()=>{if(!confirm('¿Limpiar formulario? Los registros guardados en Supabase se conservarán.'))return;for(const [id] of fields)$(id).value='';cascade('ugel');setStatus('Formulario limpio')};
async function init(){
 const {data:{session}}=await db.auth.getSession();currentUser=session?.user||null;
 $('authPanel').classList.toggle('hide',!!session);$('logout').classList.toggle('hide',!session);
 if(!session){$('app').classList.add('hide');$('profilePanel').classList.add('hide');return}
 const {data:pr,error:pe}=await db.from('piloto_especialistas').select('dni,nombre,correo,celular,cargo').eq('usuario_id',session.user.id).maybeSingle();
 if(pe){$('authPanel').classList.remove('hide');$('app').classList.add('hide');$('profilePanel').classList.add('hide');$('authStatus').textContent='Falta configurar la tabla de perfiles: '+pe.message;return}
 profile=pr; $('pCorreo').value=session.user.email||'';
 for(const [k,id] of [['dni','pDni'],['nombre','pNombre'],['celular','pCelular'],['cargo','pCargo']])$(id).value=pr?.[k]||'';
 $('profilePanel').classList.toggle('hide',!!pr);$('app').classList.toggle('hide',!pr);
 if(!pr)return;
 $('specialistBadge').textContent='Especialista: '+pr.nombre+' · DNI '+pr.dni;
 const {data,error}=await db.from('instituciones').select('id,ugel,cod_mod,nombre_ie,nivel,grado,seccion').order('ugel').limit(1000);
 if(error){$('app').classList.add('hide');$('authPanel').classList.remove('hide');$('authStatus').textContent='Acceso no habilitado: '+error.message;return}
 catalog=(data||[]).map(x=>({...x,ie:x.nombre_ie}));options('ugel',catalog.map(x=>x.ugel));setStatus('Seleccione UGEL e institución educativa.');
}
$('saveProfile').onclick=async()=>{
 const dni=v('pDni').trim(),nombre=v('pNombre').trim(),celular=v('pCelular').trim(),cargo=v('pCargo').trim();
 if(!/^\d{8}$/.test(dni))return $('profileStatus').textContent='Ingrese un DNI de 8 dígitos.';
 if(nombre.length<5||!/^\d{9}$/.test(celular)||!cargo)return $('profileStatus').textContent='Complete nombres y apellidos, celular de 9 dígitos y cargo.';
 $('saveProfile').disabled=true;$('profileStatus').textContent='Guardando datos del especialista...';
 try{const {error}=await db.from('piloto_especialistas').upsert({usuario_id:currentUser.id,dni,nombre,correo:currentUser.email,celular,cargo},{onConflict:'usuario_id'});if(error)throw error;await init()}
 catch(e){$('profileStatus').textContent='No se guardó: '+e.message}finally{$('saveProfile').disabled=false}
};
$('editProfile').onclick=()=>{$('app').classList.add('hide');$('profilePanel').classList.remove('hide')};
$('sendOtp').onclick=async()=>{const email=$('loginEmail').value.trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return alert('Escriba un correo válido.');$('sendOtp').disabled=true;$('authStatus').textContent='Enviando enlace de acceso al correo...';try{const {error}=await db.auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:location.origin+location.pathname}});if(error)throw error;$('authStatus').textContent='Revisa tu correo y abre el enlace de acceso. Si recibes un código numérico, también puedes ingresarlo aquí.';}catch(e){$('authStatus').textContent='No se pudo enviar el acceso: '+e.message}finally{$('sendOtp').disabled=false}};
$('verifyOtp').onclick=async()=>{const email=$('loginEmail').value.trim().toLowerCase(),token=$('otp').value.trim();if(!email||!token)return alert('Escriba su correo y el código recibido.');$('verifyOtp').disabled=true;try{const {error}=await db.auth.verifyOtp({email,token,type:'email'});if(error)throw error;await init()}catch(e){$('authStatus').textContent='No se pudo verificar el código: '+e.message}finally{$('verifyOtp').disabled=false}};
$('logout').onclick=async()=>{await db.auth.signOut();location.reload()};
db.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session){setTimeout(()=>init(),0)}else if(event==='SIGNED_OUT'){catalog=[];students=[];answers={};activeRecord=null;locked=false;$('app').classList.add('hide');$('authPanel').classList.remove('hide')}});
init();
