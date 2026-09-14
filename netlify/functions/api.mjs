import { getStore } from '@netlify/blobs'
import { createFleetHubApi, emptyState } from '../../server/app.mjs'
import { AddressAutocomplete } from '../../server/geocoder.mjs'
import { RouteEstimator } from '../../server/router.mjs'
import { createDeliverCode, resendMailer, twilioTexter, webhookDelivery } from '../../server/delivery.mjs'
import { twilioVerifier } from '../../server/verify.mjs'
import { createPostgresStore } from '../../server/store-postgres.mjs'
import { log } from '../../server/observability.mjs'

/**
 * En qué entorno corre esta Function, y por tanto en qué almacén escribe.
 *
 * `CONTEXT` no vale aquí: es una variable del build y llega vacía en tiempo de
 * ejecución, así que un deploy de producción acababa escribiendo en el almacén
 * de desarrollo sin que nada lo dijera. Se queda como último recurso porque no
 * estorba, pero lo que manda es `FLEETHUB_ENVIRONMENT`, que es una variable del
 * sitio con un valor por contexto y sí llega.
 */
const context = Netlify.env.get('FLEETHUB_ENVIRONMENT')
  || Netlify.env.get('CONTEXT')
  || 'development'
const suffix = context === 'production' ? '' : `-${context}`
const data = getStore({ name: `fleethub-data${suffix}`, consistency: 'strong' })
const photos = getStore({ name: `fleethub-photos${suffix}`, consistency: 'strong' })
const geocoder = new AddressAutocomplete({ apiKey: Netlify.env.get('GEOAPIFY_API_KEY') })
const routeEstimator = new RouteEstimator({ apiKey: Netlify.env.get('GEOAPIFY_API_KEY') })
const env = (name) => Netlify.env.get(name)

// Correo por Resend, SMS por Twilio, y el webhook como salida propia si se
// prefiere resolver la entrega fuera. Lo que no esté configurado se queda a
// null: sin ninguno de los tres, `createDeliverCode` devuelve undefined y el
// servidor rechaza la petición en vez de fingir que mandó algo.
const deliverCode = createDeliverCode({
  mailer: resendMailer({ apiKey: env('RESEND_API_KEY'), from: env('RESEND_FROM') }),
  texter: twilioTexter({
    accountSid: env('TWILIO_ACCOUNT_SID'),
    keySid: env('TWILIO_API_KEY_SID') || env('TWILIO_ACCOUNT_SID'),
    keySecret: env('TWILIO_API_KEY_SECRET') || env('TWILIO_AUTH_TOKEN'),
    messagingServiceSid: env('TWILIO_MESSAGING_SERVICE_SID'),
    from: env('TWILIO_FROM_NUMBER'),
  }),
  webhook: webhookDelivery({
    url: env('AUTH_DELIVERY_WEBHOOK_URL'),
    token: env('AUTH_DELIVERY_TOKEN'),
  }),
  log,
})

/**
 * De donde salen los datos.
 *
 * Con `NETLIFY_DATABASE_URL` puesta, de PostgreSQL. Sin ella, del blob de
 * siempre. Que convivan no es indecision: es lo que permite desplegar el
 * cambio y volver atras quitando una variable, sin tocar codigo ni esperar a
 * nadie.
 *
 * Se usa la conexion agrupada --la que lleva `-pooler`-- porque es un
 * PgBouncer en modo transaccion y eso es exactamente lo que hace aqui cada
 * peticion: abrir una, escribir, cerrarla. La directa se reserva para crear el
 * esquema, que necesita estado de sesion.
 */
const postgres = env('NETLIFY_DATABASE_URL')
  ? createPostgresStore({ url: env('NETLIFY_DATABASE_URL') })
  : null

if (postgres) log('info', 'store_postgres', { pooled: env('NETLIFY_DATABASE_URL').includes('-pooler') })

const api = createFleetHubApi({
  /**
   * El estado y su ETag.
   *
   * El ETag es lo que después permite escribir sólo si nadie ha escrito entre
   * medias. Sin él, dos peticiones simultáneas leen lo mismo, escriben lo
   * mismo y la última borra a la primera sin dejar rastro.
   */
  loadState: async () => {
    if (postgres) return postgres.loadState()
    const held = await data.getWithMetadata('state', { type: 'json', consistency: 'strong' })
    // `existed` distingue «todavía no hay estado» de «lo hay y el almacén no
    // dio ETag»: en el primer caso la escritura sólo puede crear, en el
    // segundo no hay con qué condicionarla y se escribe sin condición.
    return { state: held?.data ?? emptyState(), revision: { etag: held?.etag ?? null, existed: Boolean(held) } }
  },
  /**
   * Escribe condicionalmente: con ETag, sólo si sigue siendo ese; sin ETag,
   * sólo si la clave todavía no existe. `modified: false` es el conflicto.
   */
  saveState: async (state, { revision } = {}) => {
    if (postgres) return postgres.saveState(state, { revision })
    if (revision?.etag)
      return { ok: (await data.setJSON('state', state, { onlyIfMatch: revision.etag }))?.modified !== false }
    if (revision && !revision.existed)
      return { ok: (await data.setJSON('state', state, { onlyIfNew: true }))?.modified !== false }
    await data.setJSON('state', state)
    return { ok: true }
  },
  savePhoto: async (filename, bytes, metadata) => photos.set(filename, bytes, { metadata }),
  loadPhoto: async (filename) => photos.get(filename, { type: 'arrayBuffer' }),
  removePhoto: async (filename) => photos.delete(filename),
  suggestAddresses: (query, options) => geocoder.suggest(query, options),
  estimateRoute: (points) => routeEstimator.estimate(points),
  allowedOrigins: Netlify.env.get('ALLOWED_ORIGINS'),
  deliverCode,
  // El SMS lo entrega Twilio Verify: sus números ya están registrados ante las
  // operadoras, así que no hace falta el 10DLC nuestro. El código pasa a ser
  // suyo — ver server/verify.mjs.
  verifier: twilioVerifier({
    accountSid: env('TWILIO_ACCOUNT_SID'),
    keySid: env('TWILIO_API_KEY_SID') || env('TWILIO_ACCOUNT_SID'),
    keySecret: env('TWILIO_API_KEY_SECRET') || env('TWILIO_AUTH_TOKEN'),
    serviceSid: env('TWILIO_VERIFY_SERVICE_SID'),
  }),
  exposeAuthCodes: Netlify.env.get('ALLOW_INSECURE_AUTH_CODES') === 'true',
})

export default async function handler(request) {
  return api(request)
}

export const config = {
  path: '/api/*',
}
