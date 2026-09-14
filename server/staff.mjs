// Quién es de FleetHub y quién es de la empresa que usa FleetHub.
//
// No es un rol ni un nivel: es de qué lado de la aplicación está la cuenta, y
// eso no puede decidirlo nadie desde una petición. Si `staff` viajara en el
// cuerpo de un alta, cualquiera que se registre podría declararse soporte y
// pedir después una ventana a la empresa que quisiera.
//
// Por eso vive en la configuración del servicio: una lista de correos que
// opera quien despliega, con la misma ceremonia que una llave de API. Añadir a
// alguien es un despliegue, no un formulario.

const parse = (value) =>
  new Set(
    String(value ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )

/** La lista configurada, ya normalizada. */
export const staffEmails = (value = process.env.FLEETHUB_STAFF_EMAILS) => parse(value)

/**
 * Si una cuenta es de FleetHub.
 *
 * La propiedad almacenada `staff` se ignora deliberadamente: únicamente la
 * lista privada configurada por quien despliega puede conceder esta identidad.
 */
export function isStaff(user, emails = staffEmails()) {
  if (!user) return false
  return emails.has(String(user.email ?? '').trim().toLowerCase())
}
