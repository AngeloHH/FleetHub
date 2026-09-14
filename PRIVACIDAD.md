# Privacidad, retención y eliminación de datos

Qué guarda FleetHub, por qué, durante cuánto tiempo, quién puede verlo y cómo
se borra. Está escrito contra el código: cada plazo y cada frontera de este
documento corresponde a una regla que existe en el servidor y que las pruebas
comprueban. Si algo cambia en el código y no cambia aquí, el documento está
mal — no al revés.

> **Antes de una beta con datos reales.** Este texto describe el sistema, no lo
> sustituye a efectos legales. La política que se publica a los usuarios debe
> revisarla quien responda jurídicamente por el producto, decidir el
> responsable del tratamiento y la base legal, y publicarse en un sitio al que
> la aplicación enlace. Ese paso —revisión y publicación— es el único que queda
> pendiente de esta parte.

## Qué se guarda

### De las personas

| Dato | Para qué | De dónde sale |
| --- | --- | --- |
| Nombre completo | Identificar quién firmó cada movimiento | Lo escribe la persona al registrarse |
| Correo electrónico | Entrar, recuperar la cuenta, recibir códigos | Lo escribe la persona |
| Teléfono con prefijo | Lo mismo, cuando se prefiere el SMS | Lo escribe la persona |
| Idioma | Elegir en qué idioma se le habla | Lo escribe la persona |
| Rol y puesto | Decidir qué puede hacer | Lo asigna administración |
| Suspensión | Retirar el acceso sin borrar el historial | Lo asigna administración, o la propia persona |
| Derivación de la contraseña | Comprobar la contraseña sin conservarla | Se calcula al escribirla |
| Fechas de alta, cambio y cambio de contraseña | Auditoría | Las pone el servidor |

La contraseña **no** se guarda. Lo que se guarda es su derivación PBKDF2-SHA256
en formato PHC, con sal propia por cuenta, y de ella no se puede volver a la
contraseña. Una copia robada de la base de datos no es una lista de contraseñas.

Los códigos de un solo uso tampoco se guardan en claro: se guarda su derivación
junto con la del destinatario, de modo que en la tabla no queda escrito a quién
se le mandó ningún código.

### De las unidades

VIN, marca, modelo, año, versión, carrocería, motor y estado. Todo eso es de la
unidad y no de una persona.

### Lo que sí es de una persona aunque hable de una unidad

- **Posiciones GPS.** Coordenadas, precisión, hora y quién las reportó. Es el
  dato más delicado del sistema: encadenado en el tiempo describe por dónde
  anduvo alguien, no sólo dónde estuvo un coche. Por eso es el que menos dura.
- **Eventos.** Qué se hizo, cuándo y quién lo hizo.
- **Fotografías.** Se limpian antes de guardarse (ver abajo).
- **Alertas dadas por atendidas.** Quién la vio y cuándo.
- **Accesos de soporte.** Qué cuenta de FleetHub entró en qué empresa y hasta
  cuándo.

### Lo que no se guarda

- No hay analítica, ni cookies de terceros, ni identificadores publicitarios.
- No hay rastreo continuo: la posición se toma cuando alguien escanea o reporta,
  nunca en segundo plano.
- El navegador no guarda nada de la empresa después de cerrar sesión: se borra
  la balda local entera, la sesión y el token.

## Quién puede ver qué

Cuatro fronteras, en este orden:

1. **La compañía.** Cada fila lleva el UUID de su compañía y toda lectura y
   modificación filtra por él. Ninguna petición puede leer, tocar ni cruzar
   nada de otra compañía; hay pruebas que montan dos compañías completas y lo
   comprueban una por una.
2. **El rol.** `VISITANTE` sólo ve; `OPERADOR` escanea y modifica unidades;
   `ADMINISTRADOR` además edita personas y ubicaciones. Una cuenta suspendida no
   puede nada.
3. **La ubicación.** Dentro de una compañía, una persona ve las unidades de las
   ubicaciones activas que tiene asignadas. Esto vale también para
   administración: un vehículo en una ubicación que no comparte no aparece.
4. **La ventana de soporte.** Una cuenta de FleetHub sólo entra en una empresa
   si esa empresa emite una llave de soporte y alguien la gasta. Dura ocho
   horas, se cierra sola, queda registrada y la puede cerrar antes tanto quien
   la tiene como quien administra la empresa. Ni siquiera con ella se puede
   borrar la compañía.

