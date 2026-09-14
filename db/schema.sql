-- El esquema de FleetHub.
--
-- Se aplica entero y de una vez: no hay versiones ni pasos intermedios porque
-- la base nace con esta forma. Lo que hubo antes fue un unico documento JSON,
-- y de ahi se entra con `scripts/import-postgres.mjs`.
--
-- Tres reglas gobiernan todo lo que sigue.
--
-- La primera: la hora la manda la aplicacion. Ninguna columna lleva
-- `default now()`. Los sellos de tiempo salen de un reloj inyectable para que
-- las pruebas puedan viajar en el tiempo, y una base que ponga la suya rompe
-- eso sin avisar.
--
-- La segunda: la empresa es la frontera. Toda fila de negocio la lleva, y va
-- declarada como clave ajena para que la base la defienda aunque el codigo se
-- despiste.
--
-- La tercera: ordenar por fecha no basta. Dos filas del mismo milisegundo
-- empatan, asi que donde el orden es informacion --el historial de una unidad,
-- los usos de una llave-- hay una secuencia aparte que no empata nunca.

BEGIN;

CREATE TABLE companies (
  id         uuid PRIMARY KEY,
  created_at timestamptz NOT NULL
);

-- role es el nivel: 0 visitante, 1 operador, 2 administrador. El 3 de soporte
-- no cabe aqui a proposito -- soporte no es un rol que se conceda a una
-- cuenta, es una ventana temporal que vive en `grants`.
-- suspension guarda el motivo; NULL significa cuenta activa.
CREATE TABLE users (
  id                  uuid PRIMARY KEY,
  company_id          uuid NOT NULL REFERENCES companies (id),
  full_name           text NOT NULL,
  email               text NOT NULL UNIQUE,
  phone_code          text NOT NULL,
  phone               text NOT NULL UNIQUE,
  language            text NOT NULL,
  role                smallint NOT NULL CHECK (role BETWEEN 0 AND 2),
  suspension          text CHECK (suspension IN ('self', 'admin')),
  password            text NOT NULL,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL,
  password_changed_at timestamptz NOT NULL
);

-- points: los puntos de la ruta, en el orden en que se recorren.
-- Las columnas routing_* y las de distancia y duracion son el resultado
-- guardado del proveedor: NULL mientras no se haya calculado la ruta.
--
-- version sube en cada escritura. Es lo que impide que dos ediciones
-- simultaneas de los puntos se pisen: `points` es un documento entero y quien
-- llega segundo lo reescribiria completo, borrando lo del primero sin que
-- nadie se entere. Con la version, el segundo no toca ninguna fila y recibe el
-- mismo 409 de siempre.
CREATE TABLE locations (
  id                     uuid PRIMARY KEY,
  company_id             uuid NOT NULL REFERENCES companies (id),
  name                   text NOT NULL,
  points                 jsonb NOT NULL,
  active                 boolean NOT NULL,
  traffic_margin_percent smallint NOT NULL,
  distance_meters        integer,
  duration_seconds       integer,
  geometry               jsonb,
  routing_provider       text,
  routing_traffic        text,
  routing_calculated_at  timestamptz,
  version                integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL
);

-- El VIN solo es unico dentro de una empresa: dos empresas pueden tener el
-- mismo vehiculo en su flota y cada una lo ve como suyo. De ahi la clave
-- compuesta.
--
-- `text` con el alfabeto comprobado, nunca `char(17)`: char rellena con
-- espacios e ignora el relleno al comparar, asi que un VIN corto --que hoy no
-- casa con nada-- pasaria a casar con uno de verdad.
--
-- Y la comprobacion es el alfabeto, no la longitud: 'ABC' con catorce espacios
-- detras tambien mide diecisiete. El alfabeto del VIN no tiene I, ni O, ni Q
-- --se confunden con 1 y 0-- y es el mismo patron que aplica vehicles.mjs:13.
--
-- state es el identificador numerico del estado, tal como ya lo guarda el
-- codigo: 0 no encontrado, 1 en ruta, 2 con deposito, 3 en servicio, 4
-- vendido. NULL es una unidad recien dada de alta que todavia no lo tiene.
CREATE TABLE vehicles (
  vin           text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  company_id    uuid NOT NULL REFERENCES companies (id),
  state         smallint CHECK (state BETWEEN 0 AND 4),
  decode_status text,
  decoded_at    timestamptz,
  decoder       text,
  model_year    smallint,
  make          text,
  model         text,
  trim_level    text,
  body          text,
  engine        text,
  created_at    timestamptz NOT NULL,
  updated_at    timestamptz NOT NULL,
  PRIMARY KEY (company_id, vin)
);

