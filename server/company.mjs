// A qué empresa pertenece cada fila.
//
// FleetHub es multiempresa y esa frontera es la única que separa a un cliente
// de otro: se cruza comparando el identificador de empresa de dos filas. Ahí
// estuvo el fallo. En JavaScript `null === null` es cierto, así que dos filas
// que no declaraban empresa se tomaban por compañeras, y una cuenta huérfana
// podía administrar a otra cuenta huérfana. Filas sin empresa las produce la
// migración de la versión 13 cuando hay más de una compañía y una fila no se
// puede atribuir a ninguna.
//
// La regla es entonces: sin empresa declarada no hay parentesco. Callar no es
// coincidir, y ante la duda la guarda se cierra.
//
// Esto también protege del cambio de nombre que trae la base de datos: si un
// día una fila llega con `company_id` en vez de `companyId`, la comparación da
// `undefined` contra `undefined` y sin esta regla volvería a abrirse sola.

/** Si dos filas son de la misma empresa. Falso si alguna de las dos no lo dice. */
export const sameCompany = (a, b) => Boolean(a) && a === b
