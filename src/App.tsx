// Two views of the same thing:
//   · the running application, one device, at whatever address you are at;
//   · the gallery, every screen of FleetHub.dc.html side by side, as designed.
//
// The gallery lives at #/gallery. It is the reference we check changes
// against, so it is not deleted — but nothing in the app links to it, and the
// switch above the device only shows outside a production build.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { color } from './design/tokens'
import { IOSDevice } from './components/IOSDevice'
import { CreatePassword, Login, Register, VerifyCode } from './screens/auth'
import { Dashboard, EditUnit, EditVehicleDetails, type UnitEdit } from './screens/dashboard'
import { ManualVin, ScanVin, VinConfirm } from './screens/scan'
import { Alerts, ReportHistory } from './screens/fleet'
import { PersonalData, Profile, SupportAccess, type Details } from './screens/profile'
import { AdminEditRoute, AdminOverview, AdminPoint, AdminRoutes } from './screens/admin'
import { AdminInviteCode, AdminUsers } from './screens/admin-users'
import { AdminNav, type AdminTab, OperatorNav, type OperatorTab } from './components/ui'
import {
  checkCode,
  confirmCode,
  createCompany,
  deleteRoute,
  dismissAlert,
  endSession,
  endSupport,
  flushUnsynced,
  getMember,
  getVehicle,
  getVehicleDetails,
  listAlerts,
  listCodes,
  listRoutes,
  listZones,
  mintCode,
  newRoute,
  registerAccount,
  removeVehicle,
  requestSupport,
  resolvedToday,
  resumeSession,
  revokeCode,
  saveMember,
  saveRoute,
  saveScan,
  saveVehicleDetails,
  sendCode,
  setMemberRoutes,
  setPassword as setPasswordFor,
  setSuspension,
  signInWithPassword,
  startSession,
  supportAccess,
  type Identity,
  type Result,
  whoami,
} from './data'
import { useData } from './data/useData'
import { can, ROLES, vehicleCode, type InviteCode, type Route } from './domain'
import css from './App.module.css'
import { match, navigate, usePath } from './router'
import { routeForEditing } from './lib/routes'
import { activeTab, ADMIN_TABS, OPERATOR_TABS, PLACES, type Place } from './screens'
import {
  phoneHint,
  countryOf,
  type Recipient,
  type RegistrationDraft,
} from './lib/auth'
import {
  clearAuthProgress,
  readAuthProgress,
  writeAuthProgress,
  type SentCode,
} from './lib/auth-progress'

/** Reachable without having signed in. Everything else sends you to A. */
const PUBLIC = ['/login', '/register', '/verify-code', '/password']

/**
 * Runs a write and, if the seam refused it, says so instead of letting the
 * screen carry on as though it had happened.
 */
type Attempt = <T>(write: Promise<Result<T>>, then?: (value: T) => void) => void

/** A Recipient is how a screen says it; an Identity is how the seam asks. */
function asIdentity(to: Recipient): Identity {
  return to.kind === 'email' ? { kind: 'email', email: to.email } : { kind: 'phone', phone: to.phone }
}

/** 05b hands back what it edited; the seam wants it whole. */
function toEdit(details: Details, country: string) {
  return {
    fullName: details.name,
    email: details.email,
    phone: details.phone,
    country,
    role: details.role,
  }
}