-- id es "VIN:locationId": la unicidad de la asignacion vive en la clave
-- primaria, asi que asignar dos veces la misma unidad al mismo sitio no
-- duplica fila. route_started_at/by se rellenan cuando la ruta arranca, no al
-- asignar.
CREATE TABLE vehicle_locations (
  id               text PRIMARY KEY,
  company_id       uuid NOT NULL REFERENCES companies (id),
  vin              text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  location_id      uuid NOT NULL REFERENCES locations (id),
  assigned_at      timestamptz NOT NULL,
  assigned_by      uuid,
  route_started_at timestamptz,
  route_started_by uuid,
  updated_at       timestamptz
);

-- id es "userId:locationId", con el mismo criterio.
CREATE TABLE user_locations (
  id          text PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  location_id uuid NOT NULL REFERENCES locations (id),
  assigned_at timestamptz NOT NULL,
  assigned_by uuid
);

-- user_id no lleva clave ajena a proposito: el historial sobrevive a la cuenta
-- que lo firmo, y borrar a esa persona no debe fallar ni arrastrar sus
-- eventos. Lo que queda es un identificador que ya no resuelve a nadie, que es
-- justo lo que dice la politica de privacidad.
--
-- seq da el orden verdadero. `created_at` empata cuando dos eventos caen en el
-- mismo milisegundo, y en un historial el orden no es decoracion.
CREATE TABLE events (
  id             text PRIMARY KEY,
  seq            bigint GENERATED ALWAYS AS IDENTITY,
  company_id     uuid NOT NULL REFERENCES companies (id),
  vin            text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  user_id        uuid,
  kind           text NOT NULL,
  note           text NOT NULL,
  previous_state smallint,
  state          smallint,
  location_id    uuid,
  photos         text[] NOT NULL,
  created_at     timestamptz NOT NULL
);

-- accuracy en metros, tal cual la devuelve el dispositivo.
CREATE TABLE vehicle_positions (
  id          uuid PRIMARY KEY,
  company_id  uuid NOT NULL REFERENCES companies (id),
  vin         text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  accuracy    real,
  reported_by uuid,
  created_at  timestamptz NOT NULL
);

-- La imagen no vive aqui: esto es la ficha del fichero, que se guarda aparte
-- en el almacenamiento de objetos. Por eso borrar una foto son dos pasos, y el
-- orden importa -- primero confirmar la transaccion, despues borrar el objeto.
CREATE TABLE photos (
  id           text PRIMARY KEY,
  company_id   uuid NOT NULL REFERENCES companies (id),
  vin          text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  uploaded_by  uuid,
  content_type text NOT NULL,
  filename     text NOT NULL,
  width        integer NOT NULL,
  height       integer NOT NULL,
  bytes        integer NOT NULL,
  created_at   timestamptz NOT NULL
);

-- Alertas silenciadas. title conserva el texto que se descarto, para poder
-- repetirlo tal cual aunque la alerta haya cambiado desde entonces.
CREATE TABLE dismissals (
  id         text PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES companies (id),
  vin        text NOT NULL CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  alert_id   text NOT NULL,
  title      text NOT NULL,
  user_id    uuid,
  created_at timestamptz NOT NULL
);

-- Ventanas de acceso de soporte. ended_at/ended_by solo se rellenan si se
-- cierra antes de expires_at; una que se consume hasta el final se queda con
-- ended_at NULL.
CREATE TABLE grants (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies (id),
  code       text,
  granted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at   timestamptz,
  ended_by   uuid
);

-- Una sola tabla para todos los codigos, sea cual sea su proposito.
--
-- code guarda el codigo en claro cuando puede estarlo. Cuando va dirigido a
-- una direccion concreta se guarda en su lugar owner --la huella del
-- destinatario-- mas secret_salt y secret_hash, y el codigo no queda escrito
-- en ninguna parte: se comprueba derivandolo otra vez.
--
-- company_id admite NULL: una llave dirigida a una persona no pertenece a
-- ninguna empresa.
--
-- Las tres columnas registration_* son la reserva de alta: en que usuario se
-- convertira el codigo, con que resguardo se reclama, y cuando se reclamo.
CREATE TABLE tokens (
  id                      uuid PRIMARY KEY,
  purpose                 text NOT NULL,
  code                    text,
  tier                    smallint,
  company_id              uuid REFERENCES companies (id),
  owner                   text,
  secret_salt             text,
  secret_hash             text,
  tries_left              smallint NOT NULL,
  delegated_to            text,
  expires_at              timestamptz NOT NULL,
  revoked_at              timestamptz,
  revoked_by              uuid,
  created_by              uuid,
  created_at              timestamptz NOT NULL,
  registration_user_id    uuid,
  registration_receipt    text,
  registration_claimed_at timestamptz
);

