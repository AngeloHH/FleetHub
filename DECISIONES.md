# Decisiones

Las que estaban abiertas en la lista de producción y ya no lo están. Cada una
dice qué se decidió, por qué, y qué haría falta para cambiarla — que es lo que
un registro de decisiones tiene que dejar por escrito y casi nunca deja.

## Face ID se retira hasta que exista de verdad

**Decidido:** quitar el interruptor «Entrar con Face ID» de la pantalla D, el
campo `faceId` del alta y la columna del usuario.

**Por qué:** no había nada detrás. El interruptor prometía entrar con la cara y
lo único que hacía era recordar que alguien lo había encendido; no existe
ninguna biometría en la aplicación a la que estuviera conectado. Un control que
promete lo que no hace es peor que no tenerlo: quien lo enciende cree que su
cuenta quedó protegida de otra forma, y no quedó.

**Qué haría falta para volver a ponerlo:** implementarlo con passkeys y
WebAuthn, que es como se hace esto en un navegador. Eso no es un interruptor
sino un registro de credencial —`navigator.credentials.create` en el alta,
`get` en el acceso—, una tabla de credenciales por cuenta, y una forma de
recuperar la cuenta cuando el aparato con la credencial se pierde. Es una
funcionalidad, no una casilla.

## HEIC y HEIF no se aceptan en el servidor

**Decidido:** `POST /api/vehicles/:vin/photos` admite JPEG, PNG y WebP, y
contesta `415` a HEIC y HEIF.

**Por qué:** de los tres formatos admitidos se pueden retirar los metadatos
—EXIF, XMP, comentarios— releyendo su estructura, sin decodificar la imagen. De
HEIC no: es un contenedor ISOBMFF y quitarle los metadatos con garantías exige
decodificarlo. Guardar una foto de iPhone con su EXIF intacto es publicar dónde
estaba quien la tomó.

**Por qué no rompe nada:** la aplicación nunca envía un HEIC. La cámara pasa por
un `canvas` que reescala a 1280 px y exporta JPEG, y ese paso ya borra los
metadatos por su cuenta. Un iPhone que sube una foto HEIC de su carrete la
decodifica el navegador antes de que salga del aparato.

**Qué haría falta para admitirlo:** una biblioteca de decodificación HEIF en el
servidor y reencodear a JPEG al recibirlo. Merece la pena sólo si aparece un
cliente que no sea esta aplicación.

## El producto es explícitamente online

**Decidido:** no hay modo sin conexión. `offlineMode()` devuelve `false` siempre,
la aplicación limpia la preferencia de builds anteriores para que ningún aparato
quede encerrado, el acceso local con contraseña se retiró, y `flushUnsynced`
contesta que la sincronización sin conexión llegará más adelante en lugar de
fingir que subió algo.

En el perfil sigue habiendo un interruptor, y está bien que lo haya: la fila
informa de algo que o está o no está. Lo que cambia es que está deshabilitado
de verdad —`aria-disabled`, sin foco y sin controlador— en lugar de dejarse
pulsar sin obedecer. Lo mismo vale para «Cámara y GPS»: encendido es «los dos
concedidos», y no se puede cambiar desde ahí porque los permisos los da el
navegador y no la aplicación.

**Por qué:** offline-first de verdad es una cola de escrituras con
identificadores generados en el aparato, resolución de conflictos y reintentos
—no una balda local que se lee al arrancar. Lo que había era lo segundo con el
nombre de lo primero, y eso produce la peor versión de las dos: alguien trabaja
media hora sin cobertura convencido de que se está guardando.

**Qué haría falta:** la cola, y la base de datos debajo para poder resolver
conflictos con algo mejor que «gana el último». Va después de PostgreSQL.

## El acceso de soporte lo concede el servidor

**Decidido:** `/api/grants` abre y cierra las ventanas de soporte. Mientras una
está abierta, la sesión de esa cuenta de FleetHub trabaja *dentro* de la empresa
que la concedió y con lo que puede administración.

**Por qué:** antes la ventana la fabricaba el navegador después de gastar la
llave y vivía sólo en su balda local. Cualquiera podía inventarse una
autorización que en el servidor no constaba, y lo que en el servidor no consta
no manda. Ahora dura ocho horas escritas en la fila, se cierra sola, queda en el
registro y la puede cerrar antes cualquiera de las dos partes.

**Lo que la ventana no presta:** borrar la compañía. Eso lo decide quien la
administra desde su propia cuenta y nadie más.

## Quién es de FleetHub lo dice la configuración

**Decidido:** una cuenta es de soporte si su correo está en
`FLEETHUB_STAFF_EMAILS`. La marca `staff` dejó de ser un campo del alta y
tampoco se lee de una fila almacenada.

**Por qué:** si `staff` viajara en el cuerpo de un registro público, cualquiera
podría declararse soporte y pedir después una ventana a la empresa que
quisiera. Al vivir en la configuración del servicio, añadir a alguien es un
despliegue y no un formulario — la misma ceremonia que una llave de API.

## Guardar es guardar-si-nadie-escribió-antes

**Decidido:** el estado lleva una revisión. El almacén local la compara antes de
escribir y el de Netlify usa el ETag con `onlyIfMatch`. Quien llega tarde recibe
`409 WRITE_CONFLICT` y el cliente reintenta.

**Por qué:** el estado de una empresa es un solo objeto. Entre leerlo y
guardarlo hay esperas —decodificar un VIN, pedir una ruta— durante las que otra
petición entra, lee lo mismo y guarda primero. Sin comprobación, la segunda en
guardar borraba a la primera y nadie se enteraba. Un `409` es incómodo y es la
verdad.

**Lo que esto no es:** una transacción. Sigue habiendo un único objeto y sigue
sin haber aislamiento entre operaciones. Eso es lo que trae PostgreSQL; lo que
esto arregla es que dejar de perder escrituras no tenía por qué esperar tanto.

## El proveedor de tiles se configura o el build de producción se para

**Decidido:** sin `VITE_TILE_URL`, `vite build` avisa; con `CONTEXT=production`,
falla. Se puede desplegar así a propósito con
`FLEETHUB_ALLOW_PUBLIC_TILES=true`.

**Por qué:** el servidor público de OpenStreetMap sirve bien la copia de
desarrollo y su política de uso excluye expresamente producción. Un aviso en un
registro de build que nadie lee es la forma habitual de que esto llegue vivo a
producción, y el primer síntoma es que a alguien le bloquean el dominio.

## Los códigos no vuelven en la respuesta

**Decidido:** un código dirigido a un correo o un teléfono viaja al cliente sólo
si `ALLOW_INSECURE_AUTH_CODES=true`, que es exclusivamente para desarrollo
local. En producción se entrega por el canal configurado, y si no hay canal la
operación se rechaza en lugar de fingir que se envió.

**Por qué:** devolver el código en la respuesta convierte «pide un código para
ese correo» en «entra en esa cuenta». Que la opción exista y esté apagada es
mejor que no existir: sin ella, el flujo no se puede probar en local y acaba
probándose en producción.

## Los proveedores de fuera tienen tope

**Decidido:** Geoapify y el decodificador de VIN se cuentan por día contra un
tope configurable. Al 80 % se avisa una sola vez; agotado, la llamada no se hace
y la respuesta es `429` con un mensaje propio.

**Por qué:** se cobran por petición y se agotan por día. Sin contador, el primer
aviso de que se acabó el plan es que la aplicación deja de encontrar direcciones
un martes por la tarde; sin tope, un bucle en un cliente se gasta el mes de la
empresa en una hora. Y una negativa nuestra se puede explicar; un error ajeno
no.