## Cuánto dura cada cosa

Nada se borra por antigüedad. Los datos se guardan hasta que alguien los borra:
no hay barrido automático ni plazos configurables.

Las sesiones, los códigos de verificación y los contadores de límite por IP
dejan de valer al vencer —su fecha se comprueba en cada uso, y una caducada se
rechaza— pero sus filas se quedan hasta que se borra la compañía.

Las cuentas, las unidades, las ubicaciones y las compañías **no** caducan: se
borran cuando alguien decide borrarlas.

## Fotografías y metadatos

Un archivo de cámara trae escrito mucho más que la unidad: dónde se tomó, con
qué aparato y a veces con qué número de serie. Antes de guardar nada, el
servidor quita EXIF, XMP y los comentarios de JPEG, PNG y WebP, y comprueba las
medidas sin descomprimir la imagen. Se rechaza lo que pesa más de 8 MiB, lo que
pasa de 12 000 píxeles por lado o de 40 megapíxeles, y lo que dice ser de un
tipo y es de otro.

HEIC y HEIF no se aceptan. Son contenedores cuyos metadatos no se pueden retirar
sin decodificarlos, y guardar una foto de iPhone con su EXIF intacto es publicar
dónde estaba quien la tomó. La aplicación nunca envía una: la cámara pasa por un
lienzo y lo que sube es siempre JPEG.

## Borrar

### Una persona

`DELETE /api/users/:id`, desde administración de su compañía. Desaparecen su
nombre, su correo, su teléfono, sus asignaciones y sus accesos de soporte, y se
cierran todas sus sesiones.

Lo que queda es su UUID en los hechos que firmó: qué unidad se escaneó, cuándo y
por quién. Es un identificador que ya no lleva a ninguna persona —la fila que lo
explicaba no está— y es lo que hace que el historial de una unidad siga siendo
un historial y no un hueco. Quien necesite borrarlo también tiene que borrar la
compañía.

### Una compañía entera

```
DELETE /api/companies/current?confirm=<companyId>
```

Sólo quien administra esa compañía, y desde su propia cuenta. El `confirm` con
el UUID delante está para que nadie lo haga con un clic de más. Se van sus
cuentas, unidades, ubicaciones, asignaciones, posiciones, eventos, fotos —fila y
archivo—, alertas, accesos de soporte, llaves y sesiones. Lo que queda después
no es una compañía vacía: es que esa compañía no está.

No hay deshacer y no hay papelera. Antes de ejecutarlo conviene tener una copia
de seguridad si la empresa quiere conservar algo.

### Todo, en desarrollo

Borrar `server/almacen.json` y `server/fotos/`. En Netlify, los almacenes
`fleethub-data*` y `fleethub-photos*` del contexto correspondiente.

## Terceros

Tres servicios externos ven algo, y sólo lo que se dice aquí:

- **Geoapify** — recibe el texto de la dirección que alguien está escribiendo y
  las coordenadas de los puntos de una ruta. No recibe ni cuentas, ni VIN, ni
  sesión. La llave vive en el servidor y nunca llega al navegador.
- **NHTSA vPIC** — recibe un VIN para decodificarlo. No recibe nada más.
- **El proveedor de tiles del mapa** — recibe las peticiones de los cuadros del
  mapa, que revelan aproximadamente qué zona se está mirando. Qué proveedor sea
  y qué política tenga lo decide quien despliega, con `VITE_TILE_URL`.

Si se configuran, **Sentry** o el webhook de avisos reciben errores del
servidor. Lo que sale por ahí no lleva secretos: los tokens, contraseñas y
códigos salen marcados como `[oculto]` y los correos reducidos a su dominio.

El proveedor de correo o SMS que entregue los códigos recibirá el destinatario y
el código. Es el único tercero que ve una dirección completa, y es su razón de
existir.

## Registros del servidor

Una línea JSON por petición: método, ruta, código de respuesta y milisegundos.
Sin cuerpo, sin cabeceras, sin quién. Los guarda la plataforma con su propia
política de retención, que hay que revisar al elegirla.

## Si algo se filtra

Está en [`OPERATIONS.md`](./OPERATIONS.md), en «Rotación de secretos»: se revoca
primero la credencial comprometida y después se busca el reemplazo. Notificar a
las personas afectadas y a la autoridad que corresponda es una decisión legal y
no técnica, y no puede improvisarse el día que pasa.
