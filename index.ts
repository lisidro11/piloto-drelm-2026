import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://lisidro11.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
]);
const allowedIged = new Set([
  "DRELM",
  ...Array.from({ length: 7 }, (_, i) => `UGEL ${String(i + 1).padStart(2, "0")}`),
]);
const norm = (value: unknown) => String(value ?? "").trim();
const emailNorm = (value: unknown) => norm(value).toLowerCase();
const emailValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const uuidValid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const password = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const result: string[] = [];
  const limit = 256 - (256 % alphabet.length);
  while (result.length < 8) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const n of bytes) {
      if (n < limit) result.push(alphabet[n % alphabet.length]);
      if (result.length === 8) break;
    }
  }
  return result.join("");
};

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const permitted = !origin || allowedOrigins.has(origin);
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && permitted) corsHeaders["Access-Control-Allow-Origin"] = origin;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return new Response(null, { status: permitted ? 204 : 403, headers: corsHeaders });
  if (!permitted) return reply({ error: "Origen no autorizado" }, 403);
  if (req.method !== "POST") return reply({ error: "Método no permitido" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return reply({ error: "Falta configuración del servidor" }, 500);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "Inicie sesión" }, 401);
    const sessionClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authError } = await sessionClient.auth.getUser(token);
    if (authError || !user) return reply({ error: "Sesión no válida" }, 401);
    const { data: isAdmin, error: roleError } = await sessionClient.rpc("piloto_es_admin");
    if (roleError || isAdmin !== true) {
      return reply({ error: "Acceso reservado al administrador" }, 403);
    }

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let body: Record<string, unknown>;
    try {
      body = await req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("JSON inválido");
    } catch {
      return reply({ error: "El cuerpo debe ser un JSON válido" }, 400);
    }
    const action = norm(body.action);

    if (action === "list") {
      const authUsers: Array<{ id: string; email?: string; user_metadata?: Record<string, unknown> }> = [];
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        authUsers.push(...data.users);
        if (data.users.length < 100) break;
      }
      const { data: allowed, error: allowError } = await admin.from("piloto_autorizados").select("correo,activo");
      if (allowError) throw allowError;
      const { data: profiles, error: profileError } = await admin.from("piloto_especialistas").select("usuario_id,dni,nombre,correo,celular,cargo");
      if (profileError) throw profileError;
      const profileById = new Map((profiles ?? []).map((p) => [p.usuario_id, p]));
      const allowedByEmail = new Map((allowed ?? []).map((a) => [emailNorm(a.correo), a]));
      return reply({ users: authUsers.map((u) => {
        const p = profileById.get(u.id);
        return {
          id: u.id,
          email: u.email,
          name: p?.nombre ?? u.user_metadata?.nombre ?? "",
          dni: p?.dni ?? u.user_metadata?.dni ?? "",
          celular: p?.celular ?? "",
          cargo: p?.cargo ?? "",
          iged: u.user_metadata?.iged ?? "",
          active: allowedByEmail.get(emailNorm(u.email))?.activo === true,
        };
      }) });
    }

    if (action === "metas") {
      // Solo accesible tras validar el JWT y el rol de administrador.
      async function fetchAll(table: string, fields: string) {
        const all: Record<string, unknown>[] = [];
        for (let offset = 0; offset < 200000; offset += 1000) {
          const { data, error } = await admin.from(table).select(fields).range(offset, offset + 999);
          if (error) throw error;
          all.push(...(data ?? []));
          if (!data || data.length < 1000) return all;
        }
        throw new Error(`Límite de filas alcanzado en ${table}`);
      }
      const insts = await fetchAll("instituciones", "id,ugel,cod_mod,nombre_ie,nivel,grado,seccion");
      const students = await fetchAll("estudiantes", "id,institucion_id");
      const regs = await fetchAll("registros", "id,institucion_id,area,estado");
      const answers = await fetchAll("respuestas", "registro_id,estudiante_id");
      const studentSet = new Map<string, Set<string>>();
      for (const s of students) {
        const key = String(s.institucion_id ?? "");
        if (!studentSet.has(key)) studentSet.set(key, new Set());
        studentSet.get(key)!.add(String(s.id));
      }
      const byReg = new Map<string, Set<string>>();
      for (const a of answers) {
        const key = String(a.registro_id ?? "");
        if (!byReg.has(key)) byReg.set(key, new Set());
        byReg.get(key)!.add(String(a.estudiante_id));
      }
      const bySection = new Map<string, { registrados: Set<string>; enviado: boolean }>();
      for (const r of regs) {
        const key = `${r.institucion_id}::${r.area}`;
        if (!bySection.has(key)) bySection.set(key, { registrados: new Set(), enviado: false });
        const item = bySection.get(key)!;
        for (const id of byReg.get(String(r.id)) ?? []) {
          if (studentSet.get(String(r.institucion_id))?.has(id)) item.registrados.add(id);
        }
        if (r.estado === "ENVIADO") item.enviado = true;
      }
      // Si una sección todavía no tiene registros, mostrar igualmente su meta.
      const areas = [...new Set(regs.map(r => String(r.area ?? "")).filter(Boolean))].sort();
      const sections = [];
      for (const inst of insts) {
        const sectionAreas = [...new Set(regs.filter(r => String(r.institucion_id) === String(inst.id)).map(r => String(r.area ?? "")).filter(Boolean))];
        for (const area of sectionAreas.length ? sectionAreas : areas.length ? areas : ["Sin área definida"]) {
          const key = `${inst.id}::${area}`;
          const status = bySection.get(key);
          sections.push({ ugel: String(inst.ugel ?? ""), cod_mod: String(inst.cod_mod ?? ""), nombre_ie: String(inst.nombre_ie ?? ""),
            nivel: String(inst.nivel ?? ""), grado: String(inst.grado ?? ""), seccion: String(inst.seccion ?? ""), area,
            meta: studentSet.get(String(inst.id))?.size ?? 0, registrados: status?.registrados.size ?? 0, enviado: status?.enviado ?? false });
        }
      }
      return reply({ secciones: sections });
    }

    if (action === "consolidado") {
      // Lectura exclusiva para el administrador, validado antes de este bloque.
      const page = Number(body.page ?? 0);
      if (!Number.isInteger(page) || page < 0 || page > 100000) return reply({ error: "Página no válida" }, 400);
      const pageSize = 30;
      const { data: registros, error: regError } = await admin.from("registros")
        .select("*").order("creado_en", { ascending: false })
        .order("id", { ascending: true }).range(page * pageSize, (page + 1) * pageSize - 1);
      if (regError) throw regError;
      const regs = registros ?? [];
      const items = [...Array.from({ length: 23 }, (_, i) => `C1-${String(i + 1).padStart(2, "0")}`),
        ...Array.from({ length: 23 }, (_, i) => `C2-${String(i + 1).padStart(2, "0")}`)];
      const baseColumns = ["registro_id", "estudiante_id", "codigo_estudiante", "apellido_paterno", "apellido_materno", "nombres", "nombre_completo", "dni", "correo_especialista", "nombre_especialista", "ugel", "cod_mod", "nombre_ie", "nivel", "grado", "seccion", "area", "estado", "fecha_aplicacion", "fecha_envio", "usuario_id", "registrador", "celular", "cargo", "creado_en"];
      const columns = [...baseColumns, ...items];
      if (!regs.length) return reply({ rows: [], columns, has_more: false, next_page: page + 1 });
      const regIds = regs.map(r => r.id);
      const answers: Record<string, unknown>[] = [];
      // La API PostgREST suele limitar a 1000 filas; leer todas las respuestas de cada bloque.
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from("respuestas").select("registro_id,estudiante_id,item,respuesta")
          .in("registro_id", regIds).order("id").range(offset, offset + 999);
        if (error) throw error;
        answers.push(...(data ?? []));
        if (!data || data.length < 1000) break;
        if (offset >= 100000) return reply({ error: "Demasiadas respuestas para este bloque; reduzca el tamaño de página" }, 413);
      }
      const studentIds = [...new Set(answers.map(a => a.estudiante_id).filter(v => v !== null && v !== undefined))];
      const instIds = [...new Set(regs.map(r => r.institucion_id).filter(v => v !== null && v !== undefined))];
      const { data: students, error: stuError } = studentIds.length
        ? await admin.from("estudiantes").select("*").in("id", studentIds)
        : { data: [], error: null };
      if (stuError) throw stuError;
      const { data: institutions, error: instError } = instIds.length
        ? await admin.from("instituciones").select("*").in("id", instIds)
        : { data: [], error: null };
      if (instError) throw instError;
      const { data: profiles, error: profError } = await admin.from("piloto_especialistas")
        .select("usuario_id,nombre,correo").in("usuario_id", [...new Set(regs.map(r => r.usuario_id).filter(Boolean))]);
      if (profError) throw profError;
      const stMap = new Map((students ?? []).map(s => [String(s.id), s]));
      const instMap = new Map((institutions ?? []).map(i => [String(i.id), i]));
      const profMap = new Map((profiles ?? []).map(p => [String(p.usuario_id), p]));
      const regMap = new Map(regs.map(r => [String(r.id), r]));
      const rowMap = new Map<string, Record<string, unknown>>();
      for (const a of answers) {
        const r = regMap.get(String(a.registro_id));
        if (!r) continue;
        const key = `${a.registro_id}::${a.estudiante_id}`;
        let row = rowMap.get(key);
        if (!row) {
          const s = stMap.get(String(a.estudiante_id)) ?? {};
          const inst = instMap.get(String(r.institucion_id)) ?? {};
          const prof = profMap.get(String(r.usuario_id)) ?? {};
          row = Object.fromEntries(columns.map(c => [c, ""]));
          Object.assign(row, {
            registro_id: r.id, estudiante_id: a.estudiante_id,
            codigo_estudiante: s.codigo_estudiante ?? "", apellido_paterno: s.apellido_paterno ?? "",
            apellido_materno: s.apellido_materno ?? "", nombres: s.nombres ?? "",
            nombre_completo: [s.apellido_paterno, s.apellido_materno, s.nombres].filter(Boolean).join(" "),
            dni: "", correo_especialista: r.correo ?? prof.correo ?? "",
            nombre_especialista: prof.nombre ?? r.registrador ?? "",
            ugel: inst.ugel ?? "", cod_mod: inst.cod_mod ?? "", nombre_ie: inst.nombre_ie ?? "",
            nivel: inst.nivel ?? "", grado: inst.grado ?? "", seccion: inst.seccion ?? "",
            area: r.area ?? "", estado: r.estado ?? "", fecha_aplicacion: r.fecha_aplicacion ?? "",
            fecha_envio: r.fecha_envio ?? "", usuario_id: r.usuario_id ?? "",
            registrador: r.registrador ?? "", celular: r.celular ?? "", cargo: r.cargo ?? "", creado_en: r.creado_en ?? "",
          });
          rowMap.set(key, row);
        }
        const item = String(a.item ?? "").trim().toUpperCase();
        if (items.includes(item)) row[item] = a.respuesta ?? "";
      }
      return reply({ rows: [...rowMap.values()], columns, has_more: regs.length === pageSize, next_page: page + 1 });
    }

    if (action === "reset_password") {
      const id = norm(body.id);
      if (!uuidValid(id)) return reply({ error: "ID de usuario no válido" }, 400);
      const { data: found, error: getError } = await admin.auth.admin.getUserById(id);
      if (getError || !found.user) return reply({ error: "Usuario no encontrado" }, 404);
      const targetEmail = emailNorm(found.user.email);
      if (!targetEmail) return reply({ error: "El usuario no tiene correo válido" }, 400);
      // Proteger las cuentas administrativas frente a restablecimientos accidentales.
      const { data: adminAccount, error: adminAccountError } = await admin.from("piloto_admins")
        .select("correo").ilike("correo", targetEmail).eq("activo", true).maybeSingle();
      if (adminAccountError) return reply({ error: "No se pudo verificar el rol administrativo" }, 500);
      if (adminAccount || targetEmail === "lisidro@drelm.gob.pe") {
        return reply({ error: "Por seguridad, las claves de administradores se recuperan por el flujo de recuperación de Supabase." }, 403);
      }
      const temporaryPassword = password() + password();
      const { error: resetError } = await admin.auth.admin.updateUserById(id, {
        password: temporaryPassword,
      });
      if (resetError) return reply({ error: "No se pudo restablecer la contraseña: " + resetError.message }, 400);
      return reply({ ok: true, email: targetEmail, temporary_password: temporaryPassword,
        message: "Contraseña restablecida; entregue la clave en privado. La contraseña anterior dejó de funcionar." });
    }

    if (action === "delete_user") {
      const id = norm(body.id);
      const confirmation = emailNorm(body.confirm_email);
      if (!uuidValid(id) || !emailValid(confirmation)) return reply({ error: "Datos de confirmación inválidos" }, 400);
      if (id === user.id) return reply({ error: "No puede eliminar su propia cuenta" }, 403);
      const { data: found, error: findError } = await admin.auth.admin.getUserById(id);
      if (findError || !found.user) return reply({ error: "Usuario no encontrado" }, 404);
      const targetEmail = emailNorm(found.user.email);
      if (targetEmail !== confirmation) return reply({ error: "El correo de confirmación no coincide" }, 400);
      if (targetEmail === "lisidro@drelm.gob.pe") return reply({ error: "La cuenta administradora principal está protegida" }, 403);
      const { data: adminAccount, error: roleCheckError } = await admin.from("piloto_admins")
        .select("correo").ilike("correo", targetEmail).eq("activo", true).maybeSingle();
      if (roleCheckError) return reply({ error: "No se pudo comprobar si el usuario es administrador" }, 500);
      if (adminAccount) return reply({ error: "No se permite eliminar administradores activos" }, 403);
      // No borrar cuentas con evaluaciones ni borradores; conservar la trazabilidad.
      const { count, error: recordError } = await admin.from("registros")
        .select("id", { count: "exact", head: true }).eq("usuario_id", id);
      if (recordError) return reply({ error: "No se pudo comprobar si tiene evaluaciones: " + recordError.message }, 500);
      if ((count ?? 0) > 0) return reply({ error: `Este usuario tiene ${count} registro(s) asociado(s). Desactívelo en lugar de eliminarlo.` }, 409);
      // Supabase Auth aplica las FK: si existen otras referencias, la eliminación falla sin borrar datos.
      const { error: deleteError } = await admin.auth.admin.deleteUser(id);
      if (deleteError) return reply({ error: "No se eliminó la cuenta: " + deleteError.message + ". Puede desactivarla." }, 409);
      // El perfil se elimina por FK ON DELETE CASCADE. Limpiar autorización solo después de Auth.
      const { error: allowedError } = await admin.from("piloto_autorizados")
        .delete().ilike("correo", targetEmail);
      if (allowedError) return reply({ ok: false, partial: true, error: "Cuenta eliminada, pero quedó la autorización. Revise el correo en piloto_autorizados: " + allowedError.message }, 409);
      return reply({ ok: true, email: targetEmail, message: "Cuenta eliminada. No se borraron evaluaciones." });
    }

    if (action !== "create" && action !== "update") return reply({ error: "Acción desconocida" }, 400);
    const input = body.user;
    if (!input || typeof input !== "object" || Array.isArray(input)) return reply({ error: "Faltan datos del usuario" }, 400);
    const fields = input as Record<string, unknown>;
    const name = norm(fields.name);
    const dni = norm(fields.dni);
    const email = emailNorm(fields.email);
    const iged = norm(fields.iged);
    const active = fields.active !== false;
    // La ficha maestra es OPCIONAL: nunca bloquear altas por no figurar en ella.
    // Solo el servidor con service-role puede consultar la ficha de cualquier correo.
    const { data: master, error: masterError } = await admin.from("erla_especialistas_maestro")
      .select("celular,cargo").ilike("correo", email).maybeSingle();
    if (masterError) return reply({ error: "No se pudo consultar la ficha maestra: " + masterError.message }, 500);
    const inputCelular = norm(fields.celular);
    const inputCargo = norm(fields.cargo);

    if (!name || !/^\d{8}$/.test(dni) || !emailValid(email) || !allowedIged.has(iged)) {
      return reply({ error: "Revise nombre, DNI (8 dígitos), correo e IGED" }, 400);
    }
    const { data: existingAllowed, error: lookupError } = await admin.from("piloto_autorizados")
      .select("correo").ilike("correo", email).maybeSingle();
    if (lookupError) throw lookupError;

    if (action === "create") {
      if (existingAllowed) return reply({ error: "Correo ya autorizado" }, 409);
      const celular = inputCelular || norm(master?.celular);
      const cargo = inputCargo || norm(master?.cargo);
      if (!/^\d{9}$/.test(celular) || !cargo) return reply({
        error: "Complete celular (9 dígitos) y cargo. Si el especialista no está en la tabla maestra, ingrese ambos datos manualmente."
      }, 400);

      const temporaryPassword = password();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password: temporaryPassword, email_confirm: true,
        user_metadata: { nombre: name, dni, iged, must_change_password: false },
      });
      if (createError || !created.user) return reply({ error: createError?.message ?? "No se creó la cuenta" }, 400);
      const newId = created.user.id;
      const { error: allowError } = await admin.from("piloto_autorizados").insert({ correo: email, activo: active });
      if (allowError) {
        const { error: cleanupError } = await admin.auth.admin.deleteUser(newId);
        return reply({ error: "Falló la autorización; revise el estado antes de reintentar", cleanup_failed: !!cleanupError }, 409);
      }
      const { error: profileError } = await admin.from("piloto_especialistas")
        .insert({ usuario_id: newId, dni, nombre: name, correo: email, celular, cargo });
      if (profileError) {
        await admin.from("piloto_autorizados").delete().eq("correo", email);
        const { error: cleanupError } = await admin.auth.admin.deleteUser(newId);
        return reply({ error: "Falló el perfil; revise el estado antes de reintentar", cleanup_failed: !!cleanupError }, 409);
      }
      return reply({ ok: true, id: newId, temporary_password: temporaryPassword,
        must_change_password: false, message: "Cuenta creada; entregar la clave individualmente" });
    }

    const id = norm(fields.id);
    if (!uuidValid(id)) return reply({ error: "Identificador de usuario no válido" }, 400);
    const { data: found, error: getError } = await admin.auth.admin.getUserById(id);
    if (getError || !found.user) return reply({ error: "Usuario no encontrado" }, 404);
    const oldEmail = emailNorm(found.user.email);
    const { data: oldProfile, error: oldProfileError } = await admin.from("piloto_especialistas")
      .select("celular,cargo").eq("usuario_id", id).maybeSingle();
    if (oldProfileError) return reply({ error: oldProfileError.message }, 500);
    const celular = inputCelular || norm(oldProfile?.celular) || norm(master?.celular);
    const cargo = inputCargo || norm(oldProfile?.cargo) || norm(master?.cargo);
    if (!/^\d{9}$/.test(celular) || !cargo) return reply({ error: "Complete celular (9 dígitos) y cargo." }, 400);
    const { data: adminAccount, error: adminAccountError } = await admin.from("piloto_admins")
      .select("correo,activo").ilike("correo", oldEmail).eq("activo", true).maybeSingle();
    if (adminAccountError) return reply({ error: adminAccountError.message }, 500);
    if (adminAccount && (email !== oldEmail || !active)) return reply({ error: "No se puede cambiar el correo ni deshabilitar a un administrador activo. Retire primero su rol administrativo de forma segura." }, 403);

    if (oldEmail === "lisidro@drelm.gob.pe" && (email !== oldEmail || !active)) {
      return reply({ error: "No se puede cambiar o desactivar la cuenta administradora principal" }, 403);
    }
    if (email !== oldEmail && existingAllowed) return reply({ error: "El correo nuevo ya está autorizado" }, 409);
    if (email !== oldEmail) {
      const { error: prepError } = await admin.from("piloto_autorizados").insert({ correo: email, activo: active });
      if (prepError) return reply({ error: "No se pudo preparar el nuevo correo", detail: prepError.message }, 409);
    }
    const { error: updateError } = await admin.auth.admin.updateUserById(id, {
      email,
      user_metadata: { ...found.user.user_metadata, nombre: name, dni, iged },
    });
    if (updateError) {
      if (email !== oldEmail) await admin.from("piloto_autorizados").delete().eq("correo", email);
      return reply({ error: updateError.message }, 400);
    }
    const { error: profileError } = await admin.from("piloto_especialistas")
      .update({ correo: email, nombre: name, dni, celular, cargo }).eq("usuario_id", id);
    if (profileError) return reply({ error: "Authentication actualizado, pero falta sincronizar el perfil. No repita la operación; revise el usuario.", detail: profileError.message }, 409);
    if (email === oldEmail) {
      const { error: activeError } = await admin.from("piloto_autorizados").update({ activo: active }).eq("correo", oldEmail);
      if (activeError) return reply({ error: "Perfil actualizado, pero no se pudo cambiar el estado", detail: activeError.message }, 409);
    } else {
      const { error: removeError } = await admin.from("piloto_autorizados").delete().eq("correo", oldEmail);
      if (removeError) return reply({ error: "Correo actualizado, pero falta retirar la autorización anterior", detail: removeError.message }, 409);
    }
    return reply({ ok: true, id, email });
  } catch (e) {
    console.error("erla-admin-users request failed", e);
    return reply({ error: e instanceof Error ? e.message : "Error inesperado" }, 500);
  }
});