-- Cada uso, su propia fila.
--
-- El borrador tenia la clave en (token_id, used_at), y eso hace que dos usos
-- del mismo milisegundo sean la misma fila: con el reloj de las pruebas, casi
-- siempre. seq da ademas el orden, que es lo que se audita.
CREATE TABLE token_uses (
  id       uuid PRIMARY KEY,
  seq      bigint GENERATED ALWAYS AS IDENTITY,
  token_id uuid NOT NULL REFERENCES tokens (id),
  used_at  timestamptz NOT NULL,
  used_by  uuid
);

-- password_reset marca la sesion que solo sirve para poner contrasena nueva.
CREATE TABLE sessions (
  token          text PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id),
  password_reset boolean NOT NULL,
  until          timestamptz NOT NULL
);

-- Contador por ventana: al pasar reset_at la fila se reinicia, no se acumula.
CREATE TABLE rate_limits (
  key      text PRIMARY KEY,
  count    integer NOT NULL,
  reset_at timestamptz NOT NULL
);

-- Cuantas veces se ha escrito esto.
--
-- Una sola fila, y siempre esta. Es lo que convierte "guardar" en "guardar si
-- nadie ha escrito entre medias": antes de escribir se toma bloqueada, y si el
-- numero no es el que se leyo, la peticion llego tarde y recibe el 409 de
-- siempre. Hace lo que hacia el ETag del blob, pero con la base decidiendo
-- quien llego primero en vez de un almacen de objetos.
CREATE TABLE store_revision (
  id       smallint PRIMARY KEY,
  revision bigint NOT NULL
);
INSERT INTO store_revision (id, revision) VALUES (1, 0);

-- Consumo diario por proveedor externo. warned recuerda que ya se aviso ese
-- dia, para no repetir el aviso en cada llamada.
CREATE TABLE quotas (
  provider text NOT NULL,
  day      date NOT NULL,
  count    integer NOT NULL,
  warned   boolean NOT NULL,
  PRIMARY KEY (provider, day)
);

-- Indices --------------------------------------------------------------------
-- email y phone ya lo tienen por ser UNIQUE, y vehicles se lista por empresa
-- con el prefijo de su clave primaria, asi que ninguno de los dos repite aqui.

CREATE INDEX users_company_idx ON users (company_id);
CREATE INDEX locations_company_idx ON locations (company_id);

CREATE INDEX vehicle_locations_vehicle_idx ON vehicle_locations (company_id, vin);
CREATE INDEX vehicle_locations_location_idx ON vehicle_locations (company_id, location_id);

CREATE INDEX user_locations_user_idx ON user_locations (company_id, user_id);
CREATE INDEX user_locations_location_idx ON user_locations (company_id, location_id);

-- El historial de una unidad, del mas reciente al mas antiguo. seq desempata.
CREATE INDEX events_vehicle_idx ON events (company_id, vin, created_at DESC, seq DESC);
CREATE INDEX vehicle_positions_vehicle_idx ON vehicle_positions (company_id, vin, created_at DESC);
CREATE INDEX photos_vehicle_idx ON photos (company_id, vin);
CREATE INDEX dismissals_vehicle_idx ON dismissals (company_id, vin);

CREATE INDEX grants_user_idx ON grants (user_id, granted_at DESC);
CREATE INDEX grants_company_idx ON grants (company_id, granted_at DESC);

CREATE INDEX tokens_code_idx ON tokens (code);
CREATE INDEX tokens_owner_idx ON tokens (owner);
CREATE INDEX tokens_company_idx ON tokens (company_id);
CREATE INDEX token_uses_token_idx ON token_uses (token_id, seq);

-- Aqui no hay indice unico para "una direccion, una prueba pendiente", y no
-- es un olvido.
--
-- La regla del dominio es "ninguna viva", y viva significa ni retirada ni
-- caducada. La caducidad depende de la hora, y la hora no se puede indexar:
-- `now()` no es inmutable y un indice parcial no la admite. Un indice sobre el
-- trozo que si es inmutable --"ninguna sin retirar"-- suena parecido y no lo
-- es: `Codes.create` (codes.mjs:172) solo retira las que estan vivas, asi que
-- una caducada se queda sin retirar para siempre y bloquearia la siguiente.
-- No es teoria: en el almacen que se importo hay veinticuatro llaves asi.
--
-- Lo que de verdad hay que impedir es que dos peticiones a la vez creen las
-- dos una llave viva. Eso se resuelve donde ocurre --dentro de la
-- transaccion-- con `pg_advisory_xact_lock` sobre el destinatario, retirando y
-- creando bajo el mismo cerrojo. Ver la capa de datos.

COMMIT;