function Caption({ code, title, at }: { code: string; title: string; at?: string }) {
  return (
    <div className={css.caption}>
      <span>
        <span className={css.accent}>{code}</span> · {title}
      </span>
      {at && <span className={css.address}>#{at}</span>}
    </div>
  )
}

function Slot({ caption, children }: { caption: ReactNode; children: ReactNode }) {
  return (
    <div className={css.slot}>
      {caption}
      <IOSDevice>{children}</IOSDevice>
    </div>
  )
}

/**
 * The bar a place carries. Drawn by the frame and not by the screen, so no
 * screen has to be handed one — which is what `nav` and `onNavigate` were.
 */
function Bar({
  place,
  path,
  live = true,
  canScan = true,
}: {
  place: Place
  path: string
  live?: boolean
  canScan?: boolean
}) {
  // La campana marca las alertas que hay, no las que el diseño dibujó. La
  // galería conserva su 2 de referencia; la app cuenta — y con cero, calla.
  const alerts = useData(() => listAlerts(), [])?.length
  if (place.bar === 'operator') {
    return (
      <OperatorNav
        active={activeTab(path) as OperatorTab}
        onSelect={live ? (tab) => navigate(OPERATOR_TABS[tab]) : undefined}
        canScan={canScan}
        alerts={live ? (alerts ?? 0) : undefined}
      />
    )
  }
  if (place.bar === 'admin') {
    return (
      <AdminNav
        active={activeTab(path) as AdminTab}
        onSelect={live ? (tab) => navigate(ADMIN_TABS[tab]) : undefined}
      />
    )
  }
  return null
}

// ── La galería ──────────────────────────────────────────────────────────────

/** One of every screen, as designed, with the bar its place says it carries. */
const GALLERY: { code: string; title: string; path: string; screen: ReactNode }[] = [
  { code: 'A', title: 'INICIO DE SESIÓN', path: '/login', screen: <Login /> },
  { code: 'B', title: 'REGISTRO', path: '/register', screen: <Register /> },
  {
    code: 'C', title: 'CONFIRMAR CÓDIGO', path: '/verify-code',
    screen: <VerifyCode sentTo="+52 55 4128 7730" smsHint="···7730" />,
  },
  { code: 'D', title: 'CREAR CONTRASEÑA', path: '/password', screen: <CreatePassword /> },
  { code: '00', title: 'DASHBOARD', path: '/map', screen: <Dashboard /> },
  { code: '00b', title: 'MODIFICAR UNIDAD', path: '/vehicles', screen: <EditUnit /> },
  { code: '01', title: 'ESCANEO VIN', path: '/scan', screen: <ScanVin /> },
  { code: '02', title: 'CONFIRMACIÓN', path: '/scan/vin', screen: <VinConfirm /> },
  { code: '03', title: 'HISTORIAL', path: '/reports', screen: <ReportHistory /> },
  { code: '04', title: 'ALERTAS', path: '/alerts', screen: <Alerts /> },
  { code: '05', title: 'PERFIL', path: '/profile', screen: <Profile /> },
  { code: '05b', title: 'DATOS PERSONALES', path: '/profile/personal-data', screen: <PersonalData /> },
  { code: '05c', title: 'ACCESO DE SOPORTE', path: '/profile/support', screen: <SupportAccess /> },
  { code: '06', title: 'ADMINISTRACIÓN', path: '/admin', screen: <AdminOverview /> },
  { code: '06b', title: 'ADMIN · RUTAS', path: '/admin/locations', screen: <AdminRoutes /> },
  { code: '06c', title: 'ADMIN · EDITAR LOCATION', path: '/admin/locations', screen: <AdminEditRoute /> },
  { code: '06d', title: 'ADMIN · UBICAR PUNTO', path: '/admin/locations', screen: <AdminPoint /> },
  { code: '07', title: 'ADMIN · USUARIOS', path: '/admin/users', screen: <AdminUsers /> },
  {
    code: '07b',
    title: 'ADMIN · CÓDIGO DE ALTA',
    path: '/admin/users/new',
    screen: <AdminInviteCode />,
  },
]

function Gallery() {
  return (
    <div className={css.gallery}>
      {GALLERY.map((s) => {
        const place = PLACES.find((p) => match(p.path, s.path))
        return (
          <Slot key={`${s.code}-${s.title}`} caption={<Caption code={s.code} title={s.title} />}>
            {s.screen}
            {/* 06d is drawn at its parent's address, and carries no bar.
                The gallery's bars are drawn, not wired: a mis-click there
                should not tip you out of the gallery and into the app. */}
            {place && s.code !== '06d' && <Bar place={place} path={s.path} live={false} />}
          </Slot>
        )
      })}
    </div>
  )
}

// ── La app ──────────────────────────────────────────────────────────────────

function LiveApp({ path }: { path: string }) {
  const [restored] = useState(readAuthProgress)
  const [draft, setDraft] = useState<RegistrationDraft>(restored.draft)
  /**
   * The code in play, as far as this screen needs to know: where it went, what
   * flow it belongs to, and the digits themselves — which are here only
   * because nothing in this program can send an SMS, so they have to be shown
   * beside the device to be readable at all. Whether they are right is not
   * asked here; the row that issued them is the one that knows.
   */
  const [sent, setSent] = useState<SentCode | null>(restored.sent)
  /**
   * Who a verified reset code belongs to. Held apart from the session on
   * purpose: proving the address is not being signed in — that only happens
   * once the new password is set.
   */
  const [resetFor, setResetFor] = useState<string | null>(restored.resetFor)
  /** Prueba temporal que enlaza el correo confirmado con el UUID reservado. */
  const [registrationToken, setRegistrationToken] = useState<string | null>(restored.registrationToken)

  useEffect(() => {
    writeAuthProgress({ draft, sent, resetFor, registrationToken })
  }, [draft, sent, resetFor, registrationToken])

  /** The VIN in hand, and how it was obtained. */
  const [scanned, setScanned] = useState<{ vin: string; source: 'ocr' | 'manual' } | null>(null)
  /**
   * A route begun with + NUEVO. It is in no list until it is saved, so the
   * address that names it has nothing to load — this is what it loads instead.
   */
  const [draftRoute, setDraftRoute] = useState<Route | null>(null)

  /**
   * The person whose session this is.
   *
   * Read through the seam and not held here, because the seam is the one that
   * has to know: what a company can see is not the same question as what is
   * stored, and it answers the first one. Two copies of "who is signed in"
   * would be two chances to disagree about whose rows these are.
   */
  const answer = useData(whoami)
  const me = answer ?? null
  /**
   * Si todavía se está volviendo a bajar lo de la empresa.
   *
   * Al abrir una pestaña que ya tenía sesión no se pasa por el inicio de
   * sesión, así que las filas de la balda pueden estar vacías —otra pestaña,
   * un navegador limpiado, una bajada que no llegó a terminar— y `whoami`
   * contestaría «nadie» sobre una sesión que sí existe. Esperar a que la
   * bajada termine es la diferencia entre recargar y ser expulsado.
   */
  const [resuming, setResuming] = useState(true)
  /**
   * Whether the seam has answered yet. Undefined is not "nobody": it is "not
   * asked yet", and the two have to be told apart or the guard below turns
   * somebody away for the length of one read. Reloading a signed-in tab is
   * exactly that — the session is there, and being bounced to the way in
   * before it can be read is being signed out by the asking.
   */
  const known = answer !== undefined && !resuming
  /** Guards every address but PUBLIC. */
  const signedIn = me !== null
  /**
   * A held account can only look at its own profile; one held by
   * administration cannot even sign in.
   */
  const held = me?.suspension ?? null

  useAlertNotices(signedIn)

  // Sin sesión guardada esto termina en el mismo microtask y no se nota; con
  // ella, es lo que evita que una recarga acabe en la pantalla de acceso.
  useEffect(() => {
    let alive = true
    void resumeSession().finally(() => {
      if (alive) setResuming(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const go = (to: string) => {
    navigate(to)
  }

  const alertUser = (message: string) => window.alert(message)

  /** Where a line of the log, or an alert, sends you: to that unit's card. */
  const openUnit = (unit: string) => go(`/map/${unit}`)
  /** Administration keeps its own navigation while inspecting a report. */
  const openAdminUnit = (unit: string) => go(`/admin/reports/vehicles/${unit}`)

  /**
   * Every write can be refused, and a refusal has to be visible: a screen that
   * navigated away as though it had saved would be lying about it.
   */
  const attempt: Attempt = (write, then) => {
    void write.then((result) => {
      if (!result.ok) {
        alertUser(result.reason)
        return
      }
      then?.(result.value)
    })
  }

  /** Returns the reason it cannot go through, or null. */
  const send = async (to: Recipient, flow: 'register' | 'signin' | 'reset') => {
    const answer = await sendCode(asIdentity(to), flow)
    if (!answer.ok) return answer.reason
    setSent({
      to,
      code: answer.value.code,
      expiresAt: answer.value.expiresAt,
      flow,
      name: flow === 'register' ? draft.name : answer.value.name,
    })
    if (answer.value.code) alertUser(`EL CÓDIGO ENVIADO ES ${answer.value.code}`)
    go('/verify-code')
    return null
  }

  const withPassword = async (to: Recipient, typed: string) => {
    const answer = await signInWithPassword(asIdentity(to), typed)
    if (!answer.ok) return answer.reason
    clearAuthProgress()
    await startSession(answer.member.id)
    go('/profile')
    return null
  }

  const found = PLACES.map((place) => ({ place, params: match(place.path, path) })).find(
    (hit) => hit.params,
  )
  const place = found?.place ?? PLACES[0]
  const params = found?.params ?? {}

  const back = typeof place.back === 'function' ? place.back(params) : place.back
  const onBack = back ? () => go(back) : undefined

  /**
   * Addresses can be typed and shared now, so what used to be impossible to
   * reach has to be turned away instead.
   */
  const allowed = signedIn || PUBLIC.includes(place.path)
  // A hold confines a session to its own profile; it does not keep you from
  // leaving. Signed out, the way in is what turns you away.
  const free = !signedIn || !held || place.path.startsWith('/profile')
  // An address can be typed, so a place nobody offered you still has to be
  // refused. What each place needs is the same question the buttons ask.
  const needed = place.needs
  const reachable = allowed && free && (!needed || !signedIn || can(me, needed))
  useEffect(() => {
    // Nothing is refused before the answer is in: turning somebody away
    // because the question is still in flight is its own bug.
    if (!known) return
    if (place.path === '/verify-code' && !sent) navigate('/register', { replace: true })
    else if (
      place.path === '/password' &&
      !signedIn &&
      !registrationToken &&
      !resetFor
    ) navigate('/register', { replace: true })
    else if (!found) navigate('/login', { replace: true })
    else if (!allowed) navigate('/login', { replace: true })
    else if (!reachable) navigate('/profile', { replace: true })
  }, [known, found, allowed, reachable, place.path, sent, signedIn, registrationToken, resetFor])

  const screen = () => {
    if (!known || !reachable) return null
    if (place.path === '/verify-code' && !sent) return null
    if (place.path === '/password' && !signedIn && !registrationToken && !resetFor) return null
    switch (place.path) {
      // ── acceso ──────────────────────────────────────────────────────────
      case '/login':
        return (
          <Login
            onSendCode={(to) => send(to, 'signin')}
            onPasswordSignIn={withPassword}
            onForgot={(to) => send(to, 'reset')}
            onRegister={() => go('/register')}
          />
        )
      case '/register':
        return (
          <Register
            initial={draft}
            onCheckCode={checkCode}
            onCreateCompany={createCompany}
            onContinue={(d) => {
              setDraft(d)
              setRegistrationToken(null)
              send({ kind: 'email', email: d.email }, 'register')
            }}
            onBack={() => go('/login')}
            onSignIn={() => go('/login')}
          />
        )
      case '/verify-code':
        return (
          <VerifyCode
            name={sent?.name}
            sentTo={sent?.to.kind === 'email' ? sent.to.email : undefined}
            smsHint={sent ? phoneHint(sent.to) : undefined}
            code={sent?.code}
            expiresAt={sent?.expiresAt}
            onConfirm={async (typed) => {
              if (!sent) return 'PIDE UN CÓDIGO NUEVO'
              const answer = await confirmCode(asIdentity(sent.to), typed, sent.flow)
              if (!answer.ok) return answer.reason
              // Spending it is what decides. Registering there is nobody yet,
              // so it only proves the address; signing in it was issued to a
              // person, and confirming it is becoming them. Resetting it was
              // also issued to a person — but proving the address only earns
              // the right to choose a new password, not a session.
              if (sent.flow === 'register') setRegistrationToken(answer.value.registrationToken)
              if (sent.flow === 'signin') {
                clearAuthProgress()
                await startSession(answer.value.member?.id ?? null)
              }
              if (sent.flow === 'reset') setResetFor(answer.value.member?.id ?? null)
              return null
            }}
            onVerified={() => go(sent?.flow === 'signin' ? '/profile' : '/password')}
            onResend={() => sent && void send(sent.to, sent.flow)}
            onBack={() => go('/login')}
          />
        )
      case '/password': {
        // Reached either at the end of registration or from personal details,
        // where it is a change of password rather than the first one.
        const changing = signedIn
        return (
          <CreatePassword
            requireCurrent={changing}
            onCreate={(typed, current) => {
              if (changing) {
                attempt(setPasswordFor(me?.id ?? null, typed, current), () => {
                  alertUser('CONTRASEÑA ACTUALIZADA')
                  navigate('/profile/personal-data')
                })
                return
              }
              // A reset that proved its address: the new password is set for
              // that account, and only now — with something to open the door
              // again — is the session theirs.
              if (sent?.flow === 'reset' && resetFor) {
                const who = resetFor
                attempt(setPasswordFor(who, typed), () => {
                  clearAuthProgress()
                  setResetFor(null)
                  void startSession(who)
                  alertUser('CONTRASEÑA ACTUALIZADA · YA ESTÁS DENTRO')
                  navigate('/profile')
                })
                return
              }
              // The end of registering: the key is spent, the company gains a
              // person with the role that key carried, and the session is
              // theirs. A key refused here is a key that stopped working
              // between typing it and getting this far.
              attempt(
                registerAccount({
                  fullName: draft.name,
                  email: draft.email,
                  phone: draft.phone,
                  phoneCode: `+${countryOf(draft.country).dial}`,
                  language: navigator.language.toLowerCase().startsWith('en') ? 'en' : 'es',
                  code: draft.companyCode,
                  registrationToken: registrationToken ?? '',
                  password: typed,
                }),
                (userId) => {
                  clearAuthProgress()
                  void startSession(userId)
                  navigate('/profile')
                },
              )
            }}
            onBack={() => go(changing ? '/profile/personal-data' : '/verify-code')}
          />
        )
      }

      // ── operador ────────────────────────────────────────────────────────
      case '/map':
      case '/map/:id':
        return (
          <Dashboard
            at={params.id ?? null}
            onSelect={(id) => navigate(id ? `/map/${id}` : '/map', { replace: true })}
            onEditUnit={(unit) => go(`/vehicles/${unit.id}`)}
            canEdit={can(me, 'unidad.modificar')}
            onScan={() => go('/scan')}
            canScan={can(me, 'escanear')}
          />
        )
      case '/vehicles/:id':
        return (
          <EditUnitAt
            id={params.id}
            by={me?.id ?? null}
            onSaved={(edit) => {
              navigate('/reports')
              alertUser(
                `${edit.id} GUARDADO · ${edit.status}${edit.route ? ` · ${edit.route}` : ''}`,
              )
            }}
            canRemove={can(me, 'unidad.remover')}
            onRemoved={async (vin) => {
              const gone = await removeVehicle(me?.id ?? null, vin)
              if (!gone.ok) {
                alertUser(gone.reason)
                return
              }
              navigate('/map')
              alertUser('UNIDAD REMOVIDA DE LA FLOTA')
            }}
          />
        )
      case '/vehicles/:id/details':
        return (
          <VehicleDetailsAt
            id={params.id}
            attempt={attempt}
            onBack={() => go(`/vehicles/${params.id}`)}
          />
        )
      case '/scan':
        return (
          <ScanVin
            onBack={() => go('/map')}
            // Un VIN que el lector de códigos del visor leyó de verdad.
            onDetected={(vin) => {
              setScanned({ vin, source: 'ocr' })
              go('/scan/vin')
            }}
            onManual={() => go('/scan/manual')}
          />
        )
      case '/scan/manual':
        return (
          <ManualVin
            onBack={() => go('/scan')}
            onDetected={(vin) => {
              setScanned({ vin, source: 'manual' })
              go('/scan/vin')
            }}
          />
        )
      case '/scan/vin':
        return (
          <VinConfirmAt
            scanned={scanned}
            by={me?.id ?? null}
            attempt={attempt}
            onBack={() => go('/scan')}
            onSaved={(unit, noPosition) => {
              navigate(`/map/${unit}`)
              alertUser(
                noPosition
                  ? `${unit} GUARDADA · SIN UBICACIÓN — EL GPS NO CONTESTÓ`
                  : `${unit} GUARDADA DONDE ESTÁS`,
              )
            }}
          />
        )
      case '/reports':
        // The tab is the fleet: one row per vehicle, its latest news.
        return <ReportHistory mode="latest" onOpenUnit={openUnit} />
      case '/alerts':
        // The alert names a unit; seeing it on the map is arriving at its card.
        return <AlertsAt attempt={attempt} onSeeOnMap={openUnit} by={me?.id ?? null} />

      // ── perfil ──────────────────────────────────────────────────────────
      case '/profile':
        return (
          <Profile
            person={me ?? undefined}
            onReactivate={() => me && attempt(setSuspension(me.id, me.id, null))}
            onUpload={() =>
              attempt(flushUnsynced(me?.id ?? null), (sent) =>
                alertUser(`SUBIDO · ${sent} REGISTROS GUARDADOS EN EL SERVIDOR`),
              )
            }
            onOpenPersonalData={() => go('/profile/personal-data')}
            onOpenZone={() => go('/profile/locations')}
            onOpenScanHistory={() => go('/profile/history')}
            onOpenSupport={() => go('/profile/support')}
            onAdminister={() => go('/admin')}
            canAdminister={can(me, 'consola')}
            onSignOut={() => {
              // Keeps the account: signing out is not deleting it.
              void endSession()
              go('/login')
            }}
          />
        )
      case '/profile/personal-data':
        return (
          <PersonalData
            person={me ?? undefined}
            onBack={onBack}
            onSave={(details, country) => {
              if (me) attempt(saveMember(me.id, me.id, toEdit(details, country)), () => go('/profile'))
            }}
            onChangePassword={() => go('/password')}
            onSuspend={() => {
              if (me) attempt(setSuspension(me.id, me.id, 'self'), () => go('/profile'))
            }}
          />
        )
      case '/profile/locations':
        // 06b without the traslados/garaje split, and read-only: the operator
        // is being told their zone, not picking it.
        return <AdminRoutes showSegments={false} action="none" assigned={me?.routes ?? []} onBack={onBack} />
      case '/profile/history':
        // Your own doing, in the order you did it — the same log, narrowed.
        return <ReportHistory onBack={onBack} by={me?.membershipId ?? null} onOpenUnit={openUnit} />
      case '/profile/support':
        return <SupportAt by={me?.id ?? null} onBack={onBack} />

      // ── administración ──────────────────────────────────────────────────
      case '/admin':
        return <AdminOverview onBack={onBack} />
      case '/admin/locations':
        return (
          <AdminRoutes
            onBack={onBack}
            onOpen={(route) => go(`/admin/locations/${route.code}`)}
            onNew={() =>
              void newRoute().then((r) => {
                setDraftRoute(r)
                go(`/admin/locations/${r.code}`)
              })
            }
          />
        )
      case '/admin/locations/:code':
        return (
          <EditRouteAt
            code={params.code}
            draft={draftRoute}
            by={me?.id ?? null}
            attempt={attempt}
            onDone={() => go('/admin/locations')}
          />
        )
      case '/admin/reports':
        // Administration sees the whole company's, unfiltered.
        return <ReportHistory onBack={onBack} onOpenUnit={openAdminUnit} />
      case '/admin/reports/vehicles/:id':
        return (
          <Dashboard
            at={params.id}
            onSelect={(id) => navigate(id ? `/admin/reports/vehicles/${id}` : '/admin/reports', { replace: true })}
            onBack={onBack}
            canEdit={false}
            canScan={false}
          />
        )
      case '/admin/users':
        return (
          <AdminUsers
            onBack={onBack}
            onOpen={(person) => go(`/admin/users/${person.id}`)}
            onInvite={() => go('/admin/users/new')}
          />
        )
      case '/admin/users/new':
        return (
          <InviteAt by={me?.id ?? null} attempt={attempt} onClose={() => go('/admin/users')} />
        )
      case '/admin/users/:id':
        return <MemberAt id={params.id} onBack={onBack} />
      case '/admin/users/:id/personal-data':
        return <MemberDataAt id={params.id} by={me?.id ?? null} attempt={attempt} onBack={onBack} />
      case '/admin/users/:id/locations':
        return <MemberZoneAt id={params.id} by={me?.id ?? null} attempt={attempt} onBack={onBack} />
      case '/admin/users/:id/history':
        return <MemberHistoryAt id={params.id} onBack={onBack} onOpenUnit={openUnit} />
      default:
        return null
    }
  }

  return (
    <div className={css.frame}>
      {screen()}
      <Bar place={place} path={path} canScan={can(me, 'escanear')} />
    </div>
  )
}

// ── Las pantallas que necesitan cargar lo que la dirección nombra ───────────

function EditUnitAt({
  id,
  by,
  onSaved,
  canRemove,
  onRemoved,
}: {
  id: string
  by: string | null
  onSaved: (edit: UnitEdit) => void
  canRemove: boolean
  onRemoved: (vin: string) => void
}) {
  const unit = useData(() => getVehicle(id), [id])
  if (!unit) return null
  return (
    <EditUnit
      unit={unit}
      by={by}
      onClose={() => navigate('/map')}
      onEditDetails={() => navigate(`/vehicles/${id}/details`)}
      onSave={onSaved}
      canRemove={canRemove}
      onRemove={() => onRemoved(unit.vin)}
    />
  )
}

function VehicleDetailsAt({
  id,
  attempt,
  onBack,
}: {
  id: string
  attempt: Attempt
  onBack: () => void
}) {
  const unit = useData(() => getVehicle(id), [id])
  const details = useData(
    () => unit ? getVehicleDetails(unit.vin) : Promise.resolve(null),
    [unit?.vin],
  )
  if (!unit || !details) return null
  return (
    <EditVehicleDetails
      details={details}
      onBack={onBack}
      onSave={(draft) => attempt(saveVehicleDetails(unit.vin, draft), onBack)}
    />
  )
}

function EditRouteAt({
  code,
  draft,
  by,
  attempt,
  onDone,
}: {
  code: string
  /** A route that has been started but not yet saved, so is in no list. */
  draft: Route | null
  by: string | null
  attempt: Attempt
  onDone: () => void
}) {
  const routes = useData(listRoutes)
  const route = routeForEditing(routes, code, draft)
  // A route reached by an address that no longer exists — deleted, or typed.
  if (routes === undefined && !route) return null
  if (!route) {
    navigate('/admin/locations')
    return null
  }
  return (
    <AdminEditRoute
      route={route}
      onBack={onDone}
      onSave={(saved) => attempt(saveRoute(by, saved), onDone)}
      onDelete={() => draft?.code === code ? onDone() : attempt(deleteRoute(by, code), onDone)}
    />
  )
}

function MemberAt({
  id,
  onBack,
}: {
  id: string
  onBack?: () => void
}) {
  const person = useData(() => getMember(id), [id])
  if (!person) return null
  return (
    <Profile
      person={person}
      onBack={onBack}
      onOpenPersonalData={() => navigate(`/admin/users/${id}/personal-data`)}
      onOpenZone={() => navigate(`/admin/users/${id}/locations`)}
      onOpenScanHistory={() => navigate(`/admin/users/${id}/history`)}
    />
  )
}

/**
 * 07b with a key actually issued: one is minted on arrival, and choosing a
 * different role mints another and withdraws the first — the screen only ever
 * offers one, and what it offers has to be the one it will hand over.
 */
function InviteAt({
  by,
  attempt,
  onClose,
}: {
  by: string | null
  attempt: Attempt
  onClose?: () => void
}) {
  const [role, setRole] = useState(ROLES[0].name)
  const [issued, setIssued] = useState<InviteCode | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const pending = useData(() => listCodes(by), [by, refresh])

  const generate = async () => {
    if (issuing) return
    setIssuing(true)
    setIssueError(null)
    const old = issued
    if (old) {
      const revoked = await revokeCode(by, old.code)
      if (!revoked.ok) {
        setIssueError(revoked.reason)
        setIssuing(false)
        return
      }
      setIssued(null)
    }
    const result = await mintCode(by, { kind: 'alta', role })
    if (result.ok) setIssued(result.value)
    else setIssueError(result.reason)
    setIssuing(false)
    setRefresh((n) => n + 1)
  }

  return (
    <AdminInviteCode
      issued={issued ?? undefined}
      // The one on offer is not one of the ones waiting to be used.
      pending={pending?.filter((c) => c.code !== issued?.code)}
      role={role}
      onPickRole={setRole}
      onGenerate={() => void generate()}
      onAnother={() => void generate()}
      onRevoke={(code) => attempt(revokeCode(by, code), () => setRefresh((n) => n + 1))}
      onClose={onClose}
      loading={issuing}
      error={issueError}
    />
  )
}

/**
 * The support window, and the key that opens it.
 *
 * Everything it shows is read through the seam rather than handed down, so the
 * moment the window opens the screen it came from — 05 — says so too.
 */
/**
 * 02 leyendo por la costura: la matrícula que recibiría una unidad nueva, y el
 * guardado que escribe la unidad y el escaneo — y navega a donde quedó.
 */
function VinConfirmAt({
  scanned,
  by,
  attempt,
  onBack,
  onSaved,
}: {
  scanned: { vin: string; source: 'ocr' | 'manual' } | null
  by: string | null
  attempt: Attempt
  onBack?: () => void
  onSaved: (unit: string, noPosition: boolean) => void
}) {
  // Los grupos que la empresa nombra. Una recién nacida no nombra ninguno, y
  // entonces la ficha dice SIN GRUPO y no ofrece menú.
  const zones = useData(listZones) ?? []
  const [zoneAt, setZoneAt] = useState(0)
  // Sin VIN en mano no hay nada que confirmar: a por uno.
  useEffect(() => {
    if (!scanned) navigate('/scan', { replace: true })
  }, [scanned])
  if (!scanned) return null
  return (
    <VinConfirm
      vin={scanned.vin}
      source={scanned.source}
      unitId={vehicleCode(scanned.vin)}
      zone={zones[zoneAt] ?? ''}
      onPickZone={zones.length > 1 ? () => setZoneAt((at) => (at + 1) % zones.length) : undefined}
      onBack={onBack}
      onRetry={onBack}
      onSave={(draft) =>
        attempt(
          saveScan(by, {
            vin: scanned.vin,
            model: draft.model,
            spec: draft.spec,
            zone: draft.zone,
            coords: draft.coords,
            accuracy: draft.accuracy,
          }),
          (unit) => onSaved(unit.id, Boolean(draft.noPosition)),
        )
      }
    />
  )
}

/**
 * El aviso del aparato cuando nace una alerta: si el permiso está concedido y
 * la preferencia encendida, la campana no espera a que mires la pantalla. Es
 * la notificación de la app abierta — el push con la app cerrada necesita un
 * service worker con VAPID, y ese queda nombrado, no fingido.
 */
function useAlertNotices(signedIn: boolean) {
  const alerts = useData(() => listAlerts(), [])
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!signedIn || !alerts) return
    const ids = new Set(alerts.map((a) => a.id))
    // La primera lectura fija la línea base: avisar de lo que ya estaba en
    // pantalla al entrar sería ruido, no noticia.
    if (known.current === null) {
      known.current = ids
      return
    }
    const fresh = alerts.filter((a) => !known.current?.has(a.id))
    known.current = ids
    if (!fresh.length) return
    try {
      const wanted = localStorage.getItem('fleethub.push') !== 'off'
      if (!wanted || typeof Notification === 'undefined' || Notification.permission !== 'granted')
        return
      for (const a of fresh) new Notification(a.severity, { body: a.title, tag: a.id })
    } catch {
      // Sin permiso o sin soporte, la campana de la barra sigue contando.
    }
  }, [signedIn, alerts])
}

/** 04 leyendo por la costura: las activas derivadas y las descartadas de hoy. */
function AlertsAt({
  by,
  attempt,
  onSeeOnMap,
}: {
  by: string | null
  attempt: Attempt
  onSeeOnMap?: (unit: string) => void
}) {
  const alerts = useData(() => listAlerts(), []) ?? []
  const resolved = useData(() => resolvedToday(), []) ?? []
  return (
    <Alerts
      alerts={alerts}
      resolved={resolved}
      onSeeOnMap={onSeeOnMap}
      onDismiss={(alert) => attempt(dismissAlert(by, alert))}
    />
  )
}

function SupportAt({ by, onBack }: { by: string | null; onBack?: () => void }) {
  const grant = useData(() => supportAccess(by), [by])
  return (
    <SupportAccess
      until={grant?.expiresAt}
      onRequest={async (code) => {
        const answer = await requestSupport(by, code)
        return answer.ok ? null : answer.reason
      }}
      onEnd={() => void endSupport(by)}
      onBack={onBack}
    />
  )
}

/** Someone else's scan history, read from administration. */
function MemberHistoryAt({
  id,
  onBack,
  onOpenUnit,
}: {
  id: string
  onBack?: () => void
  onOpenUnit?: (unit: string) => void
}) {
  const person = useData(() => getMember(id), [id])
  if (!person) return null
  return <ReportHistory onBack={onBack} by={person.membershipId} onOpenUnit={onOpenUnit} />
}

function MemberDataAt({
  id,
  by,
  attempt,
  onBack,
}: {
  id: string
  by: string | null
  attempt: Attempt
  onBack?: () => void
}) {
  const person = useData(() => getMember(id), [id])
  if (!person) return null
  const done = () => navigate(`/admin/users/${id}`)
  return (
    <PersonalData
      person={person}
      admin
      onBack={onBack}
      onSave={(details, country) => attempt(saveMember(by, id, toEdit(details, country)), done)}
      onSuspend={() => attempt(setSuspension(by, id, 'admin'), done)}
    />
  )
}

function MemberZoneAt({
  id,
  by,
  attempt,
  onBack,
}: {
  id: string
  by: string | null
  attempt: Attempt
  onBack?: () => void
}) {
  const person = useData(() => getMember(id), [id])
  if (!person) return null
  return (
    <AdminRoutes
      showSegments={false}
      action="select"
      assigned={person.routes}
      onAssign={(codes) => attempt(setMemberRoutes(by, id, codes))}
      onBack={onBack}
    />
  )
}

// ── El marco ────────────────────────────────────────────────────────────────

/** The switch is for us; a production build ships without it. */
/**
 * Los ojos de desarrollo: ?dev en la dirección. Es lo único que enseña el
 * conmutador y lo único que abre la galería — sin él, la app es la app,
 * también en el build de desarrollo y en la copia de revisión. Una función y
 * no una constante porque la query puede cambiar sin recargar el módulo.
 */
const devEyes = () => new URLSearchParams(window.location.search).has('dev')

function ModeSwitch({ gallery, floating }: { gallery: boolean; floating?: boolean }) {
  const item = (to: string, label: string, on: boolean) => (
    <div
      onClick={() => navigate(to)}
      role="button"
      aria-label={label}
      className={css.switchItem}
      style={{ background: on ? color.accent : 'transparent', color: on ? '#fff' : color.canvasLabel }}
    >
      {label}
    </div>
  )
  return (
    <div className={floating ? css.switchFloat : css.switch}>
      <div className={css.switchBox}>
        {item('/login', 'APP', !gallery)}
        {item('/gallery', 'TODAS LAS PANTALLAS', gallery)}
      </div>
    </div>
  )
}

export default function App() {
  const path = usePath()
  const dev = devEyes()
  // Sin ?dev la galería ni existe: la dirección cae en la app, cuya guardia
  // la trata como cualquier ruta desconocida.
  const gallery = dev && path === '/gallery'

  // Abrir la app es abrir la app: pantalla entera, sin teléfono dibujado ni
  // cabecera de escaparate. El teléfono y el rótulo son de la galería, que es
  // donde se mira el diseño en vez de usarlo.
  if (!gallery) {
    return (
      <div className={css.app}>
        <LiveApp path={path} />
        {dev && <ModeSwitch gallery={false} floating />}
      </div>
    )
  }

  return (
    <div className={css.page}>
      <header className={css.header}>
        <div className={css.eyebrow}>FLEETHUB_OPS · FLUJO COMPLETO</div>
        <h1 className={css.title}>
          Consola industrial, <em className={css.accent}>de punta a punta</em>
        </h1>
        <p className={css.blurb}>
          Acceso (inicio de sesión, registro con código de empresa y verificación de 6 dígitos), el
          flujo del operador —dashboard con MapLibre real, modificar unidad, escaneo, confirmación
          del VIN, flota, alertas, perfil y datos personales— y la consola de administración:
          resumen, rutas de fábrica, editar ruta, usuarios con código de alta e historial de
          reportes.
        </p>
      </header>

      {dev && <ModeSwitch gallery />}

      <Gallery />
    </div>
  )
}
